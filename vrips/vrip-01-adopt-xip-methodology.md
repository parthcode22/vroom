# VRIP-01: Adopt XIP methodology for decision records

**Status:** Accepted
**Date:** 2026-08-12
**Author:** Harshal More

## Context

V Rooms is being built by a rotating set of student contributors and by AI agents,
neither of which carries memory between sessions. Contributors will join mid-project,
work on one issue, and leave. Agents start every session cold. Without a written
record of why the system is shaped the way it is, every constraint gets re-derived
from the code, and the ones that are not visible in the code get violated.

Two constraints in this project are invisible in the code and expensive to violate:
the Durable Object hibernation contract, and the rule that the account-to-pseudonym
mapping never leaves the users table. Both will be broken by a well-meaning
contributor unless the reasoning is written down where they will read it.

## Decision

Adopt XIPs as this project's decision-record format, prefixed `VRIP`, numbered
sequentially from 01, stored in `/vrips/` at the repo root and referenced from
`AGENTS.md` so agents load them automatically.

## Consequences

- Win: a contributor or agent can read why before changing what.
- Win: proposals get argued in a document, where changes are cheap, instead of in a
  rejected PR, where they are not.
- Cost: overhead on every non-trivial change, and the discipline decays quietly if
  the threshold is set too low.
- Risk: XIPs written after the code ships become documentation rather than
  decision-making, which loses most of the value.
- Precludes: nothing technical.

## Alternatives considered

- Plain ADRs: rejected only because a project-specific prefix makes numbers stable
  and citable in conversation. Functionally the same system.
- Notion or a wiki: rejected because docs that do not travel with the code in git
  go stale and are not loaded by agents working in the repo.
- No decision records: rejected. This is the failure mode the project cannot afford
  given the contributor turnover it is explicitly designed around.

## Implementation notes

Threshold: write a VRIP for auth chain changes, data model changes, the realtime
transport, anything touching the identity mapping, and any moderation policy change.
Do not write one for bug fixes, UI tweaks, or single-file refactors.
