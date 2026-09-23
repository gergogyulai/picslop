import { building } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";

import { auth } from "./services";

export const handle: Handle = async ({ event, resolve }) => {
  const authInstance = auth;

  return svelteKitHandler({
    event,
    resolve,
    auth: authInstance,
    building,
  });
};
