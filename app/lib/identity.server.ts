import { eq } from "drizzle-orm";

import { db } from "~/db";
import { members, user } from "~/db/schema";
import { writeAudit } from "~/db/queries/audit";

/**
 * The one function that resolves a pseudonym to a real V Auth account (VRIP-04).
 *
 * No other module joins `members` to better-auth's `user`. If you find yourself
 * needing an email somewhere else, the answer is that you do not — the console
 * never receives one in a loader payload, and the address is returned for
 * exactly one report, held in component state, and never persisted client-side.
 *
 * The audit row is the PRECONDITION, not the consequence (VRIP-08). The read
 * happens only if the write succeeded, and the database CHECK rejects a reveal
 * row with no report_id — so an unbound lookup cannot be performed through this
 * path at all.
 */

export interface ResolvedIdentity {
  email: string;
  name: string;
  auditId: string;
}

export interface ResolveInput {
  memberId: string;
  actorMemberId: string;
  actorKind: "console" | "script";
  /** Required. The database rejects the audit row without it. */
  reportId: string;
  messageId: string | null;
}

export async function resolveIdentity(
  input: ResolveInput,
): Promise<ResolvedIdentity> {
  if (!input.reportId) {
    throw new Error(
      "resolveIdentity: reportId is required — a reveal must be bound to a report.",
    );
  }

  // Write first. A failure here — including the CHECK constraint firing —
  // aborts before anything is read.
  const audit = await writeAudit({
    action: "reveal",
    actorMemberId: input.actorMemberId,
    actorKind: input.actorKind,
    targetType: "member",
    targetId: input.memberId,
    reportId: input.reportId,
    details: { messageId: input.messageId },
  });

  const rows = await db
    .select({ email: user.email, name: user.name })
    .from(members)
    .innerJoin(user, eq(members.userId, user.id))
    .where(eq(members.id, input.memberId))
    .limit(1);

  const found = rows[0];
  if (!found) {
    throw new Error(
      `resolveIdentity: no account behind member ${input.memberId}`,
    );
  }

  return { email: found.email, name: found.name, auditId: audit.id };
}
