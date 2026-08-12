import { redirect } from "react-router";

import { getSessionUser } from "~/lib/auth.server";
import { ensureMember, type MemberRecord } from "~/db/queries/members";
import { isSuspended } from "~/lib/membership.server";

/**
 * Called at the top of every loader and action that needs a session or a role.
 *
 * Hiding a navigation entry is presentation. These functions are the control,
 * and every moderator action calls requireModerator() again on the server —
 * there is no cached role and no trusted client claim (VRIP-05).
 *
 * Both role checks go through isSuspended(), so suspension revokes the console
 * as well as the socket. Suspension is the product's only remedy against a
 * moderator, and a check that reads deletedAt but not suspendedAt leaves the
 * suspended account the kill switch, restore on itself, and reveal.
 */

export interface Actor {
  userId: string;
  member: MemberRecord;
}

export class ModerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export async function requireSession(request: Request): Promise<Actor> {
  const user = await getSessionUser(request);
  if (!user) throw redirect("/");
  const member = await ensureMember(user.id);
  return { userId: user.id, member };
}

/** Redirects a signed-out visitor and 404s a signed-in student. */
export async function requireModerator(request: Request): Promise<Actor> {
  const actor = await requireSession(request);
  if (!actor.member.isModerator || isSuspended(actor.member)) {
    // Not a 403: a student has no business learning the console exists.
    throw new Response("Not found", { status: 404 });
  }
  return actor;
}

/**
 * The same check for a caller that already resolved a member — the script front
 * door, which authenticates by token rather than session (VRIP-08).
 */
export function assertModerator(member: MemberRecord): void {
  if (!member.isModerator || isSuspended(member)) {
    throw new ModerationError(
      "not_moderator",
      "This account is not a moderator.",
      403,
    );
  }
}
