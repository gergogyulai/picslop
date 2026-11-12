import { error, json } from "@sveltejs/kit";

import { canPick, displayName, readJson, requireActiveUser } from "$lib/server/guard";
import { isValidId, setPicked } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

/** Admins and curators cherrypick a post onto (or off) the Picked board. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireActiveUser(locals);
  if (!(await canPick(locals))) error(403, "Only curators can pick posts.");
  if (!isValidId(params.id)) error(404, "Not found.");
  const { picked } = await readJson(request);
  if (typeof picked !== "boolean") error(400, "Invalid request.");
  await enforce(user.id, limits.pick);
  const pickedBy = await setPicked(params.id, picked, displayName(user));
  if (pickedBy === null) error(404, "Not found.");
  return json({ picked: pickedBy !== "", pickedBy });
};
