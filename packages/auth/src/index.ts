import { passkey } from "@better-auth/passkey";
import type { Database } from "@picslop/db";
import { betterAuth } from "better-auth";
import type { SecondaryStorage } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, magicLink } from "better-auth/plugins";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
};

export type AuthDeps = {
  /** Returns true if this email may sign in at all. */
  isEmailAllowed: (email: string) => boolean;
  /** Throttle per target address so nobody can flood someone's inbox. Returns false when over the limit. */
  allowMagicLinkFor: (email: string) => Promise<boolean>;
  sendMagicLink: (email: string, url: string) => Promise<void>;
  secondaryStorage: SecondaryStorage;
};

const NOT_ALLOWED = "This email address is not allowed to sign in.";

const DAY = 60 * 60 * 24;

export function createAuth(env: AuthConfig, database: Database, deps: AuthDeps) {
  return betterAuth({
    database: mongodbAdapter(database),
    secondaryStorage: deps.secondaryStorage,
    trustedOrigins: [env.BETTER_AUTH_URL],
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: false },
    session: {
      // Sliding window: any visit after `updateAge` pushes expiry out another `expiresIn`,
      // so only people who stay away for 90 days have to sign in again.
      expiresIn: 90 * DAY,
      updateAge: DAY,
      // Adding a passkey needs a session younger than this (i.e. a recent email-link sign-in).
      freshAge: DAY,
    },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 100,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = String(ctx.body?.email ?? "").trim().toLowerCase();
        if (!deps.isEmailAllowed(email)) {
          throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
        }
        if (!(await deps.allowMagicLinkFor(email))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many sign-in links requested for this address. Try again later.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Second line of defence: no account can ever be created for a disallowed address.
          before: async (user) => {
            const email = user.email.toLowerCase();
            if (!deps.isEmailAllowed(email)) {
              throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
            }
            return { data: { ...user, email, name: user.name || email.split("@")[0] } };
          },
        },
      },
      session: {
        create: {
          // Every sign-in method (magic link, passkey) ends here: an address that has since been
          // removed from the allowlist can't start new sessions, even with a passkey.
          before: async (session, ctx) => {
            const user = await ctx?.context.internalAdapter.findUserById(session.userId);
            if (!user || !deps.isEmailAllowed(user.email)) {
              throw new APIError("FORBIDDEN", { message: NOT_ALLOWED });
            }
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          try {
            await deps.sendMagicLink(email, url);
          } catch (e) {
            // The real reason is logged server-side; don't leak provider details to the browser.
            console.error("[magic-link] send failed", e);
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "We couldn't send the sign-in email. Please try again later.",
            });
          }
        },
      }),
      // Passkeys can only be added to an existing (email-verified) account while signed in;
      // there is no passkey-first sign-up.
      passkey({
        rpName: "picslop",
        rpID: new URL(env.BETTER_AUTH_URL).hostname,
        origin: new URL(env.BETTER_AUTH_URL).origin,
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "preferred",
        },
      }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-in/magic-link"],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
