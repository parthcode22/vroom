import { redirect } from "react-router";

import { getSessionUser } from "~/lib/auth.server";
import {
  ensureMember,
  findMemberById,
  type MemberRecord,
} from "~/db/queries/members";
import { readDeviceSession } from "~/lib/device-session.server";
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
 * suspended account the kill switch and restore on itself.
 */

/** How the request proved who it is: a moderator's V Auth session, or a student device key (VRIP-13). */
export type SessionKind = "vauth" | "device";

export interface Actor {
  kind: SessionKind;
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

/**
 * The member behind a request, or null. A better-auth session wins over a
 * device cookie, so a moderator who also holds a device key acts as the
 * moderator account rather than as an anonymous handle.
 */
export async function resolveActor(request: Request): Promise<Actor | null> {
  const user = await getSessionUser(request);
  if (user) return { kind: "vauth", member: await ensureMember(user.id) };

  const memberId = await readDeviceSession(request);
  if (!memberId) return null;
  const member = await findMemberById(memberId);
  // A cookie for a V Auth row is not a device session, whatever it claims.
  if (!member || member.userId !== null) return null;
  return { kind: "device", member };
}

export async function requireSession(request: Request): Promise<Actor> {
  const actor = await resolveActor(request);
  if (!actor) throw redirect("/");
  return actor;
}

/** Redirects a signed-out visitor and 404s anyone who is not a moderator. */
export async function requireModerator(request: Request): Promise<Actor> {
  const actor = await requireSession(request);
  if (actor.kind !== "vauth") {
    throw new Response("Not found", { status: 404 });
  }
  if (!actor.member.isModerator || isSuspended(actor.member)) {
    // Not a 403: a student has no business learning the console exists.
    throw new Response("Not found", { status: 404 });
  }
  return actor;
}

/**
 * The same check for a caller that already resolved a member — the script front
 * door, which authenticates by token rather than session (VRIP-08). A device-key
 * member is never a moderator: moderation needs an accountable person (VRIP-13).
 */
export function assertModerator(member: MemberRecord): void {
  if (!member.isModerator || isSuspended(member) || member.userId === null) {
    throw new ModerationError(
      "not_moderator",
      "This account is not a moderator.",
      403,
    );
  }
}
