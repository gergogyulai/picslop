import { createAuth } from "@picslop/auth";
import { createDb } from "@picslop/db";

import { ENV } from "./env.server";
import { isEmailAllowed } from "$lib/server/access";
import { sendMagicLinkEmail } from "$lib/server/email";
import { limits } from "$lib/server/ratelimit";
import { authStorage } from "$lib/server/redis";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db, {
  isEmailAllowed,
  allowMagicLinkFor: async (email) => (await limits.magicLinkPerEmail.limit(email)).success,
  sendMagicLink: sendMagicLinkEmail,
  secondaryStorage: authStorage,
});
