import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * The client is built lazily behind a Proxy, and this is not optional.
 *
 * Module scope on Workers runs at isolate boot, before secrets are injected, so
 * a top-level `neon(process.env.DATABASE_URL)` throws in production while
 * `wrangler dev` hides it — the dev server populates process.env from .dev.vars
 * at startup. Deferring to first property access puts construction inside a
 * request, where the secret exists.
 */

let instance: NeonHttpDatabase<typeof schema> | null = null;

function build(): NeonHttpDatabase<typeof schema> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  return (instance ??= build());
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type Database = typeof db;
export { schema };
