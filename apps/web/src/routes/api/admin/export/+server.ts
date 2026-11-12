import type { Config } from "@sveltejs/adapter-vercel";
import { downloadZip } from "client-zip";

import { exportEntries } from "$lib/server/export";
import { requireAdmin } from "$lib/server/guard";
import { enforce, limits } from "$lib/server/ratelimit";
import type { RequestHandler } from "./$types";

// The zip streams out as it is built, but the function still has to stay alive until the last
// file is sent. 300s is the most every Vercel plan allows; raise it on Pro if exports get cut off.
export const config: Config = { maxDuration: 300 };

/** Admins download every post (?scope=all) or just the Picked board (?scope=picked) as a zip. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireAdmin(locals);
  const scope = url.searchParams.get("scope") === "picked" ? "picked" : "all";
  await enforce(user.id, limits.export);

  const zip = downloadZip(exportEntries(scope));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="picslop-${scope}-${stamp}.zip"`,
      "cache-control": "no-store",
    },
  });
};
