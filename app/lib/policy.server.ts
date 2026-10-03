import { findMemberByPseudonym, setSuspended } from "~/db/queries/members";
import { createAutoFlagReport } from "~/db/queries/reports";
import { writeAudit } from "~/db/queries/audit";
import { tryRoom } from "~/lib/room.server";
import { ROOM_IDS, type RoomId } from "~/lib/rooms";
import { redactPersonal } from "../../workers/policy";

/**
 * The bridge VRIP-09 describes, and the only place it exists.
 *
 * The room object refuses a message and records a flag against a pseudonym in
 * its own SQLite. It cannot write the report: reports live in Neon keyed by
 * `members.id`, and resolving a pseudonym to a member is precisely what VRIP-04
 * forbids the object from doing. This module runs server-side, holds Neon, and
 * is allowed to resolve — so it drains flags on console load, materialises them
 * as reports, and mirrors any auto-suspension the room made on its own.
 *
 * Idempotency has two layers and needs both. The cursor in the object only
 * moves on `ackFlags`, so a failure here re-reads rather than loses; and the
 * report insert is keyed on the flag id, so a re-read cannot become a second
 * report. Neither alone is enough: a cursor that moved on read would drop flags
 * when this function throws, and a unique index alone would rescan the whole
 * table on every load.
 */

export interface DrainResult {
  drained: number;
  created: number;
  suspended: number;
  /** True when the object could not be reached. The console still renders. */
  unreachable: boolean;
}

const EMPTY: DrainResult = {
  drained: 0,
  created: 0,
  suspended: 0,
  unreachable: false,
};

function reason(matches: string, targeted: boolean): string {
  const aim = targeted ? " aimed at someone named in it" : "";
  return `Blocked automatically: ${matches}${aim}.`;
}

/** Every room keeps its own flags and cursor, so each drains on its own (VRIP-12). */
export async function drainPolicyFlags(): Promise<DrainResult> {
  const results = await Promise.all(ROOM_IDS.map(drainRoom));
  return results.reduce(
    (sum, next) => ({
      drained: sum.drained + next.drained,
      created: sum.created + next.created,
      suspended: sum.suspended + next.suspended,
      unreachable: sum.unreachable || next.unreachable,
    }),
    EMPTY,
  );
}

async function drainRoom(room: RoomId): Promise<DrainResult> {
  const flags = await tryRoom(room, (stub) => stub.drainFlags());
  if (!flags) return { ...EMPTY, unreachable: true };
  if (flags.length === 0) return EMPTY;

  const result: DrainResult = { ...EMPTY, drained: flags.length };
  let through = 0;

  for (const flag of flags) {
    // An unacknowledged flag is retried on the next load, so the cursor may only
    // advance past this one once it is genuinely dealt with.
    const member = await findMemberByPseudonym(flag.pseudonym);
    if (!member) {
      // The handle is not a member of record. Nothing can be filed against it
      // and retrying will not change that, so it is acknowledged and dropped.
      through = flag.id;
      continue;
    }

    const created = await createAutoFlagReport({
      roomId: room,
      flagId: flag.id,
      reportedMemberId: member.id,
      // Redacted again at the boundary rather than trusted from the object.
      // Neon is permanent and joined to identity, and the queue can still hold
      // flags written before VRIP-10 (they drain on the next console load).
      snippet: redactPersonal(flag.snippet),
      reason: reason(flag.matches, flag.targeted),
    });

    // Null means this flag is already a report. Everything below it has already
    // happened too, so skipping is what keeps a second drain a no-op.
    if (created) {
      result.created += 1;
      if (flag.autoSuspended) {
        await setSuspended(
          member.id,
          true,
          "Automatic: repeated blocked messages.",
        );
        await writeAudit({
          action: "auto_suspend",
          // No human decided this. The room did, and the row says so.
          actorMemberId: null,
          actorKind: "console",
          targetType: "member",
          targetId: member.id,
          reportId: created.id,
          details: { handle: flag.pseudonym, flagId: flag.id },
        });
        result.suspended += 1;
      }
    }
    through = flag.id;
  }

  if (through > 0) await tryRoom(room, (stub) => stub.ackFlags(through));
  return result;
}
