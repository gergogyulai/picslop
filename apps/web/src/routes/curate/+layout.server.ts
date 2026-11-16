import { error } from "@sveltejs/kit";

import { canCurate } from "$lib/server/guard";
import type { LayoutServerLoad } from "./$types";

/** The curator dashboard only exists for curators (and admins). Everyone else gets a plain 404. */
export const load: LayoutServerLoad = ({ locals }) => {
  if (!canCurate(locals)) error(404, "Not found.");
  return {};
};
