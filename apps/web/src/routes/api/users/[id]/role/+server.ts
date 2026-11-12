import { error, json } from "@sveltejs/kit";

import { isAdminEmail } from "$lib/server/access";
import { findUser } from "$lib/server/admin";
import { readJson, requireAdmin } from "$lib/server/guard";
import { setBanned, setCurator, setPromotedAdmin } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

const ROLES = ["admin", "curator", "member"] as const;

/**
 * Admins set someone's role: admin (full dashboard access), curator (can pick posts) or member.
 * ADMIN_EMAILS owners are fixed by config and can't be changed here; nobody can change their own role.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const me = requireAdmin(locals);
  const { role } = await readJson(request);
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) error(400, "Invalid role.");
  if (params.id === me.id) error(400, "You can't change your own role.");
  const target = await findUser(params.id);
  if (!target) error(404, "User not found.");
  if (isAdminEmail(target.email)) error(400, "Owners are set in ADMIN_EMAILS and can't be changed here.");

  await Promise.all([
    setPromotedAdmin(target.id, role === "admin"),
    setCurator(target.id, role === "curator"),
    // Admins can't be banned, so promoting someone lifts any ban they had.
    role === "admin" ? setBanned(target.id, false) : null,
  ]);
  return json({ role });
};
