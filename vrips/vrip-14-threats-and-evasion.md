# VRIP-14: Block threats and self-harm incitement; close the evasions found in review

**Status:** Accepted
**Date:** 2026-10-06
**Author:** Harshal More
**Amends:** VRIP-09

## Context

A review of VRIP-09's detector against realistic messages found two kinds of gap.

The first is a category VRIP-09 never listed. `I will beat you up after class` and
`everyone hates you, kill yourself` contain no profanity, no named target and no
accusation, so they score nothing and post. `I will rape you` scored only _count_,
because `rape` is a sexual term and `you` is not a target in VRIP-09's sense.
Under VRIP-13 every participant is anonymous, so the person on the receiving end
cannot tell a joke from a classmate who means it, and the room is the only thing
standing between the message and them.

The second is evasion the normaliser was meant to defeat and did not:

- Spaced letters: `c h u t i y a` and `b h e n c h o d` were rejoined without the
  `ch` fold the wordlists rely on, so they never compared equal. `m k c` only
  worked because it has no digraph in it.
- Masking: `f*ck` split into `f` and `ck`; `chut1ya` and `b1tch` kept their digits.
- Invisible and look-alike characters: a zero-width space split a word in two,
  Cyrillic `с` and `а` were stripped rather than read as `c` and `a`, and
  full-width or mathematical letters (`ｆｕｃｋ`, `𝐟𝐮𝐜𝐤`) were stripped too.

## Decision

Two new categories, both scored _block_ with or without a target:

- **threat**: violence aimed at the reader, written as a second-person phrase
  (`kill you`, `beat you up`, `rape you`, `maar dunga`, `goli maar`).
- **selfharm**: telling someone to harm themselves (`kill yourself`, `kys`,
  `mar ja`, `phansi laga le`).

They block alone because the target is built into the phrase: `you` is always
present. Like every block, the attempt is refused, filed for a moderator, and
counts towards VRIP-09's three-in-ten-minutes auto-suspension.

A student writing about themselves (`I want to kill myself`) matches neither list
and is never blocked. Refusing a student in distress would be the worst possible
response. What the room should say to them instead is a separate decision.

The normaliser gains, in order: compatibility folding (NFKD) so full-width and
mathematical letters become plain ones; a confusables map for the Cyrillic and
Greek letters that look Latin; zero-width characters kept inside the word they
sit in; a masking pass that reads digits and `@ $ !` as the letters they stand
in for and drops `*`; and the digraph fold on rejoined initials. A masked word
is also compared by its vowel-dropped skeleton, because `ch*tiya` is missing a
letter that no mapping can restore.

## Consequences

- Win: the messages most likely to make a student leave and not come back are
  refused before anyone reads them, and a moderator sees every attempt.
- Win: each evasion above now costs more than one keystroke.
- Cost: banter in the same words is refused. `I'll kill you if you're late`
  is blocked and the sender has to rephrase. The lists are second-person phrases
  rather than verbs so that `this assignment is killing me` stays legal, and the
  ambiguous Hinglish phrases carry guards (`lecture maar dunga` is bunking, not
  violence; `mar ja raha hu` is exhaustion).
- Cost: masking is applied only to a word that contains both a letter and a
  digit or mask character, so `4pm` and `cs101` are read as masked words. They
  cannot match a term today; a short term added later could make them.
- Risk: as VRIP-09 says, a motivated student defeats any list within days. This
  buys time and evidence. The control is still a moderator who responds.

## Alternatives considered

- Score threats as _confirm_: rejected. The dialog is a nudge the sender clicks
  through, and confirm-tier flags are never drained to moderators, so a threat
  sent anyway would reach its target and leave no report. Draining confirm flags
  as well would bring every phone-number nudge into the report queue.
- Treat `you` as a target, so any profanity beside it blocks: rejected. `bc you
are so late` is the room's normal register and would block constantly, which is
  exactly what VRIP-09 rejected.
- Block self-disclosure along with incitement: rejected, for the reason above.

## Implementation notes

- Threat and self-harm phrases are not indexed under vowel-dropped skeletons.
  Short skeletons of phrases collide with ordinary text (`beat you` would become
  `bt y`, which is `but y`).
- The confusables map is data and lives in `policy-words.ts` beside the
  Devanagari table. Both are applied character by character before folding.
