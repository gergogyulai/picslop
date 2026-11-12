import { error, json } from "@sveltejs/kit";

import { isAdminEmail } from "$lib/server/access";
import { findUser, revokeSessions } from "$lib/server/admin";
import { requireAdmin } from "$lib/server/guard";
import type { RequestHandler } from "./$types";

/** Admins sign a user out on every device. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const me = requireAdmin(locals);
  if (params.id === me.id) error(400, "Use sign out for your own account.");
  const target = await findUser(params.id);
  if (!target) error(404, "User not found.");
  if (isAdminEmail(target.email)) error(400, "Owners can't be signed out from here.");
  await revokeSessions(target.id);
  return json({ ok: true });
};
