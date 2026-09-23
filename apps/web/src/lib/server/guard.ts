import { error, type RequestEvent } from "@sveltejs/kit";

import { isBanned } from "./posts";

export function requireUser(locals: App.Locals) {
  if (!locals.user) error(401, "Sign in required.");
  return locals.user;
}

/** Signed in and not banned: required for anything that writes. */
export async function requireActiveUser(locals: App.Locals) {
  const user = requireUser(locals);
  if (await isBanned(user.id)) error(403, "Your account has been restricted by an admin.");
  return user;
}

export function requireAdmin(locals: App.Locals) {
  const user = requireUser(locals);
  if (!locals.isAdmin) error(403, "Admins only.");
  return user;
}

export function clientIp(event: RequestEvent) {
  try {
    return event.getClientAddress();
  } catch {
    return undefined;
  }
}

export async function readJson(request: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) error(413, "Request too large.");
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  error(400, "Invalid JSON body.");
}

export function displayName(user: { name?: string | null; email: string }) {
  return (user.name || user.email.split("@")[0] || "someone").slice(0, 60);
}
