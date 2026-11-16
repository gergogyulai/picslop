import { error, json } from "@sveltejs/kit";

import { displayName, readJson, requireCurator } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, replaceItem } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/**
 * Swap a vetoed image for a different one. The replacement takes the same place in the order and
 * goes back to the reviewers as pending; the vetoed image leaves the set for good.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id) || !isValidId(params.postId)) error(404, "Not found.");
  const { postId } = await readJson(request);
  if (typeof postId !== "string" || !isValidId(postId)) error(400, "Invalid image.");
  await enforce(user.id, limits.curate);
  await replaceItem(params.id, params.postId, postId, { id: user.id, name: displayName(user) });
  return json({ ok: true });
};
