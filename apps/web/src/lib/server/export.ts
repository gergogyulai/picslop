import type { CommentView } from "$lib/constants";

import { BOARD, K, listComments, parsePost, toHash, type PostRecord } from "./posts";
import { fetchObject } from "./r2";
import { redis } from "./redis";

export type ExportScope = "all" | "picked";

type ExportedPost = Omit<PostRecord, "mediaKey" | "thumbKey" | "createdAt" | "comments"> & {
  createdAt: string;
  commentCount: number;
  picked: boolean;
  pickedAt: string | null;
  reactions: Record<string, number>;
  comments: CommentView[];
  /** Path of the media file inside the zip; null when it couldn't be read from storage. */
  file: string | null;
};

/** Posts per Redis round trip while building the export. */
const CHUNK = 50;

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function extFor(kind: PostRecord["kind"], contentType: string | null) {
  const ext = EXT[(contentType ?? "").split(";")[0]!.trim().toLowerCase()];
  return ext ?? (kind === "video" ? "mp4" : "webp");
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Lazily yields zip entries: each post's full-size media (one R2 download at a time, streamed
 * straight through), then posts.json with every post's metadata, reactions and comments.
 * "all" is newest first; "picked" follows the Picked board (most recently picked first).
 */
export async function* exportEntries(scope: ExportScope) {
  const ids = (await redis.zrange(scope === "picked" ? BOARD.picked : BOARD.new, 0, -1, { rev: true })) as string[];
  const posts: ExportedPost[] = [];
  const failed: string[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const pipe = redis.pipeline();
    for (const id of chunk) {
      pipe.hgetall(K.post(id));
      pipe.hgetall(K.reactions(id));
    }
    const res = (await pipe.exec()) as unknown[];
    const comments = await Promise.all(chunk.map((id) => listComments(id, 100_000)));

    for (let j = 0; j < chunk.length; j++) {
      const hash = toHash(res[j * 2]);
      const rec = parsePost(hash);
      if (!rec) continue;

      let file: string | null = null;
      try {
        const media = rec.mediaKey ? await fetchObject(rec.mediaKey) : null;
        if (media?.body) {
          file = `media/${day(rec.createdAt)}_${rec.id}.${extFor(rec.kind, media.headers.get("content-type"))}`;
          yield { name: file, input: media, lastModified: new Date(rec.createdAt || Date.now()) };
        }
      } catch (e) {
        console.error(`export: ${rec.id}`, e);
        file = null;
      }
      if (!file) failed.push(rec.id);

      const reactions: Record<string, number> = {};
      for (const [emoji, n] of Object.entries(toHash(res[j * 2 + 1]) ?? {})) {
        if (Number(n) > 0) reactions[emoji] = Number(n);
      }
      const pickedAt = Number(hash?.pickedAt) || 0;
      const { mediaKey: _m, thumbKey: _t, comments: commentCount, ...meta } = rec;
      posts.push({
        ...meta,
        commentCount,
        createdAt: new Date(rec.createdAt).toISOString(),
        picked: !!rec.pickedBy,
        pickedAt: pickedAt ? new Date(pickedAt).toISOString() : null,
        reactions,
        comments: comments[j]!,
        file,
      });
    }
  }

  const manifest = { exportedAt: new Date().toISOString(), scope, count: posts.length, missingMedia: failed, posts };
  yield { name: "posts.json", input: JSON.stringify(manifest, null, 2), lastModified: new Date() };
}
