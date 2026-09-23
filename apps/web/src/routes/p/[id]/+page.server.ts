import { error } from "@sveltejs/kit";

import { requireUser } from "$lib/server/guard";
import { getPostDetail, isBanned, isValidId, listComments } from "$lib/server/posts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = requireUser(locals);
  if (!isValidId(params.id)) error(404, "Post not found.");
  const [post, comments] = await Promise.all([getPostDetail(params.id, user.id), listComments(params.id)]);
  if (!post) error(404, "Post not found.");
  return {
    post,
    comments,
    canDelete: post.authorId === user.id || locals.isAdmin,
    authorBanned: locals.isAdmin ? await isBanned(post.authorId) : false,
  };
};
