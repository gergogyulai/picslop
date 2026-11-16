import { error, json } from "@sveltejs/kit";

import { displayName, readJson, requireCurator } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { addItem, isValidSetId } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/** Curators add a board image to the end of a set. It starts as pending. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id)) error(404, "Set not found.");
  const { postId } = await readJson(request);
  if (typeof postId !== "string" || !isValidId(postId)) error(400, "Invalid image.");
  await enforce(user.id, limits.curate);
  const count = await addItem(params.id, postId, { id: user.id, name: displayName(user) });
  return json({ count });
};
