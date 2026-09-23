import { error, json } from "@sveltejs/kit";

import { readJson, requireActiveUser } from "$lib/server/guard";
import { isValidId, vote } from "$lib/server/posts";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = await requireActiveUser(locals);
  if (!isValidId(params.id)) error(404, "Not found.");
  const { value } = await readJson(request);
  if (value !== 1 && value !== -1 && value !== 0) error(400, "Invalid vote.");
  await enforce(user.id, limits.vote);
  const res = await vote(params.id, user.id, value);
  if (!res) error(404, "Not found.");
  return json(res);
};
