import {
  CAPTION_MAX,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_TYPES,
  POSTER_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_UPLOAD_TYPES,
  type MediaKind,
} from "$lib/constants";

import {
  MediaError,
  probeVideoDuration,
  processImage,
  servedVideoType,
  sniffVideo,
} from "./media";
import { K, createPost, newId } from "./posts";
import { copyObject, deleteObjects, getObject, getRange, headObject, presignPut, putObject } from "./r2";
import { redis } from "./redis";

export class UploadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type PendingUpload = {
  id: string;
  kind: MediaKind;
  authorId: string;
  authorName: string;
  caption: string;
  type: string;
  size: number;
  srcKey: string;
  posterKey?: string;
  posterSize?: number;
  clientDuration?: number;
};

// Big batches upload 3 at a time, so the last file can start long after the batch began.
export const PENDING_TTL = 3 * 60 * 60;

export type InitInput = Partial<{
  kind: unknown;
  type: unknown;
  size: unknown;
  caption: unknown;
  posterType?: unknown;
  posterSize?: unknown;
  duration?: unknown;
}>;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export function cleanCaption(v: unknown) {
  if (v == null) return "";
  if (typeof v !== "string") throw new UploadError("Invalid caption.");
  // Collapse runs of blank lines, strip control characters.
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > CAPTION_MAX) throw new UploadError(`Caption must be at most ${CAPTION_MAX} characters.`);
  return s;
}

type ValidItem = Omit<PendingUpload, "id" | "authorId" | "authorName" | "srcKey" | "posterKey"> & {
  posterType?: string;
};

function validateItem(input: InitInput): ValidItem {
  const kind = input.kind;
  if (kind !== "image" && kind !== "video") throw new UploadError("Invalid media kind.");
  const caption = cleanCaption(input.caption);
  const type = String(input.type ?? "");
  const size = input.size;
  if (!isInt(size)) throw new UploadError("Invalid file size.");

  if (kind === "image") {
    if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(type)) throw new UploadError("Unsupported image type.");
    if (size > IMAGE_MAX_BYTES) throw new UploadError(`Images can be at most ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`);
    return { kind, caption, type, size };
  }

  if (!(VIDEO_UPLOAD_TYPES as readonly string[]).includes(type)) {
    throw new UploadError("Unsupported video format. Use MP4, MOV, WebM or MKV.");
  }
  if (size > VIDEO_MAX_BYTES) throw new UploadError(`Videos can be at most ${VIDEO_MAX_BYTES / 1024 / 1024} MB.`);
  const duration = Number(input.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new UploadError("Couldn't read the video's length.");
  if (duration > VIDEO_MAX_SECONDS + 0.5) {
    throw new UploadError(`Videos can be at most ${VIDEO_MAX_SECONDS / 60} minutes long.`);
  }
  const posterType = String(input.posterType ?? "");
  if (!["image/webp", "image/jpeg", "image/png"].includes(posterType)) throw new UploadError("Invalid thumbnail.");
  if (!isInt(input.posterSize) || input.posterSize > POSTER_MAX_BYTES) throw new UploadError("Thumbnail too large.");
  return { kind, caption, type, size, posterType, posterSize: input.posterSize, clientDuration: duration };
}

/**
 * Starts uploads for one or more files (each becomes its own post). Every item is validated
 * before anything is created, so a bad file rejects the whole batch with a message naming it.
 */
export async function initUploads(user: { id: string; name: string }, inputs: InitInput[]) {
  const items = inputs.map((input, i) => {
    try {
      return validateItem(input);
    } catch (e) {
      if (e instanceof UploadError && inputs.length > 1) throw new UploadError(`File ${i + 1}: ${e.message}`, e.status);
      throw e;
    }
  });

  return Promise.all(
    items.map(async ({ posterType, ...item }) => {
      const id = newId();
      const pending: PendingUpload = { ...item, id, authorId: user.id, authorName: user.name, srcKey: `tmp/${id}/src` };
      let posterUrl: string | undefined;
      if (item.kind === "video" && posterType && item.posterSize) {
        pending.posterKey = `tmp/${id}/poster`;
        posterUrl = await presignPut(pending.posterKey, posterType, item.posterSize, PENDING_TTL);
      }
      const uploadUrl = await presignPut(pending.srcKey, item.type, item.size, PENDING_TTL);
      await redis.set(K.upload(id), JSON.stringify(pending), { ex: PENDING_TTL });
      return { id, uploadUrl, posterUrl };
    }),
  );
}

export async function completeUpload(id: string, userId: string) {
  // GETDEL makes completion single-shot, so concurrent/replayed calls can't double-process.
  const raw = await redis.getdel<string>(K.upload(id));
  if (!raw) throw new UploadError("Upload not found or expired.", 404);
  const p = JSON.parse(raw) as PendingUpload;
  if (p.authorId !== userId) throw new UploadError("Upload not found or expired.", 404);

  const tmpKeys = [p.srcKey, p.posterKey].filter((k): k is string => !!k);
  const finalKeys: string[] = [];
  try {
    const head = await headObject(p.srcKey);
    if (!head) throw new UploadError("The file never arrived. Please try again.");
    if (head.size !== p.size) throw new UploadError("Uploaded file doesn't match what was declared.");

    const createdAt = Date.now();
    const thumbKey = `m/${id}/thumb.webp`;

    if (p.kind === "image") {
      const img = await processImage(await getObject(p.srcKey));
      const mediaKey = `m/${id}/full.webp`;
      finalKeys.push(mediaKey, thumbKey);
      await Promise.all([putObject(mediaKey, img.full, "image/webp"), putObject(thumbKey, img.thumb, "image/webp")]);
      await createPost({
        id,
        kind: "image",
        authorId: p.authorId,
        authorName: p.authorName,
        caption: p.caption,
        createdAt,
        width: img.width,
        height: img.height,
        duration: 0,
        mediaKey,
        thumbKey,
      });
    } else {
      const container = sniffVideo(await getRange(p.srcKey, 0, Math.min(p.size, 4096) - 1));
      if (!container) throw new UploadError("That file isn't a supported video.");

      const probed = await probeVideoDuration(p.srcKey, p.size, container);
      if (probed != null && probed > VIDEO_MAX_SECONDS + 1) {
        throw new UploadError(`Videos can be at most ${VIDEO_MAX_SECONDS / 60} minutes long.`);
      }
      const duration = probed ?? p.clientDuration ?? 0;

      if (!p.posterKey || !(await headObject(p.posterKey))) throw new UploadError("Thumbnail missing.");
      const poster = await processImage(await getObject(p.posterKey), { fullMax: 1280 });

      const mediaKey = `m/${id}/video`;
      finalKeys.push(mediaKey, thumbKey);
      await Promise.all([
        copyObject(p.srcKey, mediaKey, servedVideoType(container)),
        putObject(thumbKey, poster.thumb, "image/webp"),
      ]);
      await createPost({
        id,
        kind: "video",
        authorId: p.authorId,
        authorName: p.authorName,
        caption: p.caption,
        createdAt,
        width: poster.width,
        height: poster.height,
        duration: Math.round(duration * 10) / 10,
        mediaKey,
        thumbKey,
      });
    }
    return { id };
  } catch (e) {
    await deleteObjects(finalKeys);
    if (e instanceof UploadError) throw e;
    if (e instanceof MediaError) throw new UploadError(e.message);
    console.error("[upload] completion failed", e);
    throw new UploadError("Processing failed. Please try again.", 500);
  } finally {
    await deleteObjects(tmpKeys);
  }
}
