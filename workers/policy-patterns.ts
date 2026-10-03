/**
 * The patterns VRIP-09 scores on, ported from voss-ask's policy.go, plus the
 * redaction VRIP-10 needs. They live apart from the detector because they are
 * the part that gets tuned: a pattern is a claim about how this campus writes,
 * and every correction to one is a correction here rather than to the scoring.
 *
 * `redactPersonal` sits with them deliberately. It has to use exactly the
 * patterns that decided a message carried personal data in the first place, or
 * a value the detector found would be one the redactor missed.
 */

import { DIVISIONS } from "./policy-words";

/* ---------------- patterns, ported from voss-ask's policy.go ---------------- */

// The phone pattern adds the 5+5 grouping (`98765 43210`) that voss-ask's 3+3+4
// misses, because that is how the number is usually written.
const PHONE =
  /(?:\+?91[\s-]?)?[6-9](?:\d{2}[\s-]?\d{3}[\s-]?\d{4}|\d{4}[\s-]?\d{5})/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const INSTAGRAM = /(?:instagram\.com\/|insta\.com\/|@)[a-z0-9._]{3,30}/gi;
const TELEGRAM = /t\.me\/[a-z0-9_]{4,}/gi;

export const PERSONAL: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "a phone number", re: PHONE },
  { label: "an email address", re: EMAIL },
  { label: "an Instagram handle", re: INSTAGRAM },
  { label: "a Telegram link", re: TELEGRAM },
];

/**
 * Honorific plus a capitalised name. voss-ask applies `(?i)` to the whole
 * pattern, which makes its `[A-Z][a-z]` match lower case too; the honorific is
 * the part that should be case-insensitive, so the check is split out here.
 */
export const HONORIFIC_NAME =
  /\b([A-Za-z][A-Za-z'.]{1,11})\s+([A-Z][a-z]{1,})\b/g;

/** `Kulkarni sir`, `Sharma ma'am` — the order this campus actually uses. */
export const NAME_HONORIFIC =
  /\b([A-Z][a-z]{1,})\s+([A-Za-z][A-Za-z']{1,11})\b/g;

/** Two consecutive capitalised words, optionally with a middle initial. */
export const FULL_NAME = /\b[A-Z][a-z]{1,}(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]{1,}\b/g;

export const DIVISION = new RegExp(
  `\\b(?:${[...DIVISIONS].sort((a, b) => b.length - a.length).join("|")})[\\s-][A-Z](?![A-Za-z])`,
  "g",
);

/**
 * A staff role is a target even with no name attached. `fck prof` reaches the
 * administration exactly as fast as `fck Prof Kulkarni`, and institutional risk
 * is the reason this policy exists. Safe to include because a target scores
 * nothing on its own: "which prof takes DBMS" carries no term and stays clean.
 */
export const STAFF_ROLE =
  /\b(?:prof|professor|sir|madam|ma'?am|maam|hod|dean|principal|teacher|faculty|lecturer|warden)\b/gi;

export const CLASS_WORD =
  /\b(?:div|division|class|section|batch)\s+[A-Za-z0-9]{1,4}\b/gi;

/**
 * Swap every personal-data value for its label. VRIP-10: what kind of data was
 * shared is recordable, the value never is — so anything that keeps text about
 * a message runs it through here first.
 *
 * Replacement shifts later character offsets. `snippet` anchors on an offset,
 * but it already collapses whitespace before anchoring and so already tolerates
 * a shift; being a few characters off moves a window, it does not lose a match.
 */
export function redactPersonal(text: string): string {
  let out = text;
  for (const { label, re } of PERSONAL) out = out.replace(re, `[${label}]`);
  return out;
}
