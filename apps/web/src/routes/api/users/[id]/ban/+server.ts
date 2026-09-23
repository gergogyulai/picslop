import { error, json } from "@sveltejs/kit";

import { readJson, requireAdmin } from "$lib/server/guard";
import { setBanned } from "$lib/server/posts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const admin = requireAdmin(locals);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) error(404, "Not found.");
  if (params.id === admin.id) error(400, "You can't ban yourself.");
  const { banned } = await readJson(request);
  if (typeof banned !== "boolean") error(400, "Invalid request.");
  await setBanned(params.id, banned);
  return json({ banned });
};
