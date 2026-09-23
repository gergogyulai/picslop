import { Ratelimit } from "@upstash/ratelimit";
import { error } from "@sveltejs/kit";

import { redisForRatelimit as redis } from "./redis";

const make = (prefix: string, limiter: ReturnType<typeof Ratelimit.slidingWindow>) =>
  new Ratelimit({ redis, prefix: `rl:${prefix}`, limiter, ephemeralCache: new Map() });

export const limits = {
  magicLinkPerEmail: make("ml", Ratelimit.slidingWindow(3, "15 m")),
  // Counted per file, not per request, so bulk uploads use the same budget.
  uploadBurst: make("up:b", Ratelimit.slidingWindow(60, "10 m")),
  uploadDaily: make("up:d", Ratelimit.slidingWindow(150, "1 d")),
  vote: make("vote", Ratelimit.slidingWindow(120, "1 m")),
  react: make("react", Ratelimit.slidingWindow(90, "1 m")),
  comment: make("cmt", Ratelimit.slidingWindow(8, "1 m")),
  commentDaily: make("cmt:d", Ratelimit.slidingWindow(300, "1 d")),
  read: make("read", Ratelimit.slidingWindow(300, "1 m")),
};

/** Throws 429 if any of the given limiters rejects this identifier. */
export async function enforce(id: string, ...limiters: Ratelimit[]) {
  await enforceCost(id, 1, ...limiters);
}

/** Like enforce, but one call spends `cost` units (e.g. one per file in a bulk upload). */
export async function enforceCost(id: string, cost: number, ...limiters: Ratelimit[]) {
  for (const l of limiters) {
    const { success, reset } = await l.limit(id, { rate: cost });
    if (!success) {
      const secs = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      if (cost > 1) {
        error(429, `That's more uploads than you have left right now — try fewer files, or wait ${secs < 90 ? `${secs}s` : `${Math.ceil(secs / 60)} min`}.`);
      }
      error(429, `Slow down — try again in ${secs < 90 ? `${secs}s` : `${Math.ceil(secs / 60)} min`}.`);
    }
  }
}
