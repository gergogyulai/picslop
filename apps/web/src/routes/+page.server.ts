import { error } from "@sveltejs/kit";

import { SORTS, type SortId } from "$lib/constants";
import { requireUser } from "$lib/server/guard";
import { listPosts } from "$lib/server/posts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const user = requireUser(locals);
  const sort = (url.searchParams.get("sort") ?? "hot") as SortId;
  if (!SORTS.some((s) => s.id === sort)) error(400, "Unknown sort.");
  const page = await listPosts({ sort, offset: 0, viewerId: user.id });
  return { sort, ...page };
};
