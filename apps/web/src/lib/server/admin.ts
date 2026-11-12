import { ObjectId } from "@picslop/db";

import { isAdminEmail } from "./access";
import { BOARD, K, parsePost, toHash, type PostRecord } from "./posts";
import { presignGet } from "./r2";
import { redis } from "./redis";

// Imported lazily: services connects to Mongo at module load, and route modules are also loaded
// at build time (SvelteKit's analysis step) where there's no database to reach.
const services = () => import("../../services");

/** Posts per Redis round trip while scanning the whole board. */
const CHUNK = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Role = "owner" | "admin" | "curator" | "member";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  joinedAt: number;
  /** Most recent session activity (sliding expiry refreshes this about once a day); 0 = no live session. */
  lastSeenAt: number;
  role: Role;
  banned: boolean;
  passkeys: number;
  posts: number;
  points: number;
  picked: number;
  lastPostAt: number;
};

type AuthorAgg = { posts: number; points: number; picked: number; lastPostAt: number; name: string };

export type BoardStats = {
  posts: number;
  images: number;
  videos: number;
  videoSeconds: number;
  up: number;
  down: number;
  comments: number;
  reactions: number;
  authors: number;
};

export type DashboardStats = {
  generatedAt: number;
  all: BoardStats;
  picked: BoardStats & { pickers: { name: string; count: number }[] };
  /** Last 30 days, oldest first. */
  daily: { day: string; posts: number; picked: number }[];
  /** Last 12 weeks of sign-ups, oldest first (weeks start Monday, UTC). */
  weeklySignups: { week: string; users: number }[];
  users: { total: number; banned: number; curators: number; admins: number; uploaders: number; activeLast7d: number };
  topPosts: { id: string; caption: string; authorId: string; authorName: string; score: number; comments: number; kind: string; thumbUrl: string; picked: boolean }[];
  topReactions: { emoji: string; count: number }[];
  topUploaders: { id: string; name: string; posts: number; points: number }[];
};

const emptyBoard = (): BoardStats => ({ posts: 0, images: 0, videos: 0, videoSeconds: 0, up: 0, down: 0, comments: 0, reactions: 0, authors: 0 });

function addTo(b: BoardStats, p: PostRecord, rx: number) {
  b.posts++;
  if (p.kind === "video") {
    b.videos++;
    b.videoSeconds += p.duration;
  } else b.images++;
  b.up += p.up;
  b.down += p.down;
  b.comments += p.comments;
  b.reactions += rx;
}

/** One pass over every post: totals for both boards, per-author aggregates, reactions, daily activity. */
async function scanPosts() {
  const ids = (await redis.zrange(BOARD.new, 0, -1, { rev: true })) as string[];
  const all = emptyBoard();
  const picked = emptyBoard();
  const byAuthor = new Map<string, AuthorAgg>();
  const pickedAuthors = new Set<string>();
  const pickers = new Map<string, number>();
  const emoji = new Map<string, number>();
  const pickedAtById = new Map<string, number>();
  const records: PostRecord[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const pipe = redis.pipeline();
    for (const id of chunk) {
      pipe.hgetall(K.post(id));
      pipe.hgetall(K.reactions(id));
    }
    const res = (await pipe.exec()) as unknown[];
    for (let j = 0; j < chunk.length; j++) {
      const hash = toHash(res[j * 2]);
      const p = parsePost(hash);
      if (!p) continue;
      records.push(p);

      let rx = 0;
      for (const [e, n] of Object.entries(toHash(res[j * 2 + 1]) ?? {})) {
        const c = Number(n) || 0;
        if (c <= 0) continue;
        rx += c;
        emoji.set(e, (emoji.get(e) ?? 0) + c);
      }
      addTo(all, p, rx);

      const a = byAuthor.get(p.authorId) ?? { posts: 0, points: 0, picked: 0, lastPostAt: 0, name: p.authorName };
      a.posts++;
      a.points += p.score;
      if (p.createdAt > a.lastPostAt) {
        a.lastPostAt = p.createdAt;
        a.name = p.authorName || a.name;
      }
      if (p.pickedBy) {
        a.picked++;
        addTo(picked, p, rx);
        pickedAuthors.add(p.authorId);
        pickers.set(p.pickedBy, (pickers.get(p.pickedBy) ?? 0) + 1);
        pickedAtById.set(p.id, Number(hash?.pickedAt) || 0);
      }
      byAuthor.set(p.authorId, a);
    }
  }
  all.authors = byAuthor.size;
  picked.authors = pickedAuthors.size;
  return { all, picked, byAuthor, pickers, emoji, records, pickedAtById };
}

type UserDoc = { _id: ObjectId; name?: string; email: string; createdAt?: Date };

async function loadUsers() {
  const { db } = await services();
  const [docs, passkeys, banned, curators, admins] = await Promise.all([
    db
      .collection<UserDoc>("user")
      .find({}, { projection: { name: 1, email: 1, createdAt: 1 } })
      .toArray(),
    db
      .collection("passkey")
      .aggregate<{ _id: ObjectId | string; n: number }>([{ $group: { _id: "$userId", n: { $sum: 1 } } }])
      .toArray(),
    redis.smembers(K.banned) as Promise<string[]>,
    redis.smembers(K.curators) as Promise<string[]>,
    redis.smembers(K.admins) as Promise<string[]>,
  ]);
  return {
    docs,
    passkeys: new Map(passkeys.map((p) => [String(p._id), p.n])),
    banned: new Set(banned),
    curators: new Set(curators),
    admins: new Set(admins),
  };
}

export function roleOf(u: { id: string; email: string }, admins: Set<string>, curators: Set<string>): Role {
  if (isAdminEmail(u.email)) return "owner";
  if (admins.has(u.id)) return "admin";
  if (curators.has(u.id)) return "curator";
  return "member";
}

async function lastSeen(userIds: string[]) {
  const ctx = await (await services()).auth.$context;
  const out = new Map<string, number>();
  // Each lookup is a couple of Redis reads; keep a handful in flight at once.
  for (let i = 0; i < userIds.length; i += 20) {
    const batch = userIds.slice(i, i + 20);
    const rows = await Promise.all(
      batch.map((id) => ctx.internalAdapter.listSessions(id, { onlyActiveSessions: true }).catch(() => [])),
    );
    rows.forEach((sessions, k) => {
      let t = 0;
      for (const s of sessions) t = Math.max(t, new Date(s.updatedAt ?? s.createdAt).getTime() || 0);
      out.set(batch[k]!, t);
    });
  }
  return out;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const [{ byAuthor }, u] = await Promise.all([scanPosts(), loadUsers()]);
  const ids = u.docs.map((d) => d._id.toHexString());
  const seen = await lastSeen(ids);
  return u.docs.map((d, i) => {
    const id = ids[i]!;
    const a = byAuthor.get(id);
    return {
      id,
      name: d.name || d.email.split("@")[0]!,
      email: d.email,
      joinedAt: d.createdAt ? new Date(d.createdAt).getTime() : 0,
      lastSeenAt: seen.get(id) ?? 0,
      role: roleOf({ id, email: d.email }, u.admins, u.curators),
      banned: u.banned.has(id),
      passkeys: u.passkeys.get(id) ?? 0,
      posts: a?.posts ?? 0,
      points: a?.points ?? 0,
      picked: a?.picked ?? 0,
      lastPostAt: a?.lastPostAt ?? 0,
    };
  });
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function mondayOf(ms: number) {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

export async function dashboardStats(): Promise<DashboardStats> {
  const now = Date.now();
  const [scan, u] = await Promise.all([scanPosts(), loadUsers()]);
  const { all, picked, byAuthor, pickers, emoji, records, pickedAtById } = scan;

  // Daily uploads + picks, last 30 days (UTC).
  const days = new Map<string, { posts: number; picked: number }>();
  const start = new Date(now - 29 * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= now; t += DAY_MS) days.set(isoDay(t), { posts: 0, picked: 0 });
  for (const p of records) {
    const d = days.get(isoDay(p.createdAt));
    if (d) d.posts++;
    const at = pickedAtById.get(p.id);
    const pd = at ? days.get(isoDay(at)) : undefined;
    if (pd) pd.picked++;
  }

  // Weekly sign-ups, last 12 weeks.
  const weeks = new Map<number, number>();
  const firstWeek = mondayOf(now) - 11 * 7 * DAY_MS;
  for (let w = firstWeek; w <= now; w += 7 * DAY_MS) weeks.set(w, 0);
  for (const d of u.docs) {
    const t = d.createdAt ? new Date(d.createdAt).getTime() : 0;
    const w = mondayOf(t);
    if (weeks.has(w)) weeks.set(w, weeks.get(w)! + 1);
  }

  const ids = new Set(u.docs.map((d) => d._id.toHexString()));
  const emails = new Map(u.docs.map((d) => [d._id.toHexString(), d.email]));
  let admins = 0;
  for (const id of ids) if (roleOf({ id, email: emails.get(id)! }, u.admins, u.curators) === "owner" || u.admins.has(id)) admins++;

  const top = [...records].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt).slice(0, 8);
  const topPosts = await Promise.all(
    top.map(async (p) => ({
      id: p.id,
      caption: p.caption,
      authorId: p.authorId,
      authorName: p.authorName,
      score: p.score,
      comments: p.comments,
      kind: p.kind,
      thumbUrl: await presignGet(p.thumbKey),
      picked: !!p.pickedBy,
    })),
  );

  return {
    generatedAt: now,
    all,
    picked: { ...picked, pickers: [...pickers].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) },
    daily: [...days].map(([day, v]) => ({ day, ...v })),
    weeklySignups: [...weeks].map(([w, users]) => ({ week: isoDay(w), users })),
    users: {
      total: u.docs.length,
      banned: [...u.banned].filter((id) => ids.has(id)).length,
      curators: [...u.curators].filter((id) => ids.has(id) && !u.admins.has(id) && !isAdminEmail(emails.get(id))).length,
      admins,
      uploaders: [...byAuthor.keys()].filter((id) => ids.has(id)).length,
      activeLast7d: [...byAuthor.values()].filter((a) => a.lastPostAt > now - 7 * DAY_MS).length,
    },
    topPosts,
    topReactions: [...emoji].map(([e, count]) => ({ emoji: e, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    topUploaders: [...byAuthor]
      .map(([id, a]) => ({ id, name: a.name, posts: a.posts, points: a.points }))
      .sort((a, b) => b.posts - a.posts || b.points - a.points)
      .slice(0, 8),
  };
}

/** Kills every session the user has (they'll need a fresh email link or passkey to get back in). */
export async function revokeSessions(userId: string) {
  const ctx = await (await services()).auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/** Looks a user up by id in the auth database; null when there's no such account. */
export async function findUser(userId: string) {
  if (!/^[0-9a-f]{24}$/i.test(userId)) return null;
  const { db } = await services();
  const d = await db.collection<UserDoc>("user").findOne({ _id: new ObjectId(userId) }, { projection: { email: 1, name: 1 } });
  return d ? { id: userId, email: d.email, name: d.name ?? "" } : null;
}
