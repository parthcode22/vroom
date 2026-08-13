# VRIP-10: Personal data is broadcast but never stored

**Status:** Accepted
**Date:** 2026-08-13
**Author:** Harshal More

## Context

VRIP-09 puts phone numbers, emails and social handles in the *confirm* tier: the
sender is asked whether they meant it, and the message then sends and persists like
any other. `.preset/PRODUCT.md` fixes retention as full history, kept and scrollable.

That combination means every phone number anyone posts lives forever in the room's
SQLite, appears in every future backfill, and is read by everyone who joins later —
including people who were not in the room when it was shared. VRIP-04 already
records the message store as a breach and disclosure target; a growing pile of
student phone numbers inside it makes that worse for no benefit, because the
legitimate use of a shared number is momentary. Someone swapping a number for a
study group needs it read now, not in March.

Blocking personal data outright is the wrong answer. Students genuinely need to
exchange a number, and refusing it just moves the number into a form the detector
misses.

## Decision

A message whose highest tier is *personal data* is broadcast live and never written
to the message store. Clients remove it from view sixty seconds after it arrives.

It is not in scrollback, it is not in backfill, and a student who joins a minute
later never sees it. The countdown is the visible signal that the message was not
saved; the security property is the absence of the write, not the disappearance.

Sixty seconds rather than thirty: thirty is not long enough to actually save a
number someone deliberately gave you, which would make the feature annoying instead
of protective.

**The flag must not reintroduce what the message avoided.** VRIP-09 flags carry a
snippet of the offending text into the moderator queue and from there into Neon,
which is permanent and joined to identity. For the personal-data tier the flag
records that a phone number, email or social handle was shared, and never the value.
A moderator learns it happened; they do not receive a copy. Storing the digits in
`reports` while deleting them from `messages` would move the data somewhere strictly
worse.

## Consequences

- Win: the permanent archive stops accumulating student contact details, which is a
  direct reduction in what a breach of the message store yields.
- Win: the legitimate use still works. The number is delivered to the people in the
  room at the time, which is who it was for.
- Win: people who were not present cannot harvest numbers by scrolling back.
- Cost: it is not a recall. The message reaches every connected socket, and anyone
  who would misuse a number is by definition online and can copy it within seconds.
  This narrows exposure; it does not eliminate it, and the product must not imply
  that it does.
- Cost: a perverse incentive. Telling people a message disappears makes them readier
  to post a number at all. Accepted deliberately — the alternative pushes the same
  data into spaced-out digits the detector cannot see.
- Cost: a moderator acting on a report about a personal-data message has no message
  to look at, only the fact and the handle. That is the intended trade.
- Risk: any future feature that persists message text — search, export, a second
  store — must honour this exclusion or silently undo it.
- Precludes: message search over personal-data messages, permanently. They are not
  kept.

## Alternatives considered

- Store and hide after sixty seconds: rejected. The data still exists, so every
  argument for the feature evaporates while the reassurance remains, which is the
  worst combination.
- Block personal data outright: rejected. It is a legitimate thing for a student to
  share, and refusal drives it into forms the detector misses.
- Redact the digits and keep the message: rejected for v1. The surrounding sentence
  is usually meaningless without them, and a partial redaction invites reconstruction
  across several messages.
- Thirty seconds: rejected as too short to be useful to the person it was sent to.

## Implementation notes

- The exclusion belongs at the write, not the read. A message that is filtered out
  of a query but present in the table has not been protected.
- Ephemeral messages still count toward rate limits. Not persisting is not a
  discount.
- The client timer is presentation. A client that ignores it gains nothing, because
  the message was never stored to begin with.
- The sixty seconds is a named constant shared by client and server.
