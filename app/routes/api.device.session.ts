import type { ActionFunctionArgs } from "react-router";

import {
  ensureMemberByKey,
  findAnyMemberByKeyHash,
} from "~/db/queries/members";
import {
  deviceSessionCookie,
  mintDeviceSession,
  verifyDeviceProof,
} from "~/lib/device-session.server";
import { allowNewHandle } from "~/lib/handle-brake.server";
import { isSuspended } from "~/lib/membership.server";
import { isSameOrigin } from "~/lib/origin.server";

/**
 * Exchanges a signed challenge for a device session cookie (VRIP-13).
 *
 * The proof is verified before any database work, so a forged or replayed-late
 * request costs no Neon round trip. A suspended key is refused here, as the
 * token mint refuses it, so it cannot even obtain a session. A key with no
 * member row yet is a new handle, and only that passes the edge brake.
 */

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

const MESSAGES = {
  challenge_expired: "That sign-in took too long. Try again.",
  bad_challenge: "That sign-in could not be verified. Try again.",
  bad_key: "This browser's key could not be read.",
  bad_signature: "That sign-in could not be verified. Try again.",
} as const;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return fail("method_not_allowed", "Use POST.", 405);
  if (!isSameOrigin(request))
    return fail("cross_origin", "Cross-origin requests are refused.", 403);

  let body: { publicKey?: unknown; challenge?: unknown; signature?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("bad_request", "Expected a JSON body.", 400);
  }

  let proof;
  try {
    proof = await verifyDeviceProof({
      publicKey: body.publicKey,
      challenge: body.challenge,
      signature: body.signature,
    });
  } catch (error) {
    console.error("[device-session] verification unavailable", error);
    return fail("unavailable", "Could not sign in right now.", 503);
  }
  if (!proof.ok) return fail(proof.reason, MESSAGES[proof.reason], 401);

  let member;
  let token: string;
  try {
    const existing = await findAnyMemberByKeyHash(proof.keyHash);
    if (!existing && !(await allowNewHandle(request))) {
      return fail(
        "too_many_new_handles",
        "Too many new handles from this network. Try again in a minute.",
        429,
      );
    }
    member = existing ?? (await ensureMemberByKey(proof.keyHash));
    if (isSuspended(member))
      return fail("suspended", "This handle is suspended.", 403);
    token = await mintDeviceSession(member.id);
  } catch (error) {
    console.error("[device-session] could not open a session", error);
    return fail("unavailable", "Could not sign in right now.", 503);
  }
  return Response.json(
    { data: { ok: true } },
    {
      headers: {
        "Set-Cookie": deviceSessionCookie(request, token),
        "Cache-Control": "no-store",
      },
    },
  );
}
