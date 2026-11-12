import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";

import { isAdminEmail } from "$lib/server/access";
import { findUser, purgeUser } from "$lib/server/admin";
import { displayName, readJson, requireAdmin } from "$lib/server/guard";
import { isPromotedAdmin } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

// Purging walks every post on the board to find their comments, votes and reactions.
export const config: Config = { maxDuration: 300 };

/**
 * Admins delete an account outright: posts, comments, votes, reactions, roles, sessions, passkeys
 * and the account itself. `blacklist: true` also blocks the address from ever signing in again.
 */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
  const me = requireAdmin(locals);
  if (params.id === me.id) error(400, "You can't delete your own account from here.");
  const { blacklist, reason } = await readJson(request);
  if (typeof blacklist !== "boolean") error(400, "Invalid request.");
  if (reason !== undefined && typeof reason !== "string") error(400, "Invalid reason.");
  const target = await findUser(params.id);
  if (!target) error(404, "User not found.");
  if (isAdminEmail(target.email)) error(400, "Owners are set in ADMIN_EMAILS and can't be deleted.");
  if (await isPromotedAdmin(target.id)) error(400, "Demote this admin before deleting them.");

  const summary = await purgeUser(target, { blacklist, by: displayName(me), reason: reason ?? "" });
  return json(summary);
};
