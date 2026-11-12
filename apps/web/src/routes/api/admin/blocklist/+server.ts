import { error, json } from "@sveltejs/kit";

import { isAdminEmail } from "$lib/server/access";
import { findUserIdByEmail, revokeSessions } from "$lib/server/admin";
import { blockEmail, normalizeEmail, unblockEmail } from "$lib/server/blocklist";
import { displayName, readJson, requireAdmin } from "$lib/server/guard";
import { isPromotedAdmin } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

async function readEmail(request: Request) {
  const body = await readJson(request);
  if (typeof body.email !== "string") error(400, "Email required.");
  const email = normalizeEmail(body.email);
  if (!EMAIL.test(email)) error(400, "That doesn't look like an email address.");
  return { email, reason: typeof body.reason === "string" ? body.reason.trim() : "" };
}

/** Blacklist an address (existing account or not). Any account it has is signed out everywhere. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const me = requireAdmin(locals);
  const { email, reason } = await readEmail(request);
  if (isAdminEmail(email)) error(400, "Owners are set in ADMIN_EMAILS and can't be blacklisted.");
  if (email === normalizeEmail(me.email)) error(400, "You can't blacklist yourself.");

  const userId = await findUserIdByEmail(email);
  if (userId && (await isPromotedAdmin(userId))) error(400, "Demote this admin before blacklisting them.");

  const entry = await blockEmail(email, displayName(me), reason);
  if (userId) await revokeSessions(userId);
  return json(entry);
};

/** Lift a blacklist entry. They can sign in again if the allowlist still lets them. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const { email } = await readEmail(request);
  if (!(await unblockEmail(email))) error(404, "That address isn't blacklisted.");
  return json({ ok: true });
};
