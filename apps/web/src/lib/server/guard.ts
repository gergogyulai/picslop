import { error, type RequestEvent } from "@sveltejs/kit";

import { isBanned, isCurator } from "./posts";

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

/** Admins and designated curators can cherrypick posts. */
export async function canPick(locals: App.Locals) {
  if (!locals.user) return false;
  return locals.isAdmin || (await isCurator(locals.user.id));
}

/** Curated sets: designated curators and admins (who can already do everything a curator can). */
export function canCurate(locals: App.Locals) {
  return !!locals.user && (locals.isAdmin || locals.isCurator);
}

export async function requireCurator(locals: App.Locals) {
  const user = await requireActiveUser(locals);
  if (!canCurate(locals)) error(403, "Curators only.");
  return user;
}

/** Approving and vetoing is reviewers only. Being an admin or a curator doesn't grant it. */
export async function requireReviewer(locals: App.Locals) {
  const user = await requireActiveUser(locals);
  if (!locals.isReviewer) error(403, "Only reviewers can approve or veto images.");
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
