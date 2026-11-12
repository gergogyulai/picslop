import { error, json } from "@sveltejs/kit";

import { isAdminEmail } from "$lib/server/access";
import { findUser, revokeSessions } from "$lib/server/admin";
import { readJson, requireAdmin } from "$lib/server/guard";
import { isPromotedAdmin, setBanned } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

/** Ban or unban. `signOut: true` also ends all of their sessions. Admins have to be demoted first. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const admin = requireAdmin(locals);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) error(404, "Not found.");
  if (params.id === admin.id) error(400, "You can't ban yourself.");
  const { banned, signOut } = await readJson(request);
  if (typeof banned !== "boolean") error(400, "Invalid request.");
  if (banned) {
    const target = await findUser(params.id);
    if (target && (isAdminEmail(target.email) || (await isPromotedAdmin(target.id)))) {
      error(400, "Admins can't be banned. Demote them first.");
    }
  }
  await setBanned(params.id, banned);
  if (banned && signOut === true) await revokeSessions(params.id);
  return json({ banned });
};
