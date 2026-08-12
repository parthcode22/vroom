import {
  claimPseudonym,
  findMemberById,
  type MemberRecord,
} from "~/db/queries/members";
import { handleCandidate, isValidHandle } from "~/lib/pseudonym";

/**
 * Assigning the one pseudonym a V Auth account will ever have.
 *
 * The claim is optimistic and race-safe in a single statement: a collision comes
 * back as `false`, not as an error. voss-ask switches to the numeric suffix on
 * the third consecutive collision and the same threshold applies here, so the
 * loop degrades from 5,680 candidates to 56.8 million rather than spinning.
 */

const MAX_ATTEMPTS = 8;

export class PseudonymExhausted extends Error {
  constructor() {
    super("Could not allocate a pseudonym after repeated collisions.");
    this.name = "PseudonymExhausted";
  }
}

/** Idempotent: a member that already holds a pseudonym is returned unchanged. */
export async function ensurePseudonym(
  member: MemberRecord,
): Promise<MemberRecord> {
  if (member.pseudonym) return member;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = handleCandidate(attempt);
    if (!isValidHandle(candidate)) continue;

    const claimed = await claimPseudonym(member.id, candidate);
    if (claimed) return { ...member, pseudonym: candidate };

    // Either another account holds the candidate, or this member was claimed
    // concurrently by a second tab. Re-read to tell the two apart.
    const current = await findMemberById(member.id);
    if (current?.pseudonym) return current;
  }

  throw new PseudonymExhausted();
}

export function isSuspended(member: MemberRecord): boolean {
  return member.suspendedAt !== null || member.deletedAt !== null;
}
