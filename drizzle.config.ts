import { config } from "dotenv";

// Loaded before drizzle-kit so process.env is populated at module-eval time.
config({ path: ".env" });

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/db/schema/index.ts",
  out: "./app/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
