import { error, json } from "@sveltejs/kit";

import { readJson, requireAdmin } from "$lib/server/guard";
import { setCurator } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

/** Admins grant or revoke a user's curator role (cherrypicking posts onto the Picked board). */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  requireAdmin(locals);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) error(404, "Not found.");
  const { curator } = await readJson(request);
  if (typeof curator !== "boolean") error(400, "Invalid request.");
  await setCurator(params.id, curator);
  return json({ curator });
};
