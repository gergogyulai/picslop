import { error, json } from "@sveltejs/kit";

import { findUser } from "$lib/server/admin";
import { readJson, requireAdmin } from "$lib/server/guard";
import { setReviewer } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

/**
 * Admins grant or revoke reviewer (approve/veto images in curated sets). It's independent of the
 * member/curator/admin role, so one person can be both a curator and a reviewer when the admin
 * allows it. Admins may grant it to anyone, themselves included.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  requireAdmin(locals);
  const { reviewer } = await readJson(request);
  if (typeof reviewer !== "boolean") error(400, "Invalid request.");
  const target = await findUser(params.id);
  if (!target) error(404, "User not found.");
  await setReviewer(target.id, reviewer);
  return json({ reviewer });
};
