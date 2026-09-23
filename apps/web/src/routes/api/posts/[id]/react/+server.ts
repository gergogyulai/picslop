import { error, json } from "@sveltejs/kit";

import { MAX_DISTINCT_REACTIONS, MAX_REACTIONS_PER_USER, isEmoji } from "$lib/constants";
import { readJson, requireActiveUser } from "$lib/server/guard";
import { isValidId, toggleReaction } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireActiveUser(locals);
  if (!isValidId(params.id)) error(404, "Not found.");
  const { emoji } = await readJson(request);
  if (!isEmoji(emoji)) error(400, "Reactions must be a single emoji.");
  await enforce(user.id, limits.react);
  const res = await toggleReaction(params.id, user.id, emoji);
  if (!res) error(404, "Not found.");
  if (!res.ok) {
    error(
      400,
      res.reason === "post-full"
        ? `This post already has ${MAX_DISTINCT_REACTIONS} different reactions — pick one of those.`
        : `You can leave at most ${MAX_REACTIONS_PER_USER} reactions on one post.`,
    );
  }
  return json({ on: res.on, count: res.count });
};
