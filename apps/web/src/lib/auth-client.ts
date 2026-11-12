import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), passkeyClient()],
});

/** True when this browser can create and use passkeys at all. */
export function passkeysSupported() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}
