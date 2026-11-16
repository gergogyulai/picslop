import { error } from "@sveltejs/kit";

import type { LayoutServerLoad } from "./$types";

/** Only reviewers approve or veto. Admin or curator alone isn't enough. */
export const load: LayoutServerLoad = ({ locals }) => {
  if (!locals.isReviewer) error(404, "Not found.");
  return {};
};
