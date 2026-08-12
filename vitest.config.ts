import { defineConfig } from "vitest/config";

/**
 * Two projects, because two of them are genuinely different runtimes.
 *
 * `unit` runs pure logic and mocked-boundary tests on Node. `workers` runs the
 * Durable Object and the upgrade guard inside workerd through
 * @cloudflare/vitest-pool-workers, which is the only place hibernation and DO
 * SQLite behave the way production does.
 */
export default defineConfig({
  test: {
    projects: ["vitest.unit.config.ts", "vitest.workers.config.ts"],
  },
});
