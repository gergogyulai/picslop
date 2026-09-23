import { Redis } from "@upstash/redis";
import type { SecondaryStorage } from "better-auth";

import { ENV } from "../../env.server";

/** Raw client: values come back exactly as stored (strings), we parse them ourselves. */
export const redis = new Redis({
  url: ENV.UPSTASH_REDIS_REST_URL,
  token: ENV.UPSTASH_REDIS_REST_TOKEN,
  automaticDeserialization: false,
});

/** Default client for @upstash/ratelimit, which expects automatic deserialization. */
export const redisForRatelimit = new Redis({
  url: ENV.UPSTASH_REDIS_REST_URL,
  token: ENV.UPSTASH_REDIS_REST_TOKEN,
});

const INCREMENT_SCRIPT = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

export const authStorage: SecondaryStorage = {
  get: (key) => redis.get<string>(`ba:${key}`),
  getAndDelete: (key) => redis.getdel<string>(`ba:${key}`),
  increment: async (key, ttl) =>
    Number(await redis.eval(INCREMENT_SCRIPT, [`ba:${key}`], [String(Math.max(1, Math.ceil(ttl)))])),
  set: async (key, value, ttl) => {
    if (ttl && ttl > 0) await redis.set(`ba:${key}`, value, { ex: Math.ceil(ttl) });
    else await redis.set(`ba:${key}`, value);
  },
  delete: async (key) => {
    await redis.del(`ba:${key}`);
  },
};
