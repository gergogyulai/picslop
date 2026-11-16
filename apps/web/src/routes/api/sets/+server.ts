import { json } from "@sveltejs/kit";

import { displayName, readJson, requireCurator } from "$lib/server/guard";
import { enforce, limits } from "$lib/server/ratelimit";
import { createSet, parseSetName } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

/** Curators start a new, empty curated set. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const user = await requireCurator(locals);
  const { name } = await readJson(request);
  await enforce(user.id, limits.curate);
  const id = await createSet(parseSetName(name), { id: user.id, name: displayName(user) });
  return json({ id }, { status: 201 });
};
