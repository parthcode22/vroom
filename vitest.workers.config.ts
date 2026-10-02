import { defineProject } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";

/**
 * The Worker entry under test is `test/workers/entry.ts`, not `workers/app.ts`.
 * The real entry imports `virtual:react-router/server-build`, which only exists
 * inside the React Router Vite build — the test entry mounts the same upgrade
 * guard and the same Durable Object class without it.
 */
export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./test/workers/entry.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          APP_JWT_SECRET: "test-app-jwt-secret-value-not-a-real-one",
          MESSAGE_MAX_CHARS: "500",
          RATE_LIMIT_MESSAGES_PER_MINUTE: "3",
          RATE_LIMIT_HISTORY_PER_MINUTE: "3",
        },
      },
    }),
  ],
  test: {
    name: "workers",
    include: ["test/workers/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
});
