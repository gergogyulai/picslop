import { error, json } from "@sveltejs/kit";

import { deletePosts } from "$lib/server/admin";
import { readJson, requireAdmin } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

const MAX = 500;

/** Bulk delete: body `{ ids: string[] }`. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const body = await readJson(request, 64 * 1024);
  if (!Array.isArray(body.ids) || body.ids.length === 0) error(400, "No posts selected.");
  const ids = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && isValidId(id)))];
  if (ids.length === 0) error(400, "No valid post ids.");
  if (ids.length > MAX) error(400, `Delete at most ${MAX} posts at a time.`);
  return json(await deletePosts(ids));
};
