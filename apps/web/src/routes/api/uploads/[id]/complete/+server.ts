import { error, json } from "@sveltejs/kit";

import { requireActiveUser } from "$lib/server/guard";
import { isValidId } from "$lib/server/posts";
import { UploadError, completeUpload } from "$lib/server/uploads";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals }) => {
  const user = await requireActiveUser(locals);
  if (!isValidId(params.id)) error(404, "Not found.");
  try {
    return json(await completeUpload(params.id, user.id));
  } catch (e) {
    if (e instanceof UploadError) error(e.status, e.message);
    throw e;
  }
};
