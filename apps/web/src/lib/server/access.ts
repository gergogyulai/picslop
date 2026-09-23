import { ENV } from "../../env.server";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const allowedDomains = new Set(list(ENV.ALLOWED_EMAIL_DOMAINS).map((d) => d.replace(/^@/, "")));
const allowedEmails = new Set(list(ENV.ALLOWED_EMAILS));
const adminEmails = new Set(list(ENV.ADMIN_EMAILS));

export function isEmailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  // No "+" aliases (you+anything@...): one person, one account. Applies to every address, even allowlisted ones.
  if (e.includes("+")) return false;
  if (allowedEmails.has(e) || adminEmails.has(e)) return true;
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  // Exact domain match only: "evil-example.edu" or "example.edu.evil.com" must not pass.
  return allowedDomains.has(e.slice(at + 1));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails.has(email.trim().toLowerCase());
}
