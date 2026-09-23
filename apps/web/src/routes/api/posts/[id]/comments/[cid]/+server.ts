import { error, json } from "@sveltejs/kit";

import { requireUser } from "$lib/server/guard";
import { deleteComment, getComment, getPostRecord, isValidId, listComments } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  if (!isValidId(params.id) || !isValidId(params.cid)) error(404, "Not found.");
  const comment = await getComment(params.cid);
  if (!comment || comment.postId !== params.id || comment.deleted) error(404, "Not found.");
  if (comment.authorId !== user.id && !locals.isAdmin) error(403, "You can't delete this comment.");
  await deleteComment(params.id, params.cid);
  // Deleting can turn a comment into a placeholder or remove now-empty placeholders above it,
  // so hand back the fresh thread instead of making the client guess.
  const [comments, post] = await Promise.all([listComments(params.id), getPostRecord(params.id)]);
  return json({ comments, count: post?.comments ?? 0 });
};
