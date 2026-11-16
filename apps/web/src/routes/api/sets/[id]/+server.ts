import { error, json } from "@sveltejs/kit";

import { displayName, readJson, requireCurator } from "$lib/server/guard";
import { enforce, limits } from "$lib/server/ratelimit";
import { deleteSet, getSet, isValidSetId, parseSetName, renameSet } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/** Rename a set. */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id)) error(404, "Set not found.");
  const { name } = await readJson(request);
  await enforce(user.id, limits.curate);
  if (!(await renameSet(params.id, parseSetName(name), { id: user.id, name: displayName(user) }))) error(404, "Set not found.");
  return json({ ok: true });
};

/** Delete a set (the board posts in it are untouched). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id) || !(await getSet(params.id))) error(404, "Set not found.");
  await enforce(user.id, limits.curate);
  await deleteSet(params.id);
  return json({ ok: true });
};
