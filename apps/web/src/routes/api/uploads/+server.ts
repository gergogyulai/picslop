import { error, json } from "@sveltejs/kit";

import { BULK_MAX_FILES } from "$lib/constants";
import { clientIp, displayName, readJson, requireActiveUser } from "$lib/server/guard";
import { enforceCost, limits } from "$lib/server/ratelimit";
import { verifyTurnstile } from "$lib/server/turnstile";
import { UploadError, initUploads, type InitInput } from "$lib/server/uploads";
import type { RequestHandler } from "./$types";

/** Starts a batch of 1–BULK_MAX_FILES uploads behind a single human check. */
export const POST: RequestHandler = async (event) => {
  const user = await requireActiveUser(event.locals);
  const body = await readJson(event.request, 256 * 1024);
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) error(400, "Nothing to upload.");
  if (items.length > BULK_MAX_FILES) error(400, `You can upload at most ${BULK_MAX_FILES} files at once.`);
  if (!items.every((i) => i && typeof i === "object" && !Array.isArray(i))) error(400, "Invalid upload.");

  await verifyTurnstile(body.turnstile, clientIp(event));
  await enforceCost(user.id, items.length, limits.uploadBurst, limits.uploadDaily);

  try {
    return json({ uploads: await initUploads({ id: user.id, name: displayName(user) }, items as InitInput[]) });
  } catch (e) {
    if (e instanceof UploadError) error(e.status, e.message);
    throw e;
  }
};
