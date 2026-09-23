import {
  COMMENT_MAX_DEPTH,
  MAX_DISTINCT_REACTIONS,
  MAX_REACTIONS_PER_USER,
  PAGE_SIZE,
  isEmoji,
  type CommentView,
  type MediaKind,
  type PostDetail,
  type PostView,
  type SortId,
} from "$lib/constants";

import { deleteObjects, presignGet } from "./r2";
import { redis } from "./redis";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const K = {
  post: (id: string) => `post:${id}`,
  votes: (id: string) => `post:${id}:votes`,
  reactions: (id: string) => `post:${id}:rx`,
  userReactions: (id: string) => `post:${id}:urx`,
  comments: (id: string) => `post:${id}:comments`,
  comment: (cid: string) => `comment:${cid}`,
  upload: (id: string) => `upload:${id}`,
  userPosts: (uid: string) => `user:${uid}:posts`,
  banned: "banned",
};

export const BOARD: Record<SortId, string> = {
  new: "posts:new",
  top: "posts:top",
  hot: "posts:hot",
  discussed: "posts:discussed",
};

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newId(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export const isValidId = (id: string) => /^[A-Za-z0-9]{8,24}$/.test(id);

/** Reddit-style "hot": log-scaled score plus a time bonus (every 12.5h ≈ 10x votes). */
export function hotScore(score: number, createdAt: number) {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = Math.sign(score);
  return sign * order + createdAt / 1000 / 45000;
}

// ---------------------------------------------------------------------------
// Lua scripts (atomic read-modify-write)
// ---------------------------------------------------------------------------

const voteScript = redis.createScript<[number, number, number] | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local uid, v, id = ARGV[1], tonumber(ARGV[2]), ARGV[3]
local prev = tonumber(redis.call('HGET', KEYS[2], uid) or '0')
if prev ~= v then
  if v == 0 then redis.call('HDEL', KEYS[2], uid) else redis.call('HSET', KEYS[2], uid, v) end
  local du = (v == 1 and 1 or 0) - (prev == 1 and 1 or 0)
  local dd = (v == -1 and 1 or 0) - (prev == -1 and 1 or 0)
  if du ~= 0 then redis.call('HINCRBY', KEYS[1], 'up', du) end
  if dd ~= 0 then redis.call('HINCRBY', KEYS[1], 'down', dd) end
end
local up = tonumber(redis.call('HGET', KEYS[1], 'up') or '0')
local down = tonumber(redis.call('HGET', KEYS[1], 'down') or '0')
local score = up - down
redis.call('HSET', KEYS[1], 'score', score)
redis.call('ZADD', KEYS[3], score, id)
local created = tonumber(redis.call('HGET', KEYS[1], 'createdAt') or '0')
local sign = 0
if score > 0 then sign = 1 elseif score < 0 then sign = -1 end
local hot = sign * math.log10(math.max(math.abs(score), 1)) + created / 1000 / 45000
redis.call('ZADD', KEYS[4], string.format('%.10f', hot), id)
return {up, down, v}
`);

// KEYS: post, reaction counts (emoji -> n), per-user reactions (uid -> ",e1,e2,")
// ARGV: uid, emoji, max distinct emoji per post, max reactions per user per post
// Returns {1|0 (on/off), count} or {-1, 0} (post full) / {-2, 0} (user at limit).
const reactScript = redis.createScript<[number, number] | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local cur = redis.call('HGET', KEYS[3], ARGV[1]) or ','
local s, e = string.find(cur, ',' .. ARGV[2] .. ',', 1, true)
local on
if s then
  cur = string.sub(cur, 1, s) .. string.sub(cur, e + 1)
  on = 0
  if tonumber(redis.call('HINCRBY', KEYS[2], ARGV[2], -1)) <= 0 then redis.call('HDEL', KEYS[2], ARGV[2]) end
else
  if redis.call('HEXISTS', KEYS[2], ARGV[2]) == 0 and redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[3]) then
    return {-1, 0}
  end
  local _, commas = string.gsub(cur, ',', ',')
  if commas - 1 >= tonumber(ARGV[4]) then return {-2, 0} end
  cur = cur .. ARGV[2] .. ','
  on = 1
  redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
end
if cur == ',' then redis.call('HDEL', KEYS[3], ARGV[1]) else redis.call('HSET', KEYS[3], ARGV[1], cur) end
return {on, tonumber(redis.call('HGET', KEYS[2], ARGV[2]) or '0')}
`);

// KEYS: post, post's comment zset, comment, posts:discussed, parent comment (= comment key when top-level)
// ARGV: cid, postId, authorId, authorName, body, createdAt, parentId ('' = top-level), depth
// Returns the post's new comment count, false if the post is gone, -1 if the parent is gone.
const addCommentScript = redis.createScript<number | null>(`
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
if ARGV[7] ~= '' then
  if redis.call('HGET', KEYS[5], 'postId') ~= ARGV[2] or redis.call('HGET', KEYS[5], 'deleted') == '1' then return -1 end
  redis.call('HINCRBY', KEYS[5], 'replies', 1)
end
redis.call('HSET', KEYS[3], 'id', ARGV[1], 'postId', ARGV[2], 'authorId', ARGV[3], 'authorName', ARGV[4],
  'body', ARGV[5], 'createdAt', ARGV[6], 'parentId', ARGV[7], 'depth', ARGV[8], 'replies', 0)
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[1])
local n = redis.call('HINCRBY', KEYS[1], 'comments', 1)
redis.call('ZADD', KEYS[4], n, ARGV[2])
return n
`);

// Same KEYS as above; ARGV: cid, postId, hasParent ('1'/'0').
// A comment with replies becomes a "[deleted]" placeholder so the thread survives; otherwise it is removed.
// Returns false if not found, 1 when done, 2 when the parent is a placeholder that just lost its last reply
// (the caller then removes the parent too).
const deleteCommentScript = redis.createScript<number | null>(`
if redis.call('ZSCORE', KEYS[2], ARGV[1]) == false then return false end
local replies = tonumber(redis.call('HGET', KEYS[3], 'replies') or '0')
local wasDeleted = redis.call('HGET', KEYS[3], 'deleted') == '1'
local function uncount()
  if redis.call('EXISTS', KEYS[1]) == 1 then
    local n = redis.call('HINCRBY', KEYS[1], 'comments', -1)
    redis.call('ZADD', KEYS[4], n, ARGV[2])
  end
end
if replies > 0 then
  if not wasDeleted then
    redis.call('HSET', KEYS[3], 'deleted', '1', 'body', '', 'authorName', '', 'authorId', '')
    uncount()
  end
  return 1
end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
if not wasDeleted then uncount() end
if ARGV[3] == '1' and redis.call('EXISTS', KEYS[5]) == 1 then
  local left = tonumber(redis.call('HINCRBY', KEYS[5], 'replies', -1))
  if left <= 0 and redis.call('HGET', KEYS[5], 'deleted') == '1' then return 2 end
end
return 1
`);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export type PostRecord = {
  id: string;
  kind: MediaKind;
  authorId: string;
  authorName: string;
  caption: string;
  createdAt: number;
  width: number;
  height: number;
  duration: number;
  mediaKey: string;
  thumbKey: string;
  up: number;
  down: number;
  score: number;
  comments: number;
};

/**
 * The raw client (automaticDeserialization: false) returns HGETALL as Redis does:
 * a flat [field, value, field, value, ...] array. Normalise to an object.
 */
export function toHash(raw: unknown): Record<string, string> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  if (typeof raw === "object") return raw as Record<string, string>;
  return null;
}

function parsePost(raw: unknown): PostRecord | null {
  const h = toHash(raw);
  if (!h || !h.id) return null;
  const n = (k: string) => Number(h[k] ?? 0) || 0;
  return {
    id: h.id,
    kind: h.kind === "video" ? "video" : "image",
    authorId: h.authorId ?? "",
    authorName: h.authorName ?? "",
    caption: h.caption ?? "",
    createdAt: n("createdAt"),
    width: n("width"),
    height: n("height"),
    duration: n("duration"),
    mediaKey: h.mediaKey ?? "",
    thumbKey: h.thumbKey ?? "",
    up: n("up"),
    down: n("down"),
    score: n("score"),
    comments: n("comments"),
  };
}

async function toView(p: PostRecord, myVote: number): Promise<PostView> {
  const [thumbUrl, mediaUrl] = await Promise.all([presignGet(p.thumbKey), presignGet(p.mediaKey)]);
  const { mediaKey: _m, thumbKey: _t, ...rest } = p;
  return { ...rest, thumbUrl, mediaUrl, myVote: myVote === 1 ? 1 : myVote === -1 ? -1 : 0 };
}

export async function createPost(p: Omit<PostRecord, "up" | "down" | "score" | "comments">) {
  const record: PostRecord = { ...p, up: 0, down: 0, score: 0, comments: 0 };
  const tx = redis.multi();
  tx.hset(K.post(p.id), Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)])));
  tx.zadd(BOARD.new, { score: p.createdAt, member: p.id });
  tx.zadd(BOARD.top, { score: 0, member: p.id });
  tx.zadd(BOARD.hot, { score: hotScore(0, p.createdAt), member: p.id });
  tx.zadd(BOARD.discussed, { score: 0, member: p.id });
  tx.zadd(K.userPosts(p.authorId), { score: p.createdAt, member: p.id });
  await tx.exec();
  return record;
}

export async function getPostRecord(id: string) {
  return parsePost(await redis.hgetall(K.post(id)));
}

export async function listPosts(opts: {
  sort: SortId;
  offset: number;
  viewerId: string;
  byUser?: string;
  limit?: number;
}): Promise<{ posts: PostView[]; nextOffset: number | null }> {
  const limit = opts.limit ?? PAGE_SIZE;
  const key = opts.byUser ? K.userPosts(opts.byUser) : BOARD[opts.sort];
  const ids = (await redis.zrange(key, opts.offset, opts.offset + limit - 1, { rev: true })) as string[];
  if (ids.length === 0) return { posts: [], nextOffset: null };

  const pipe = redis.pipeline();
  for (const id of ids) {
    pipe.hgetall(K.post(id));
    pipe.hget(K.votes(id), opts.viewerId);
  }
  const res = (await pipe.exec()) as unknown[];

  const posts = await Promise.all(
    ids.map((_, i) => {
      const rec = parsePost(res[i * 2]);
      return rec ? toView(rec, Number(res[i * 2 + 1] ?? 0)) : null;
    }),
  );
  return {
    posts: posts.filter((p): p is PostView => p !== null),
    nextOffset: ids.length === limit ? opts.offset + limit : null,
  };
}

export async function getPostDetail(id: string, viewerId: string): Promise<PostDetail | null> {
  const [hash, myVote, rxRaw, mine] = (await redis
    .pipeline()
    .hgetall(K.post(id))
    .hget(K.votes(id), viewerId)
    .hgetall(K.reactions(id))
    .hget(K.userReactions(id), viewerId)
    .exec()) as [unknown, string | null, unknown, string | null];
  const rx = toHash(rxRaw);

  const rec = parsePost(hash);
  if (!rec) return null;
  const view = await toView(rec, Number(myVote ?? 0));
  const reactions: Record<string, number> = {};
  for (const [emoji, n] of Object.entries(rx ?? {})) {
    const count = Number(n) || 0;
    if (count > 0 && isEmoji(emoji)) reactions[emoji] = count;
  }
  const myReactions = (mine ?? "").split(",").filter(isEmoji);
  return { ...view, reactions, myReactions };
}

export async function vote(id: string, userId: string, value: -1 | 0 | 1) {
  const res = await voteScript.exec(
    [K.post(id), K.votes(id), BOARD.top, BOARD.hot],
    [userId, String(value), id],
  );
  if (!res) return null;
  const [up, down, v] = res.map(Number) as [number, number, number];
  return { up, down, score: up - down, myVote: v };
}

export type ReactResult =
  | { ok: true; on: boolean; count: number }
  | { ok: false; reason: "post-full" | "user-limit" };

export async function toggleReaction(id: string, userId: string, emoji: string): Promise<ReactResult | null> {
  const res = await reactScript.exec(
    [K.post(id), K.reactions(id), K.userReactions(id)],
    [userId, emoji, String(MAX_DISTINCT_REACTIONS), String(MAX_REACTIONS_PER_USER)],
  );
  if (!res) return null;
  const code = Number(res[0]);
  if (code === -1) return { ok: false, reason: "post-full" };
  if (code === -2) return { ok: false, reason: "user-limit" };
  return { ok: true, on: code === 1, count: Math.max(0, Number(res[1])) };
}

export async function deletePost(p: PostRecord) {
  const commentIds = (await redis.zrange(K.comments(p.id), 0, -1)) as string[];
  const tx = redis.multi();
  tx.del(K.post(p.id), K.votes(p.id), K.reactions(p.id), K.userReactions(p.id), K.comments(p.id));
  if (commentIds.length) tx.del(...commentIds.map(K.comment));
  for (const z of Object.values(BOARD)) tx.zrem(z, p.id);
  tx.zrem(K.userPosts(p.authorId), p.id);
  await tx.exec();
  await deleteObjects([p.mediaKey, p.thumbKey].filter(Boolean));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

function parseComment(r: Record<string, string>): CommentView & { postId: string } {
  const deleted = r.deleted === "1";
  return {
    id: r.id!,
    postId: r.postId ?? "",
    parentId: r.parentId || null,
    depth: Math.min(COMMENT_MAX_DEPTH, Number(r.depth) || 0),
    deleted,
    authorId: deleted ? "" : (r.authorId ?? ""),
    authorName: deleted ? "" : (r.authorName ?? ""),
    body: deleted ? "" : (r.body ?? ""),
    createdAt: Number(r.createdAt) || 0,
  };
}

/** Flat list in creation order; the client builds the tree from parentId. */
export async function listComments(postId: string, limit = 500): Promise<CommentView[]> {
  const ids = (await redis.zrange(K.comments(postId), 0, limit - 1)) as string[];
  if (!ids.length) return [];
  const pipe = redis.pipeline();
  for (const cid of ids) pipe.hgetall(K.comment(cid));
  const rows = ((await pipe.exec()) as unknown[]).map(toHash);
  return rows
    .filter((r): r is Record<string, string> => !!r?.id)
    .map((r) => {
      const { postId: _p, ...c } = parseComment(r);
      return c;
    });
}

export async function getComment(cid: string) {
  const r = toHash(await redis.hgetall(K.comment(cid)));
  return r?.id ? parseComment(r) : null;
}

export type AddCommentResult = { ok: true; comment: CommentView; count: number } | { ok: false; reason: "post-gone" | "parent-gone" };

export async function addComment(
  postId: string,
  c: { authorId: string; authorName: string; body: string },
  replyTo?: string,
): Promise<AddCommentResult> {
  let parentId = "";
  let depth = 0;
  if (replyTo) {
    const parent = await getComment(replyTo);
    if (!parent || parent.postId !== postId || parent.deleted) return { ok: false, reason: "parent-gone" };
    if (parent.depth >= COMMENT_MAX_DEPTH && parent.parentId) {
      // Too deep: sit next to the comment being answered instead of under it.
      parentId = parent.parentId;
      depth = parent.depth;
    } else {
      parentId = parent.id;
      depth = parent.depth + 1;
    }
  }

  const comment: CommentView = { ...c, id: newId(), createdAt: Date.now(), parentId: parentId || null, depth, deleted: false };
  const n = await addCommentScript.exec(
    [K.post(postId), K.comments(postId), K.comment(comment.id), BOARD.discussed, K.comment(parentId || comment.id)],
    [comment.id, postId, c.authorId, c.authorName, c.body, String(comment.createdAt), parentId, String(depth)],
  );
  if (n == null) return { ok: false, reason: "post-gone" };
  if (Number(n) === -1) return { ok: false, reason: "parent-gone" };
  return { ok: true, comment, count: Number(n) };
}

/** Deletes a comment (or turns it into a placeholder), then removes placeholders left with no replies. */
export async function deleteComment(postId: string, cid: string) {
  let current: string | null = cid;
  for (let step = 0; current && step <= COMMENT_MAX_DEPTH + 1; step++) {
    const c = await getComment(current);
    if (!c) return step > 0;
    const res = await deleteCommentScript.exec(
      [K.post(postId), K.comments(postId), K.comment(c.id), BOARD.discussed, K.comment(c.parentId ?? c.id)],
      [c.id, postId, c.parentId ? "1" : "0"],
    );
    if (res == null) return step > 0;
    current = Number(res) === 2 ? c.parentId : null;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

export async function isBanned(userId: string) {
  return Number(await redis.sismember(K.banned, userId)) === 1;
}

export async function setBanned(userId: string, banned: boolean) {
  if (banned) await redis.sadd(K.banned, userId);
  else await redis.srem(K.banned, userId);
}
