import { error, json } from "@sveltejs/kit";

import { displayName, requireCurator } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, removeItem } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/** Take a pending or approved image out of a set. Vetoed ones have to be replaced instead. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id) || !isValidId(params.postId)) error(404, "Not found.");
  await enforce(user.id, limits.curate);
  await removeItem(params.id, params.postId, { id: user.id, name: displayName(user) });
  return json({ ok: true });
};
