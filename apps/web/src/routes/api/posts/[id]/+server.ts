import { error, json } from "@sveltejs/kit";

import { requireUser } from "$lib/server/guard";
import { deletePost, getPostRecord, isValidId } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  if (!isValidId(params.id)) error(404, "Not found.");
  const post = await getPostRecord(params.id);
  if (!post) error(404, "Not found.");
  // Uploaders can always remove their own posts, even while banned.
  if (post.authorId !== user.id && !locals.isAdmin) error(403, "You can't delete this post.");
  await deletePost(post);
  return json({ ok: true });
};
