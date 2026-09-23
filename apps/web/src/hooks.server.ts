import { building } from "$app/environment";
import { json, type Handle } from "@sveltejs/kit";
import { isAuthPath } from "better-auth/svelte-kit";

import { isAdminEmail } from "$lib/server/access";
import { auth } from "./services";

const PUBLIC_PATHS = ["/login"];

const securityHeaders: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);

  // Better Auth's own endpoints (magic link send/verify, session, sign-out).
  if (isAuthPath(event.url.toString(), auth.options)) return auth.handler(event.request);

  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;
  event.locals.isAdmin = isAdminEmail(session?.user.email);

  const path = event.url.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // Everything except the login page requires a session.
  if (!session && !isPublic) {
    if (path.startsWith("/api/")) return json({ message: "Sign in required." }, { status: 401 });
    const next = path === "/" ? "" : `?next=${encodeURIComponent(path + event.url.search)}`;
    return new Response(null, { status: 303, headers: { location: `/login${next}` } });
  }

  // CSRF: state-changing API calls must come from our own pages.
  if (path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(event.request.method)) {
    if (event.request.headers.get("origin") !== event.url.origin) {
      return json({ message: "Cross-site request blocked." }, { status: 403 });
    }
  }

  const response = await resolve(event);
  for (const [k, v] of Object.entries(securityHeaders)) response.headers.set(k, v);
  // Nothing here is public; keep shared caches out of it.
  if (!response.headers.has("cache-control")) response.headers.set("cache-control", "private, no-store");
  return response;
};
