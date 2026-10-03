# VRIP-11: An author may withdraw their own message

**Status:** Accepted
**Date:** 2026-08-13
**Author:** Harshal More

## Context

People send the wrong thing. They mean it for one person and put it in a room of
several thousand, or they misread the question, or they simply regret it a second
later. Today the only way a message leaves Campus Live is a moderator deleting it,
which means the smallest possible mistake needs the largest possible intervention —
and with a single moderator, it does not happen at all until they wake up.

Full retention (`.preset/PRODUCT.md`) makes this worse than it sounds. A message
sent by accident is not merely visible now; it is in every backfill forever, read by
people who were not in the room when it happened.

## Decision

The author of a message may withdraw it. The room verifies that the handle asking is
the handle that sent it, and refuses otherwise.

The row is soft-deleted, never removed, exactly as a moderator deletion is. The
message renders to everyone as withdrawn rather than vanishing, so a conversation
that referred to it still makes sense.

**The row records who withdrew it — the author or a moderator.** These are different
events and an audit trail that cannot tell them apart is worth less than one that
can.

There is no time limit. A regret at ten minutes is the same regret as at ten
seconds, and a window only teaches people to delete reflexively before it closes.

## The evidence question

Letting an author withdraw a message lets someone abusive remove what they said
before a moderator sees it. That is the real cost and it is not hypothetical.

Three things already blunt it, which is why this is acceptable:

- The row survives. Withdrawal is a flag, not a delete, so the text is still there
  for a moderator who goes looking.
- A report snapshots the message text when it is filed. Withdrawing afterwards does
  not empty the queue entry.
- Anything the content policy blocked was never stored, and anything it flagged
  already carries its own snippet (VRIP-09). The worst messages leave a trace that
  does not depend on the author's cooperation.

What remains uncovered: a message that nobody reported and no rule flagged, withdrawn
before anyone acted. That is the accepted residue, and the answer to it is response
time, not a shorter window.

## Consequences

- Win: an ordinary mistake is fixed by the person who made it, in a second, without
  needing a moderator at all.
- Win: fewer trivial reports, so the queue is closer to being only things that matter.
- Win: less accidental personal data sitting in permanent history — the same goal as
  VRIP-10, reached by the sender's own hand.
- Cost: an abusive author can withdraw before a moderator reads it. Mitigated but not
  eliminated, as above.
- Cost: two kinds of deletion now exist, and any surface showing one must be honest
  about which it is showing.
- Risk: withdrawal is a write, so it can be spammed. It is rate-limited on the same
  basis as sending.
- Precludes: nothing. Ephemeral messages are unaffected because they were never
  stored to withdraw.

## Alternatives considered

- A short window, thirty seconds or two minutes: rejected. It trains people to delete
  reflexively before the clock runs out, and a regret does not expire.
- Hard delete: rejected outright. It would let an author destroy the only record of
  what they said, which is the one thing the moderation model cannot allow.
- Edit rather than withdraw: rejected for v1. Editing rewrites history in place and
  makes a quoted conversation dishonest; `.preset/PRODUCT.md` already excludes it.
- Moderator-only deletion, the status quo: rejected. It makes the smallest mistake
  cost the largest intervention, and with one moderator it does not scale to zero.

## Implementation notes

- Authorisation is the room object's, on the handle in the socket attachment. Never
  trust a handle sent in the frame.
- Withdrawal is idempotent: withdrawing an already-withdrawn message succeeds quietly.
- A moderator deletion of a withdrawn message still records the moderator action.
- The wire contract for withdrawal lives in `protocol.ts` with everything else.
