/**
 * Environment access for the Worker.
 *
 * Strings (vars and secrets) come from `process.env`, typed by the generated
 * `worker-configuration.d.ts`. Non-string bindings — here just the Durable
 * Object namespace — are resolved through a lazy dynamic import of
 * `cloudflare:workers`, so every module stays loadable under plain Node for
 * `tsx scripts/*` and drizzle-kit. This is voss-auth's rate-limit-kv pattern.
 */

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function requireVar(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const APP_JWT_TTL_SECONDS = () =>
  numberVar(process.env.APP_JWT_TTL_SECONDS, 900);
export const MESSAGE_MAX_CHARS = () =>
  numberVar(process.env.MESSAGE_MAX_CHARS, 500);
export const RATE_LIMIT_PER_MINUTE = () =>
  numberVar(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE, 20);
export const RATE_LIMIT_HISTORY_PER_MINUTE = () =>
  numberVar(process.env.RATE_LIMIT_HISTORY_PER_MINUTE, 30);
