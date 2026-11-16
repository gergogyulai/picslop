import { error } from "@sveltejs/kit";

import { getSet } from "$lib/server/sets";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const set = await getSet(params.id);
  if (!set) error(404, "Set not found.");
  return { set };
};
