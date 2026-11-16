import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import { downloadZip } from "client-zip";

import { displayName, requireCurator } from "$lib/server/guard";
import { enforce, limits } from "$lib/server/ratelimit";
import { isValidSetId, prepareExport } from "$lib/server/sets";
import type { RequestHandler } from "./$types";

export const config: Config = { maxDuration: 300 };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "set";

/**
 * Download a set as a zip: its images in video order plus manifest.json. The same rule as the
 * dashboard's export button is enforced here: every image approved, none vetoed or pending.
 * `?check=1` runs every check and answers with JSON instead of the zip, so the dashboard can show
 * a proper error before starting the download.
 */
export const GET: RequestHandler = async ({ params, locals, url }) => {
  const user = await requireCurator(locals);
  if (!isValidSetId(params.id)) error(404, "Set not found.");
  const by = { id: user.id, name: displayName(user) };

  if (url.searchParams.get("check") === "1") {
    const { manifest } = await prepareExport(params.id, by);
    return json({ ok: true, count: manifest.count });
  }

  await enforce(user.id, limits.setExport);
  const { set, entries } = await prepareExport(params.id, by);
  const zip = downloadZip(entries());
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="picslop-set-${slug(set.name)}-${stamp}.zip"`,
      "cache-control": "no-store",
    },
  });
};
