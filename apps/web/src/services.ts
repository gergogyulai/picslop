import { createAuth } from "@picslop/auth";
import { createDb } from "@picslop/db";

import { ENV } from "./env.server";
import { isAdminEmail, isEmailAllowed } from "$lib/server/access";
import { isEmailBlocked } from "$lib/server/blocklist";
import { sendMagicLinkEmail } from "$lib/server/email";
import { limits } from "$lib/server/ratelimit";
import { authStorage } from "$lib/server/redis";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db, {
  isEmailAllowed,
  // Owners (ADMIN_EMAILS) can never be locked out, even if their address somehow ends up blacklisted.
  isEmailBlocked: async (email) => !isAdminEmail(email) && (await isEmailBlocked(email)),
  allowMagicLinkFor: async (email) => (await limits.magicLinkPerEmail.limit(email)).success,
  sendMagicLink: sendMagicLinkEmail,
  secondaryStorage: authStorage,
});
