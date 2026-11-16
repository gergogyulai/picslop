import { error } from "@sveltejs/kit";

import {
  type BulkAddResult,
  SET_MAX_ITEMS,
  SET_NAME_MAX,
  canExport,
  exportBlockers,
  blockerText,
  type ItemState,
  type SetItemView,
  type SetLogEntry,
  type SetView,
} from "$lib/sets";

import { BOARD, newId, K as PK, parsePost, toHash, type PostRecord } from "./posts";
import { fetchObject, headObject, presignGet } from "./r2";
import { redis } from "./redis";

/**
 * Curated sets: an ordered list of board images that becomes a slideshow video.
 *
 *   sets                       zset   set id -> createdAt
 *   set:{id}                   hash   id, name, createdById, createdByName, createdAt, updatedAt, rev
 *   set:{id}:order             zset   post id -> position (the video order)
 *   set:{id}:item:{postId}     hash   state, who put it there and when, optional veto reason, who added it
 *   set:{id}:rejected          set    images vetoed and swapped out; they can't come back into this set
 *   set:{id}:log               list   JSON SetLogEntry, newest last (every add, swap, reorder and review)
 */
export const SK = {
  all: "sets",
  set: (id: string) => `set:${id}`,
  order: (id: string) => `set:${id}:order`,
  item: (id: string, postId: string) => `set:${id}:item:${postId}`,
  rejected: (id: string) => `set:${id}:rejected`,
  log: (id: string) => `set:${id}:log`,
};

const LOG_KEEP = 1000;

type Actor = { id: string; name: string };

const logJson = (e: SetLogEntry) => JSON.stringify(e);

// ---------------------------------------------------------------------------
// Lua scripts: every change is one atomic step, so a reviewer and a curator acting at the same
// moment can't leave the set half-updated (e.g. a review landing on an image mid-swap).
// ---------------------------------------------------------------------------

// KEYS: set, order, item, rejected, log
// ARGV: postId, byId, byName, at, log entry, max items
// Returns the new item count; false (no set), -1 already in the set, -2 vetoed out of it before, -3 full.
const addScript = redis.createScript<number | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
if redis.call('ZSCORE', KEYS[2], ARGV[1]) then return -1 end
if redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 1 then return -2 end
local n = redis.call('ZCARD', KEYS[2])
if n >= tonumber(ARGV[6]) then return -3 end
local last = redis.call('ZRANGE', KEYS[2], -1, -1, 'WITHSCORES')
local pos = 0
if last[2] then pos = tonumber(last[2]) + 1 end
redis.call('ZADD', KEYS[2], pos, ARGV[1])
redis.call('DEL', KEYS[3])
redis.call('HSET', KEYS[3], 'postId', ARGV[1], 'state', 'pending', 'stateById', ARGV[2], 'stateByName', ARGV[3],
  'stateAt', ARGV[4], 'reason', '', 'addedById', ARGV[2], 'addedByName', ARGV[3], 'addedAt', ARGV[4], 'replaces', '')
redis.call('RPUSH', KEYS[5], ARGV[5])
redis.call('LTRIM', KEYS[5], -${LOG_KEEP}, -1)
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[4])
redis.call('HINCRBY', KEYS[1], 'rev', 1)
return n + 1
`);

// KEYS: set, order, rejected, log, then one item key per post id (same order as ARGV[6..])
// ARGV: byId, byName, at, max items, log entry, then the post ids in the order to append them
// Appends every id that isn't already in the set or rejected from it, until the set is full.
// Returns false (no set) or {added, already in set, rejected, didn't fit}.
const addManyScript = redis.createScript<number[] | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local n = redis.call('ZCARD', KEYS[2])
local max = tonumber(ARGV[4])
local last = redis.call('ZRANGE', KEYS[2], -1, -1, 'WITHSCORES')
local pos = 0
if last[2] then pos = tonumber(last[2]) + 1 end
local added, present, rejected, full = 0, 0, 0, 0
for i = 6, #ARGV do
  local id = ARGV[i]
  local key = KEYS[i - 1]
  if redis.call('ZSCORE', KEYS[2], id) then present = present + 1
  elseif redis.call('SISMEMBER', KEYS[3], id) == 1 then rejected = rejected + 1
  elseif n >= max then full = full + 1
  else
    redis.call('ZADD', KEYS[2], pos, id)
    redis.call('DEL', key)
    redis.call('HSET', key, 'postId', id, 'state', 'pending', 'stateById', ARGV[1], 'stateByName', ARGV[2],
      'stateAt', ARGV[3], 'reason', '', 'addedById', ARGV[1], 'addedByName', ARGV[2], 'addedAt', ARGV[3], 'replaces', '')
    pos = pos + 1
    n = n + 1
    added = added + 1
  end
end
if added > 0 then
  local entry = string.gsub(ARGV[5], '"count":0', '"count":' .. added)
  redis.call('RPUSH', KEYS[4], entry)
  redis.call('LTRIM', KEYS[4], -${LOG_KEEP}, -1)
  redis.call('HSET', KEYS[1], 'updatedAt', ARGV[3])
  redis.call('HINCRBY', KEYS[1], 'rev', 1)
end
return {added, present, rejected, full}
`);

// KEYS: set, order, item, log
// ARGV: postId, at, log entry
// Returns 1; false if it isn't in the set; -1 if it's vetoed (vetoed images must be replaced, not dropped).
const removeScript = redis.createScript<number | null>(`
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return false end
if redis.call('HGET', KEYS[3], 'state') == 'vetoed' then return -1 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
redis.call('RPUSH', KEYS[4], ARGV[3])
redis.call('LTRIM', KEYS[4], -${LOG_KEEP}, -1)
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[2])
redis.call('HINCRBY', KEYS[1], 'rev', 1)
return 1
`);

// KEYS: set, order, old item, new item, rejected, log
// ARGV: oldId, newId, byId, byName, at, log entry
// The replacement takes the vetoed image's place in the order and starts as pending; the vetoed
// image leaves the set and is remembered as rejected.
// Returns 1; false if the vetoed image isn't in the set; -1 it isn't vetoed; -2 the new one is
// already in the set; -3 the new one was vetoed out of this set before.
const replaceScript = redis.createScript<number | null>(`
local pos = redis.call('ZSCORE', KEYS[2], ARGV[1])
if not pos then return false end
if redis.call('HGET', KEYS[3], 'state') ~= 'vetoed' then return -1 end
if redis.call('ZSCORE', KEYS[2], ARGV[2]) then return -2 end
if redis.call('SISMEMBER', KEYS[5], ARGV[2]) == 1 then return -3 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[2], pos, ARGV[2])
redis.call('DEL', KEYS[3])
redis.call('SADD', KEYS[5], ARGV[1])
redis.call('DEL', KEYS[4])
redis.call('HSET', KEYS[4], 'postId', ARGV[2], 'state', 'pending', 'stateById', ARGV[3], 'stateByName', ARGV[4],
  'stateAt', ARGV[5], 'reason', '', 'addedById', ARGV[3], 'addedByName', ARGV[4], 'addedAt', ARGV[5], 'replaces', ARGV[1])
redis.call('RPUSH', KEYS[6], ARGV[6])
redis.call('LTRIM', KEYS[6], -${LOG_KEEP}, -1)
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[5])
redis.call('HINCRBY', KEYS[1], 'rev', 1)
return 1
`);

// KEYS: set, order, log
// ARGV: expected rev, at, log entry, then every post id in the new order
// The new order must be exactly the set's current images, and nobody may have changed the set since
// the editor loaded it (rev). Returns the new rev; false (no set); -1 stale rev; -2 not the same images.
const reorderScript = redis.createScript<number | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
if (redis.call('HGET', KEYS[1], 'rev') or '0') ~= ARGV[1] then return -1 end
local n = #ARGV - 3
if n ~= redis.call('ZCARD', KEYS[2]) then return -2 end
local seen = {}
for i = 4, #ARGV do
  local id = ARGV[i]
  if seen[id] or not redis.call('ZSCORE', KEYS[2], id) then return -2 end
  seen[id] = true
end
for i = 4, #ARGV do redis.call('ZADD', KEYS[2], i - 4, ARGV[i]) end
redis.call('RPUSH', KEYS[3], ARGV[3])
redis.call('LTRIM', KEYS[3], -${LOG_KEEP}, -1)
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[2])
return redis.call('HINCRBY', KEYS[1], 'rev', 1)
`);

// KEYS: set, order, item, log
// ARGV: postId, state ('approved' | 'vetoed'), byId, byName, at, reason, log entry
// Reviews don't bump rev: they judge the image, not the order. Returns 1, or false when the image
// is no longer in the set (e.g. it was just swapped out).
const reviewScript = redis.createScript<number | null>(`
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return false end
redis.call('HSET', KEYS[3], 'state', ARGV[2], 'stateById', ARGV[3], 'stateByName', ARGV[4], 'stateAt', ARGV[5], 'reason', ARGV[6])
redis.call('RPUSH', KEYS[4], ARGV[7])
redis.call('LTRIM', KEYS[4], -${LOG_KEEP}, -1)
redis.call('HSET', KEYS[1], 'updatedAt', ARGV[5])
return 1
`);

// KEYS: set, order, log, then one item key per post id
// ARGV: state, byId, byName, at, reason, then the post ids, then one log entry per post id
// Bulk version of reviewScript, in one atomic step. Ids no longer in the set are skipped.
// Returns how many images were reviewed, or false when the set doesn't exist.
const reviewManyScript = redis.createScript<number | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local n = (#ARGV - 5) / 2
local done = 0
for i = 1, n do
  local id = ARGV[5 + i]
  if redis.call('ZSCORE', KEYS[2], id) then
    redis.call('HSET', KEYS[3 + i], 'state', ARGV[1], 'stateById', ARGV[2], 'stateByName', ARGV[3], 'stateAt', ARGV[4], 'reason', ARGV[5])
    redis.call('RPUSH', KEYS[3], ARGV[5 + n + i])
    done = done + 1
  end
end
if done > 0 then
  redis.call('LTRIM', KEYS[3], -${LOG_KEEP}, -1)
  redis.call('HSET', KEYS[1], 'updatedAt', ARGV[4])
end
return done
`);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const asState = (s: string | undefined): ItemState => (s === "approved" || s === "vetoed" ? s : "pending");

type Snapshot = {
  view: SetView;
  /** Raw post records by id, for the export (media keys never leave the server). */
  posts: Map<string, PostRecord>;
};

/**
 * Reads a whole set consistently: the order, then every item and post in one transaction that
 * re-reads the order. If the order moved in between (a swap, an add), it reads again, so the
 * result never mixes two versions of the set.
 */
async function snapshot(id: string): Promise<Snapshot | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [metaRaw, orderRaw] = (await redis.multi().hgetall(SK.set(id)).zrange(SK.order(id), 0, -1).exec()) as [unknown, string[]];
    const meta = toHash(metaRaw);
    if (!meta?.id) return null;
    const ids = (orderRaw ?? []).map(String);

    const tx = redis.multi();
    tx.hgetall(SK.set(id));
    tx.zrange(SK.order(id), 0, -1);
    tx.smembers(SK.rejected(id));
    for (const pid of ids) {
      tx.hgetall(SK.item(id, pid));
      tx.hgetall(PK.post(pid));
    }
    const res = (await tx.exec()) as unknown[];
    const again = ((res[1] as string[] | null) ?? []).map(String);
    if (again.join(",") !== ids.join(",")) continue;

    const m = toHash(res[0]);
    if (!m?.id) return null;
    const posts = new Map<string, PostRecord>();
    const items: SetItemView[] = await Promise.all(
      ids.map(async (pid, i) => {
        const h = toHash(res[3 + i * 2]) ?? {};
        const rec = parsePost(res[4 + i * 2]);
        if (rec) posts.set(pid, rec);
        const state = asState(h.state);
        return {
          postId: pid,
          position: i + 1,
          state,
          stateById: h.stateById ?? "",
          stateByName: h.stateByName ?? "",
          stateAt: Number(h.stateAt) || 0,
          reason: state === "vetoed" ? (h.reason ?? "") : "",
          addedById: h.addedById ?? "",
          addedByName: h.addedByName ?? "",
          addedAt: Number(h.addedAt) || 0,
          replaces: h.replaces ?? "",
          post: rec
            ? {
                kind: rec.kind,
                caption: rec.caption,
                authorName: rec.authorName,
                width: rec.width,
                height: rec.height,
                thumbUrl: await presignGet(rec.thumbKey),
                mediaUrl: await presignGet(rec.mediaKey),
              }
            : null,
        };
      }),
    );
    return {
      view: {
        id: m.id,
        name: m.name ?? "",
        createdById: m.createdById ?? "",
        createdByName: m.createdByName ?? "",
        createdAt: Number(m.createdAt) || 0,
        updatedAt: Number(m.updatedAt) || 0,
        rev: Number(m.rev) || 0,
        items,
        rejected: ((res[2] as string[] | null) ?? []).map(String),
      },
      posts,
    };
  }
  error(409, "This set is being edited right now. Try again in a moment.");
}

export async function getSet(id: string): Promise<SetView | null> {
  if (!isValidSetId(id)) return null;
  return (await snapshot(id))?.view ?? null;
}

/** Every set, most recently changed first. */
export async function listSets(): Promise<SetView[]> {
  const ids = (await redis.zrange(SK.all, 0, -1, { rev: true })) as string[];
  const sets = await Promise.all(ids.map((id) => snapshot(String(id)).then((s) => s?.view ?? null)));
  return sets.filter((s): s is SetView => s !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSetLog(id: string, limit = 50): Promise<SetLogEntry[]> {
  const raw = (await redis.lrange(SK.log(id), -limit, -1)) as string[];
  return raw
    .map((r) => {
      try {
        return JSON.parse(String(r)) as SetLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is SetLogEntry => e !== null)
    .reverse();
}

export const isValidSetId = (id: string) => /^[A-Za-z0-9]{8,24}$/.test(id);

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function parseSetName(v: unknown) {
  const name = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!name) error(400, "Give the set a name.");
  if (name.length > SET_NAME_MAX) error(400, `Set names are at most ${SET_NAME_MAX} characters.`);
  return name;
}

export async function createSet(name: string, by: Actor) {
  const id = newId();
  const at = Date.now();
  await redis
    .multi()
    .hset(SK.set(id), {
      id,
      name,
      createdById: by.id,
      createdByName: by.name,
      createdAt: String(at),
      updatedAt: String(at),
      rev: "0",
    })
    .zadd(SK.all, { score: at, member: id })
    .rpush(SK.log(id), logJson({ at, byId: by.id, byName: by.name, action: "create" }))
    .exec();
  return id;
}

export async function renameSet(id: string, name: string, by: Actor) {
  const at = Date.now();
  if (!Number(await redis.exists(SK.set(id)))) return false;
  await redis
    .multi()
    .hset(SK.set(id), { name, updatedAt: String(at) })
    .rpush(SK.log(id), logJson({ at, byId: by.id, byName: by.name, action: "rename" }))
    .exec();
  return true;
}

export async function deleteSet(id: string) {
  const ids = (await redis.zrange(SK.order(id), 0, -1)) as string[];
  const tx = redis.multi();
  tx.del(SK.set(id), SK.order(id), SK.rejected(id), SK.log(id));
  if (ids.length) tx.del(...ids.map((pid) => SK.item(id, String(pid))));
  tx.zrem(SK.all, id);
  await tx.exec();
}

/** Only images can go into a slideshow, and only ones still on the board. */
async function requireImagePost(postId: string) {
  const rec = parsePost(await redis.hgetall(PK.post(postId)));
  if (!rec) error(404, "That post no longer exists.");
  if (rec.kind !== "image") error(400, "Only images can go into a curated set.");
  return rec;
}

export async function addItem(id: string, postId: string, by: Actor) {
  await requireImagePost(postId);
  const at = Date.now();
  const res = await addScript.exec(
    [SK.set(id), SK.order(id), SK.item(id, postId), SK.rejected(id), SK.log(id)],
    [postId, by.id, by.name, String(at), logJson({ at, byId: by.id, byName: by.name, action: "add", postId }), String(SET_MAX_ITEMS)],
  );
  if (res == null) error(404, "Set not found.");
  const n = Number(res);
  if (n === -1) error(409, "That image is already in this set.");
  if (n === -2) error(409, "That image was vetoed for this set. Pick a different one.");
  if (n === -3) error(400, `A set can hold at most ${SET_MAX_ITEMS} images.`);
  return n;
}

/**
 * Appends every image on the Picked board to the set, in the board's order (most recently picked
 * first), skipping ones already in the set or vetoed out of it. All of it lands as pending.
 */
export async function addAllPicked(id: string, by: Actor): Promise<BulkAddResult> {
  const ids = ((await redis.zrange(BOARD.picked, 0, -1, { rev: true })) as string[]).map(String);
  const kinds = ids.length ? ((await ids.reduce((p, pid) => p.hget(PK.post(pid), "kind"), redis.pipeline()).exec()) as (string | null)[]) : [];
  const images = ids.filter((_, i) => kinds[i] === "image");
  const videos = ids.filter((_, i) => kinds[i] === "video").length;
  const at = Date.now();
  const res = await addManyScript.exec(
    [SK.set(id), SK.order(id), SK.rejected(id), SK.log(id), ...images.map((pid) => SK.item(id, pid))],
    [by.id, by.name, String(at), String(SET_MAX_ITEMS), logJson({ at, byId: by.id, byName: by.name, action: "add-many", count: 0 }), ...images],
  );
  if (res == null) error(404, "Set not found.");
  const [added, present, rejected, full] = res.map(Number) as [number, number, number, number];
  return { added, present, rejected, full, videos };
}

export async function removeItem(id: string, postId: string, by: Actor) {
  const at = Date.now();
  const res = await removeScript.exec(
    [SK.set(id), SK.order(id), SK.item(id, postId), SK.log(id)],
    [postId, String(at), logJson({ at, byId: by.id, byName: by.name, action: "remove", postId })],
  );
  if (res == null) error(404, "That image isn't in this set.");
  if (Number(res) === -1) error(409, "Vetoed images can't just be removed. Replace it with a different image.");
}

export async function replaceItem(id: string, oldId: string, newId: string, by: Actor) {
  if (oldId === newId) error(400, "Pick a different image to replace the vetoed one.");
  await requireImagePost(newId);
  const at = Date.now();
  const res = await replaceScript.exec(
    [SK.set(id), SK.order(id), SK.item(id, oldId), SK.item(id, newId), SK.rejected(id), SK.log(id)],
    [oldId, newId, by.id, by.name, String(at), logJson({ at, byId: by.id, byName: by.name, action: "replace", postId: newId, replaced: oldId })],
  );
  if (res == null) error(404, "That image isn't in this set any more.");
  const n = Number(res);
  if (n === -1) error(409, "Only vetoed images are replaced. This one isn't vetoed (any more).");
  if (n === -2) error(409, "That image is already in this set.");
  if (n === -3) error(409, "That image was vetoed for this set. Pick a different one.");
}

export async function reorder(id: string, rev: number, order: string[], by: Actor) {
  const at = Date.now();
  const res = await reorderScript.exec(
    [SK.set(id), SK.order(id), SK.log(id)],
    [String(rev), String(at), logJson({ at, byId: by.id, byName: by.name, action: "reorder" }), ...order],
  );
  if (res == null) error(404, "Set not found.");
  const n = Number(res);
  if (n === -1) error(409, "Someone else changed this set. Reloaded it with their changes; redo your move.");
  if (n === -2) error(409, "The set's images changed while you were reordering. Reloaded it; redo your move.");
  return n;
}

export async function review(id: string, postId: string, state: "approved" | "vetoed", reason: string, by: Actor) {
  const at = Date.now();
  const entry: SetLogEntry = { at, byId: by.id, byName: by.name, action: state === "approved" ? "approve" : "veto", postId };
  if (state === "vetoed" && reason) entry.reason = reason;
  const res = await reviewScript.exec(
    [SK.set(id), SK.order(id), SK.item(id, postId), SK.log(id)],
    [postId, state, by.id, by.name, String(at), state === "vetoed" ? reason : "", logJson(entry)],
  );
  if (res == null) error(404, "That image isn't in this set any more.");
}

/** Approves or vetoes several images at once (same reason for all). Returns how many were reviewed. */
export async function reviewMany(id: string, postIds: string[], state: "approved" | "vetoed", reason: string, by: Actor) {
  const at = Date.now();
  const why = state === "vetoed" ? reason : "";
  const entries = postIds.map((postId) => {
    const e: SetLogEntry = { at, byId: by.id, byName: by.name, action: state === "approved" ? "approve" : "veto", postId };
    if (why) e.reason = why;
    return logJson(e);
  });
  const res = await reviewManyScript.exec(
    [SK.set(id), SK.order(id), SK.log(id), ...postIds.map((pid) => SK.item(id, pid))],
    [state, by.id, by.name, String(at), why, ...postIds, ...entries],
  );
  if (res == null) error(404, "Set not found.");
  return Number(res);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/avif": "avif",
};

export type Manifest = {
  version: 1;
  setId: string;
  setName: string;
  exportedAt: string;
  exportedBy: Actor;
  count: number;
  /** Video order. This order, not filenames, is what the video builder follows. */
  images: {
    position: number;
    filename: string;
    postId: string;
    width: number;
    height: number;
    approvedBy: Actor;
    approvedAt: string;
  }[];
};

/**
 * Checks the export rule against one consistent snapshot of the set and, if it passes, returns
 * the zip entries for exactly that snapshot: every image in video order, then manifest.json.
 * Throws 409 (nothing streamed yet) when the set isn't clean or an image file is missing.
 */
export async function prepareExport(id: string, by: Actor) {
  const snap = await snapshot(id);
  if (!snap) error(404, "Set not found.");
  const { view, posts } = snap;
  const blockers = exportBlockers(view.items);
  if (!canExport(blockers)) error(409, blockerText(blockers));

  // Make sure every file is there before streaming starts, so a missing one is a clear error
  // instead of a zip cut off halfway (or, worse, a manifest pointing at a file that isn't in it).
  const width = String(view.items.length).length;
  const files: { item: SetItemView; rec: PostRecord; filename: string }[] = [];
  for (let i = 0; i < view.items.length; i += 10) {
    const batch = view.items.slice(i, i + 10);
    const heads = await Promise.all(batch.map((it) => headObject(posts.get(it.postId)!.mediaKey).catch(() => null)));
    batch.forEach((item, k) => {
      const head = heads[k];
      if (!head) error(409, `The file for image #${item.position} is missing from storage. Replace or remove it, then export again.`);
      const ext = EXT[head.contentType.split(";")[0]!.trim().toLowerCase()] ?? "webp";
      const filename = `${String(item.position).padStart(Math.max(3, width), "0")}_${item.postId}.${ext}`;
      files.push({ item, rec: posts.get(item.postId)!, filename });
    });
  }

  const exportedAt = new Date();
  const manifest: Manifest = {
    version: 1,
    setId: view.id,
    setName: view.name,
    exportedAt: exportedAt.toISOString(),
    exportedBy: by,
    count: files.length,
    images: files.map(({ item, rec, filename }) => ({
      position: item.position,
      filename,
      postId: item.postId,
      width: rec.width,
      height: rec.height,
      approvedBy: { id: item.stateById, name: item.stateByName },
      approvedAt: new Date(item.stateAt).toISOString(),
    })),
  };

  async function* entries() {
    for (const { rec, filename } of files) {
      const media = await fetchObject(rec.mediaKey);
      // Throwing here aborts the download rather than producing a zip without this image.
      if (!media?.body) throw new Error(`export ${view.id}: ${rec.id} vanished from storage mid-export`);
      yield { name: filename, input: media, lastModified: new Date(rec.createdAt || Date.now()) };
    }
    yield { name: "manifest.json", input: JSON.stringify(manifest, null, 2), lastModified: exportedAt };
  }

  return { set: view, manifest, entries };
}
