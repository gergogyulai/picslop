import { ENV } from "../env.server";
import { COLS_COOKIE, FEED_COOKIE } from "$lib/masonry";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, cookies }) => ({
  user: locals.user
    ? {
        id: locals.user.id,
        name: locals.user.name || locals.user.email.split("@")[0]!,
        email: locals.user.email,
      }
    : null,
  isAdmin: locals.isAdmin,
  // Just signed in with an email link: the session is fresh enough to register a passkey, so offer one.
  offerPasskey: !!locals.session && Date.now() - new Date(locals.session.createdAt).getTime() < 12 * 60 * 60 * 1000,
  turnstileSiteKey: ENV.TURNSTILE_SITE_KEY,
  // Last seen masonry breakpoint + phone feed toggle, so SSR lays the board out like the client will.
  boardCols: Math.min(Math.max(Number(cookies.get(COLS_COOKIE)) || 0, 0), 5),
  boardFeed: cookies.get(FEED_COOKIE) === "1",
});
