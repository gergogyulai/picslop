import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * R2_ENDPOINT (optional) points at a local S3-compatible store in development.
 * This file is evaluated before varlock loads the env files, so look in them directly too.
 */
function r2Endpoint() {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT;
  for (const name of [".env.local", ".env"]) {
    const file = fileURLToPath(new URL(name, import.meta.url));
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^R2_ENDPOINT=["']?([^"'\s#]+)/m);
    if (match) return match[1];
  }
  return undefined;
}

const endpoint = r2Endpoint();
const R2 = [endpoint ? new URL(endpoint).origin : null, "https://*.r2.cloudflarestorage.com"].filter(Boolean);
const TURNSTILE = "https://challenges.cloudflare.com";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    // Deployed on Vercel's Node runtime (sharp needs native bindings, so no edge).
    // Swap for @sveltejs/adapter-node when self-hosting.
    adapter: adapter(),
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self", "wasm-unsafe-eval", TURNSTILE],
        "worker-src": ["self", "blob:"],
        "style-src": ["self", "unsafe-inline", "https://fonts.googleapis.com"],
        "font-src": ["self", "https://fonts.gstatic.com"],
        "img-src": ["self", "data:", "blob:", ...R2],
        "media-src": ["self", "blob:", ...R2],
        "connect-src": ["self", ...R2],
        "frame-src": [TURNSTILE],
        "frame-ancestors": ["none"],
        "object-src": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
      },
    },
  },
};

export default config;
