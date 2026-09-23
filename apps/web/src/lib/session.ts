import { goto, invalidateAll } from "$app/navigation";

import { authClient } from "$lib/auth-client";

export async function signOut() {
  await authClient.signOut();
  await invalidateAll();
  await goto("/login");
}
