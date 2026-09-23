import { error } from "@sveltejs/kit";

import { ENV } from "../../env.server";

export async function verifyTurnstile(token: unknown, ip: string | undefined) {
  if (typeof token !== "string" || !token || token.length > 2048) {
    error(400, "Please complete the human check.");
  }
  const body = new FormData();
  body.append("secret", ENV.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  let ok = false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { success?: boolean };
    ok = data.success === true;
  } catch (e) {
    console.error("[turnstile] verification failed", e);
  }
  if (!ok) error(403, "Human check failed. Please try again.");
}
