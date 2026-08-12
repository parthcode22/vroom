import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";

import { findMemberByPseudonym } from "~/db/queries/members";
import {
  isModIntent,
  performModeration,
  type ModFields,
} from "~/lib/moderation.server";
import { isBrowserCrossOrigin } from "~/lib/origin.server";
import { ModerationError } from "~/lib/require-role.server";
import { tryRoom } from "~/lib/room.server";

/**
 * The script front door (VRIP-08). Same module as the console, so the
 * server-side role check exists once and cannot be present in one and missing
 * in the other.
 *
 * MOD_SCRIPT_TOKEN resolves to a designated moderator row, which is why the
 * audit row it produces names a row rather than a person. That cost is recorded
 * in VRIP-08 and is the reason the token is worth deleting if the roster turns
 * out to be people who always have a browser.
 */

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

/** A human running a script needs a handful a minute. A guesser needs millions. */
const SCRIPT_AUTH_ATTEMPTS_PER_MINUTE = 10;

/**
 * Compared as digests, not as strings: two SHA-256 outputs are always the same
 * length, so timingSafeEqual runs over them without an early return and the
 * token's length leaks no more than its bytes do.
 */
async function tokensMatch(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return timingSafeEqual(x, y);
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return fail("method_not_allowed", "Use POST.", 405);
  // The bearer header is itself CSRF-proof, but a browser that announces itself
  // as cross-origin has no business at this door either.
  if (isBrowserCrossOrigin(request)) {
    return fail("cross_origin", "Cross-origin requests are refused.", 403);
  }

  // Throttled in the room object, the only state two isolates share. It fails
  // open when the object is unreachable: the token check is still the control,
  // and moderation during an outage matters more than the attempt budget.
  const attempt = await tryRoom((room) =>
    room.checkScriptAuth(SCRIPT_AUTH_ATTEMPTS_PER_MINUTE),
  );
  if (attempt && !attempt.allowed) {
    return fail("rate_limited", "Too many attempts. Wait and retry.", 429);
  }

  const expected = process.env.MOD_SCRIPT_TOKEN;
  const presented = bearer(request);
  if (!expected || !presented || !(await tokensMatch(presented, expected))) {
    return fail("bad_token", "Invalid script token.", 401);
  }

  const intent = params.action;
  if (!isModIntent(intent)) return fail("bad_request", "Unknown action.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const handle = typeof body.handle === "string" ? body.handle : null;
  const designated = process.env.MOD_SCRIPT_MEMBER_HANDLE;
  if (!designated) {
    return fail(
      "not_moderator",
      "MOD_SCRIPT_MEMBER_HANDLE is not configured.",
      500,
    );
  }

  const actorMember = await findMemberByPseudonym(designated);
  if (!actorMember)
    return fail(
      "not_moderator",
      "The designated moderator row is missing.",
      403,
    );

  // Scripts address accounts by handle; the module works in member ids.
  let memberId = typeof body.memberId === "string" ? body.memberId : null;
  if (!memberId && handle) {
    const target = await findMemberByPseudonym(handle);
    if (!target) return fail("member_not_found", "No such handle.", 404);
    memberId = target.id;
  }

  const fields: ModFields = {
    reportId: typeof body.reportId === "string" ? body.reportId : null,
    memberId,
    reason: typeof body.reason === "string" ? body.reason : null,
    killed: body.killed === true,
  };

  try {
    // The role is re-checked inside performModeration. Holding the token is not
    // the authorisation; being a moderator row is.
    const result = await performModeration(
      { member: actorMember, kind: "script" },
      intent,
      fields,
    );
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ModerationError) {
      return fail(error.code, error.message, error.status);
    }
    console.error("[api.mod] unhandled:", error);
    return fail("internal_error", "The action failed.", 500);
  }
}
