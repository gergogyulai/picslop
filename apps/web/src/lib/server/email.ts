import { ENV } from "../../env.server";

export async function sendMagicLinkEmail(email: string, url: string) {
  if (!ENV.RESEND_API_KEY) {
    if (ENV.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not configured");
    console.info(`\n[magic-link] ${email}\n${url}\n`);
    return;
  }

  // Gmail and others thread messages by subject and collapse repeated content, so a fresh link
  // can hide behind an older, already-used one. A per-email code in the subject and body plus a
  // unique X-Entity-Ref-ID header keeps every sign-in email separate.
  const ref = crypto.randomUUID();
  const code = ref.slice(0, 6).toUpperCase();
  const sentAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="font-size:22px;margin:0 0 16px">Sign in to picslop</h1>
      <p style="margin:0 0 24px;color:#333">Click the button below to sign in. The link expires in 10 minutes and works once.</p>
      <a href="${url}" style="display:inline-block;background:#ff5a1f;color:#111;font-weight:700;padding:12px 20px;border:2px solid #111;text-decoration:none">Sign in</a>
      <p style="margin:24px 0 0;color:#777;font-size:13px">If you didn't request this, you can ignore this email.</p>
      <p style="margin:8px 0 0;color:#999;font-size:12px">Requested ${sentAt} · ref ${code}</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: ENV.EMAIL_FROM,
      to: [email],
      subject: `Your picslop sign-in link [${code}]`,
      html,
      text: `Sign in to picslop: ${url}\n\nThe link expires in 10 minutes.\n\nRequested ${sentAt} · ref ${code}`,
      headers: { "X-Entity-Ref-ID": ref },
    }),
  });
  if (!res.ok) {
    console.error("[magic-link] Resend error", res.status, await res.text());
    throw new Error("Failed to send sign-in email");
  }
}
