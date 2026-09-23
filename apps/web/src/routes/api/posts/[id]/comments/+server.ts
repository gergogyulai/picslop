import { error, json } from "@sveltejs/kit";

import { COMMENT_MAX } from "$lib/constants";
import { displayName, readJson, requireActiveUser } from "$lib/server/guard";
import { addComment, isValidId } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireActiveUser(locals);
  if (!isValidId(params.id)) error(404, "Not found.");
  const { body, parentId } = await readJson(request);
  if (parentId !== undefined && parentId !== null && (typeof parentId !== "string" || !isValidId(parentId))) {
    error(400, "Invalid reply target.");
  }
  if (typeof body !== "string") error(400, "Comment is empty.");
  const text = body
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) error(400, "Comment is empty.");
  if (text.length > COMMENT_MAX) error(400, `Comments can be at most ${COMMENT_MAX} characters.`);

  await enforce(user.id, limits.comment, limits.commentDaily);
  const res = await addComment(
    params.id,
    { authorId: user.id, authorName: displayName(user), body: text },
    parentId ?? undefined,
  );
  if (!res.ok) error(404, res.reason === "parent-gone" ? "That comment was deleted." : "Not found.");
  return json({ comment: res.comment, count: res.count });
};
