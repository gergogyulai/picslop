import { redirect } from "@sveltejs/kit";

import { ENV } from "../../env.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
  const next = safeNext(url.searchParams.get("next"));
  if (locals.user) redirect(303, next);
  const domainHint = ENV.ALLOWED_EMAIL_DOMAINS.split(",")[0]?.trim().replace(/^@/, "") || null;
  return { next, error: url.searchParams.get("error"), domainHint };
};

/** Only same-site relative paths, never "//evil.com" or "/\\evil.com". */
function safeNext(v: string | null) {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v;
}
