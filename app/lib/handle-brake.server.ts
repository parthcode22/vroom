/**
 * VRIP-13's deferred abuse brake: minting a new handle costs a slot in an edge
 * counter keyed by the connecting IP, so a suspended student cannot mint
 * replacements as fast as a script can loop.
 *
 * The address is the counter's key and nothing else. It is never logged, never
 * written to Neon or the Durable Object, and never compared with anything a
 * handle carries. The limit itself lives in `wrangler.jsonc` (`ratelimits`).
 *
 * Returning devices never reach this: only a key with no member row costs a
 * slot, so a campus behind one NAT address spends the budget on newcomers only.
 */

export interface HandleLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

let limiterPromise: Promise<HandleLimiter | undefined> | undefined;

/** Lazy for the same reason as `room.server.ts`: plain Node has no `cloudflare:workers`. */
function getLimiter() {
  return (limiterPromise ??= import("cloudflare:workers")
    .then(
      (m) =>
        (m.env as unknown as { NEW_HANDLE_LIMITER?: HandleLimiter } | undefined)
          ?.NEW_HANDLE_LIMITER,
    )
    .catch(() => undefined));
}

/**
 * Fails open. A missing binding or a limiter error lets the handle through:
 * this is a brake on scripts, and refusing every newcomer because the counter
 * hiccupped would be the bigger harm. The error is logged without the key.
 */
export async function checkNewHandle(
  limiter: HandleLimiter | undefined,
  request: Request,
): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!limiter || !ip) return true;
  try {
    const { success } = await limiter.limit({ key: ip });
    return success;
  } catch (error) {
    console.error("[handle-brake] limiter unavailable", error);
    return true;
  }
}

export async function allowNewHandle(request: Request): Promise<boolean> {
  return checkNewHandle(await getLimiter(), request);
}
