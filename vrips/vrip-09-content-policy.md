# VRIP-09: Content policy — normalise, score by target, enforce in three tiers

**Status:** Accepted, amended by VRIP-14
**Date:** 2026-08-13
**Author:** Harshal More

## Context

Campus Live went live with real students in it and the register is what you would
expect from an engineering campus: Hinglish and Marathi profanity, mostly
affectionate, constantly. `bc`, `mkc`, `bkl`, `bsdk`, `chutiya` and every spelling
of each.

Reporting is manual and reactive, and the roster is one person. Nothing acts before
harm, and nothing acts while that person is asleep.

Three things make a naive wordlist the wrong answer.

Evasion is one keystroke. `mkc` becomes `m.k.c`, `mkcc`, `MKC`, `म क च`. A literal
match catches the first message and nothing after it.

False positives cost more than false negatives here. `bc` is also "because"; `mc` is
also a compere. Friends abusing each other is the normal register, and a filter that
blocks it makes V Rooms feel like a school intranet, which kills the only thing it
has over the WhatsApp group a student is already in.

The word is a weak signal. What actually endangers VOSS is abuse aimed at an
identifiable person, and the worst case contains no profanity at all: a named
professor plus an accusation. `.preset/PRODUCT.md` lists institutional risk as
top-three, and no swear list addresses it.

## Decision

Detect on a normalised form, score on proximity to a target rather than on the word
alone, and act in three tiers.

**Normalisation** runs before any comparison: lowercase, strip diacritics, collapse
runs of a repeated letter, remove separators sitting between letters, and
transliterate Devanagari to Latin. `M.K.C`, `mkcc` and `म क च` all reduce to `mkc`.

**Targets** are what turn a word into an incident: a room handle, an honorific
followed by a capitalised name (`Prof Kulkarni`, `Dr Sharma`, `sir Reddy`), two or
more consecutive capitalised words, or a division or class reference. A target
within a short window of a profanity is the composite signal.

**Three tiers:**

- _Count._ Profanity with no target nearby. Nothing is blocked and nothing is shown
  to the sender. The room object tallies it per handle. Volume far above the room's
  norm surfaces the handle to a moderator; the word never does.
- _Confirm._ Personal data and named individuals — a phone number, an email, a
  social handle, an honorific plus a name. The client shows "are you sure?" and the
  message still sends if the person means it. The server records that they were
  warned, which is what makes a later suspension defensible.
- _Block._ Profanity within range of a target, slurs, and sexual content aimed at a
  person. Refused by the room object, and filed for a moderator with the text
  attached so it arrives without anyone reporting it.

Three blocked attempts from one handle inside ten minutes suspends that handle
automatically. The room does not wait for a moderator to wake up.

## The constraint that shapes the implementation

The Durable Object cannot write a report. Reports live in Neon and are keyed by
`members.id`; the object knows only pseudonyms, and resolving a pseudonym to a
member is precisely what VRIP-04 forbids it from doing. Giving the object that
ability to save a round trip would undo the containment property the whole identity
model rests on.

So detection and enforcement happen in the object, and the object records a flag in
its own SQLite: pseudonym, snippet, tier, time. The console — which is server-side,
holds Neon and is allowed to resolve identity — drains those flags on load and
materialises them as reports. The object stays identity-blind, Neon stays the report
store, and the console is the bridge.

Auto-suspension works the same way: the object suspends the pseudonym in its own
table, which takes effect on the next frame, and the console mirrors it to Neon on
the next drain.

The client runs the same detector for the confirm dialog, and the server re-runs it
regardless of what the client did. The dialog is a nudge, not a control — it is
JavaScript in someone's browser and a hostile client simply never asks.

## Consequences

- Win: something acts before harm rather than only after a report.
- Win: the composite signal targets the thing that actually threatens the project,
  including the defamation case that carries no profanity.
- Win: casual profanity stays legal, so the room keeps the register that makes it
  worth using.
- Win: repeat offenders are handled while the single moderator is asleep.
- Cost: a wordlist is maintenance, and a Hinglish one is never finished.
- Cost: the confirm dialog spends an interruption budget. Firing it on everyday
  slang would train students to click through, which is why _Count_ exists and why
  the confirm list stays narrow.
- Risk: a motivated student defeats any regex within days. This buys time and
  evidence; it is not the control. The control is still a human who responds, which
  is why the roster question stands.
- Risk: false positives on a name heuristic will occasionally block something
  legitimate. Blocked attempts are recorded, so the sender can be unblocked and the
  pattern corrected.
- Precludes: nothing. A model-based classifier can replace the scorer later behind
  the same interface.

## Alternatives considered

- Plain wordlist, exact match: rejected. Defeated by one full stop.
- Block all profanity: rejected. It is most of the room's normal speech, it would be
  routed around immediately, and it does not catch the case that actually endangers
  VOSS.
- Confirm dialog on everything, including `bc`: rejected. It would fire dozens of
  times a day and become noise, and a warning nobody reads is worse than no warning
  because it launders the decision.
- Client-side only: rejected. Not a control.
- An LLM classifier per message: rejected for v1. Latency in the send path, cost per
  message, and a dependency the free plan does not carry. Reconsider once the
  wordlist is visibly losing.

## Implementation notes

- Detector is one pure module shared by client and server so the two can never
  disagree. Wordlists live in their own file; they will grow.
- Normalisation before matching, always. An unnormalised comparison is the bug.
- The proximity window is measured in words, not characters.
- Flags carry a snippet, never the whole message, and never anything resolving the
  author beyond the handle.
- Every tier and threshold is a named constant, not a literal buried in a branch.
