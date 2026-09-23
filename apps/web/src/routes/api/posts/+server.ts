import { error, json } from "@sveltejs/kit";

import { SORTS, type SortId } from "$lib/constants";
import { requireUser } from "$lib/server/guard";
import { listPosts } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireUser(locals);
  await enforce(user.id, limits.read);

  const sort = (url.searchParams.get("sort") ?? "hot") as SortId;
  if (!SORTS.some((s) => s.id === sort)) error(400, "Invalid sort.");
  const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get("offset")) || 0));
  const byUser = url.searchParams.get("user") ?? undefined;
  if (byUser !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(byUser)) error(400, "Invalid user.");

  return json(await listPosts({ sort, offset, viewerId: user.id, byUser }));
};

