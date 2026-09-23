import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { defineConfig } from "vite";

// Vercel builds and runs in separate steps with no CLI access at runtime, so the resolved
// env must be baked into the build output (`resolved-env`). Self-hosted Node deployments
// (adapter-node) still spawn the CLI on boot via `auto-load`.
const ssrInjectMode = process.env.VERCEL ? "resolved-env" : "auto-load";

export default defineConfig({
  plugins: [varlockVitePlugin({ ssrInjectMode }), tailwindcss(), sveltekit()],
});
