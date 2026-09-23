import { ENV } from "../env.server";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user
    ? {
        id: locals.user.id,
        name: locals.user.name || locals.user.email.split("@")[0]!,
        email: locals.user.email,
      }
    : null,
  isAdmin: locals.isAdmin,
  turnstileSiteKey: ENV.TURNSTILE_SITE_KEY,
});
