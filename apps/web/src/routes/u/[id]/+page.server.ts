import { error } from "@sveltejs/kit";

import { displayName, requireUser } from "$lib/server/guard";
import { isBanned, listPosts } from "$lib/server/posts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const user = requireUser(locals);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) error(404, "User not found.");
  const page = await listPosts({ sort: "new", offset: 0, viewerId: user.id, byUser: params.id });
  const isMe = params.id === user.id;
  return {
    userId: params.id,
    name: isMe ? displayName(locals.user!) : (page.posts[0]?.authorName ?? null),
    isMe,
    banned: locals.isAdmin || isMe ? await isBanned(params.id) : false,
    ...page,
  };
};
