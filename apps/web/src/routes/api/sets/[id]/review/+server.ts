import { error, json } from "@sveltejs/kit";

import { SET_MAX_ITEMS, VETO_REASON_MAX } from "$lib/sets";
import { displayName, readJson, requireReviewer } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, reviewMany } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/**
 * Reviewers approve or veto several images in a set at once (`postIds`). A veto can carry one
 * short, optional reason, shared by every image. Images no longer in the set are skipped.
 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireReviewer(locals);
  if (!isValidSetId(params.id)) error(404, "Set not found.");
  const { postIds, state, reason } = await readJson(request);
  if (state !== "approved" && state !== "vetoed") error(400, "Invalid state.");
  if (!Array.isArray(postIds) || !postIds.length || postIds.length > SET_MAX_ITEMS) error(400, "Invalid images.");
  if (!postIds.every((id) => typeof id === "string" && isValidId(id))) error(400, "Invalid images.");
  if (reason !== undefined && reason !== null && typeof reason !== "string") error(400, "Invalid reason.");
  const why = state === "vetoed" ? (reason ?? "").trim().replace(/\s+/g, " ") : "";
  if (why.length > VETO_REASON_MAX) error(400, `Keep the reason under ${VETO_REASON_MAX} characters.`);
  await enforce(user.id, limits.review);
  const reviewed = await reviewMany(params.id, [...new Set(postIds as string[])], state, why, { id: user.id, name: displayName(user) });
  return json({ state, reviewed });
};
