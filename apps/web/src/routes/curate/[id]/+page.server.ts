import { error } from "@sveltejs/kit";

import { getSet, getSetLog } from "$lib/server/sets";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const set = await getSet(params.id);
  if (!set) error(404, "Set not found.");
  return { set, log: await getSetLog(set.id, 40), isReviewer: locals.isReviewer };
};
