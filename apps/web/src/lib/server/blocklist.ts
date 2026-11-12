import { K, toHash } from "./posts";
import { redis } from "./redis";

/**
 * Blacklisted email addresses. A blacklisted address can't request a sign-in link, can't have an
 * account created for it, can't start a session by any method (magic link or passkey), and any
 * session it already holds is rejected on the next request. This overrides every allowlist.
 */

export type BlockEntry = { email: string; at: number; by: string; reason: string };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function isEmailBlocked(email: string | null | undefined) {
  if (!email) return false;
  return Number(await redis.hexists(K.blocklist, normalizeEmail(email))) === 1;
}

export async function blockEmail(email: string, by: string, reason = "") {
  const entry: BlockEntry = { email: normalizeEmail(email), at: Date.now(), by, reason: reason.slice(0, 200) };
  await redis.hset(K.blocklist, { [entry.email]: JSON.stringify(entry) });
  return entry;
}

export async function unblockEmail(email: string) {
  return Number(await redis.hdel(K.blocklist, normalizeEmail(email))) > 0;
}

export async function listBlocked(): Promise<BlockEntry[]> {
  const h = toHash(await redis.hgetall(K.blocklist)) ?? {};
  return Object.entries(h)
    .map(([email, raw]) => {
      try {
        return { email, at: 0, by: "", reason: "", ...JSON.parse(raw) } as BlockEntry;
      } catch {
        return { email, at: 0, by: "", reason: "" };
      }
    })
    .sort((a, b) => b.at - a.at);
}

/** Both per-request checks in one round trip: is this user a promoted admin, is their address blacklisted. */
export async function sessionFlags(userId: string, email: string) {
  const [admin, blocked] = (await redis
    .pipeline()
    .sismember(K.admins, userId)
    .hexists(K.blocklist, normalizeEmail(email))
    .exec()) as [number, number];
  return { promotedAdmin: Number(admin) === 1, blocked: Number(blocked) === 1 };
}
