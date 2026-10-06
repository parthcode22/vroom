import type { ActionFunctionArgs } from "react-router";

import { mintChallenge } from "~/lib/device-session.server";
import { isSameOrigin } from "~/lib/origin.server";

/**
 * A short-lived, stateless challenge for the browser's device key to sign
 * (VRIP-13). POST rather than GET so nothing in between caches it.
 */

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return fail("method_not_allowed", "Use POST.", 405);
  if (!isSameOrigin(request))
    return fail("cross_origin", "Cross-origin requests are refused.", 403);

  try {
    return Response.json(
      { data: { challenge: await mintChallenge() } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[device-challenge] could not mint", error);
    return fail("unavailable", "Could not start sign-in. Try again.", 503);
  }
}
