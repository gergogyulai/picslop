import { error, json } from "@sveltejs/kit";

import { VETO_REASON_MAX } from "$lib/sets";
import { displayName, readJson, requireReviewer } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, review } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/** Reviewers approve or veto an image in a set. A veto can carry a short, optional reason. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireReviewer(locals);
  if (!isValidSetId(params.id) || !isValidId(params.postId)) error(404, "Not found.");
  const { state, reason } = await readJson(request);
  if (state !== "approved" && state !== "vetoed") error(400, "Invalid state.");
  if (reason !== undefined && reason !== null && typeof reason !== "string") error(400, "Invalid reason.");
  const why = state === "vetoed" ? (reason ?? "").trim().replace(/\s+/g, " ") : "";
  if (why.length > VETO_REASON_MAX) error(400, `Keep the reason under ${VETO_REASON_MAX} characters.`);
  await enforce(user.id, limits.review);
  await review(params.id, params.postId, state, why, { id: user.id, name: displayName(user) });
  return json({ state });
};
