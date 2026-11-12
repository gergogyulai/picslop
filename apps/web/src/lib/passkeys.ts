import { authClient } from "$lib/auth-client";

/** Set once someone adds a passkey or says "not now", so the post-sign-in nudge stays quiet. */
const NUDGE_KEY = "picslop:passkey-nudge";

export function nudgeDismissed() {
  try {
    return localStorage.getItem(NUDGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissNudge() {
  try {
    localStorage.setItem(NUDGE_KEY, "1");
  } catch {}
}

/** A readable default name like "iPhone · Safari", so people can tell their passkeys apart. */
function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? navigator.maxTouchPoints > 1
            ? "iPad"
            : "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}

/** Better Auth error objects only sometimes carry a `code`. */
export const errorCode = (e: unknown) =>
  e && typeof e === "object" && "code" in e && typeof e.code === "string" ? e.code : undefined;

const CANCELLED = new Set(["ERROR_CEREMONY_ABORTED", "AUTH_CANCELLED", "REGISTRATION_CANCELLED"]);

/** True when the person closed the browser's passkey sheet: not worth an error message. */
export const wasCancelled = (e: unknown) => CANCELLED.has(errorCode(e) ?? "");

export async function addPasskey(): Promise<{ ok: true } | { ok: false; cancelled: boolean; stale: boolean; message: string }> {
  const { error } = await authClient.passkey.addPasskey({ name: deviceLabel() });
  if (!error) {
    dismissNudge();
    return { ok: true };
  }
  const code = errorCode(error);
  const stale = code === "SESSION_NOT_FRESH";
  return {
    ok: false,
    cancelled: wasCancelled(error),
    stale,
    message: stale
      ? "For safety, passkeys can only be added within a day of signing in with an email link. Sign out, sign back in with a link, then add it."
      : code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
        ? "This device already has a passkey for your account."
        : (error.message ?? "Couldn't add the passkey."),
  };
}
