import { AwsClient } from "aws4fetch";

import { ENV } from "../../env.server";

const client = new AwsClient({
  accessKeyId: ENV.R2_ACCESS_KEY_ID,
  secretAccessKey: ENV.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
  retries: 2,
});

const origin = ENV.R2_ENDPOINT?.replace(/\/+$/, "") || `https://${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const endpoint = `${origin}/${ENV.R2_BUCKET}`;
const objectUrl = (key: string) => `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;

const amzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, "");

/**
 * Presigned PUT. Content-Type and Content-Length are part of the signature, so the
 * browser can only upload exactly the file it declared (same size, same type).
 */
export async function presignPut(key: string, contentType: string, size: number, expiresSec = 900) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(size) },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

const READ_BUCKET_MS = 60 * 60 * 1000;
const READ_EXPIRES_SEC = 3 * 60 * 60;

/**
 * Presigned GET. The signing time is rounded down to the hour so the same object
 * gets the same URL for an hour, which lets the browser cache it. Every URL stays
 * valid for at least 2 hours after it is handed out.
 */
export async function presignGet(key: string) {
  const bucketed = new Date(Math.floor(Date.now() / READ_BUCKET_MS) * READ_BUCKET_MS);
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(READ_EXPIRES_SEC));
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true, datetime: amzDate(bucketed) },
  });
  return signed.url;
}

export async function headObject(key: string) {
  const res = await client.fetch(objectUrl(key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key} failed: ${res.status}`);
  return {
    size: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type") ?? "",
  };
}

/** Reads bytes [start, end] inclusive. */
export async function getRange(key: string, start: number, end: number) {
  const res = await client.fetch(objectUrl(key), { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`R2 GET range ${key} failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getObject(key: string) {
  const res = await client.fetch(objectUrl(key));
  if (!res.ok) throw new Error(`R2 GET ${key} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const CACHE = "private, max-age=86400, immutable";

export async function putObject(key: string, body: Buffer, contentType: string) {
  const res = await client.fetch(objectUrl(key), {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "Content-Type": contentType, "Cache-Control": CACHE },
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text()}`);
}

/** Server-side copy inside the bucket (no bytes go through us). */
export async function copyObject(from: string, to: string, contentType: string) {
  const res = await client.fetch(objectUrl(to), {
    method: "PUT",
    headers: {
      "x-amz-copy-source": `/${ENV.R2_BUCKET}/${from.split("/").map(encodeURIComponent).join("/")}`,
      "x-amz-metadata-directive": "REPLACE",
      "Content-Type": contentType,
      "Cache-Control": CACHE,
    },
  });
  if (!res.ok) throw new Error(`R2 COPY ${from} -> ${to} failed: ${res.status} ${await res.text()}`);
}

export async function deleteObjects(keys: string[]) {
  await Promise.all(
    keys.map(async (key) => {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) console.error(`R2 DELETE ${key} failed: ${res.status}`);
    }),
  );
}
