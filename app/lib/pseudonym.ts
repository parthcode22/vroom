/**
 * Handle generation, ported from voss-ask's internal/username.
 *
 * The wordlists themselves moved to `workers/handles.ts` when VRIP-09's detector
 * needed to recognise a handle in a message: two copies of the vocabulary would
 * eventually disagree about what a handle is, and the detector's answer has to
 * be the same one this file generates against.
 */

import {
  ADJECTIVES,
  ANIMALS,
  HANDLE_PATTERN,
  WORDLIST_SIZES,
  isValidHandle,
} from "../../workers/handles";

export { HANDLE_PATTERN, WORDLIST_SIZES, isValidHandle };

/** Uniform-ish index over crypto randomness, matching voss-ask's randIndex. */
function randIndex(n: number): number {
  if (n <= 0) return 0;
  const buf = new BigUint64Array(1);
  crypto.getRandomValues(buf);
  return Number(buf[0] % BigInt(n));
}

/** `adjective-animal`, 5,680 combinations. */
export function randomHandle(): string {
  return `${ADJECTIVES[randIndex(ADJECTIVES.length)]}-${ANIMALS[randIndex(ANIMALS.length)]}`;
}

/** `adjective-animal-0000`, the collision escape hatch. 56.8M combinations. */
export function randomHandleWithSuffix(): string {
  const suffix = String(randIndex(10_000)).padStart(4, "0");
  return `${randomHandle()}-${suffix}`;
}

/**
 * Candidate for attempt `n` (0-based). voss-ask switches to the numeric suffix
 * on the third consecutive collision; the same threshold applies here.
 */
export function handleCandidate(attempt: number): string {
  return attempt >= 3 ? randomHandleWithSuffix() : randomHandle();
}
