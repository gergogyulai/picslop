import { error, json } from "@sveltejs/kit";

import { SET_MAX_ITEMS } from "$lib/sets";
import { displayName, readJson, requireCurator } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, reorder } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/**
 * Save the video order. `order` is every image in the set, first to last; `rev` is the set's
 * revision the editor last saw. Reordering never touches approvals.
 */
export const PUT: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id)) error(404, "Set not found.");
  const { rev, order } = await readJson(request, 64 * 1024);
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) error(400, "Invalid revision.");
  if (!Array.isArray(order) || order.length > SET_MAX_ITEMS || !order.every((p) => typeof p === "string" && isValidId(p))) {
    error(400, "Invalid order.");
  }
  await enforce(user.id, limits.curate);
  const next = await reorder(params.id, rev, order as string[], { id: user.id, name: displayName(user) });
  return json({ rev: next });
};
