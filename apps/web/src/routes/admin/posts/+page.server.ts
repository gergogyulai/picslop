import { listAdminPosts } from "$lib/server/admin";
import { requireAdmin } from "$lib/server/guard";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  return { posts: await listAdminPosts() };
};
