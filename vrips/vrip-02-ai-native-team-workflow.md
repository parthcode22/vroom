# VRIP-02: Run the build through the preset ai-native-team workflow

**Status:** Accepted
**Date:** 2026-08-12
**Author:** Harshal More

## Context

V Rooms is a new product with an unusually bad failure mode: the thing most likely to
go wrong is not a bug but shipping an anonymous chat to a college without moderation
capacity or institutional buy-in. That is a planning failure, and planning failures
are not caught by code review. The temptation with a small MVP is to start writing
the Worker immediately, which is exactly how the moderation and launch questions get
deferred past the point where they can be answered.

The project also spans several contributors and clients, so the process state needs
to live somewhere both a human on a phone and an agent in a terminal can read.

## Decision

Run this build through the preset MCP server on the `ai-native-team` archetype with
intent `new-product`, so every human gate stays in place: product definition,
architecture, implementation, code review, QA, deployment. Process artifacts live in
`.preset/`; `.preset/state.json` holds only the project pointer.

## Consequences

- Win: the product definition and architecture gates force the moderation, launch,
  and custody questions to be answered in writing before code exists.
- Win: any client that opens the repo resumes the same phase and decisions.
- Cost: slower to first commit than opening an editor and starting.
- Cost: `new-product` intent keeps every human gate, so the build stops and waits
  for approval at each one. This is the point, but it is friction.
- Risk: the phase machine can become theater if artifacts are written to unlock the
  next phase rather than to think. The stated rule is that no artifact is
  hand-fabricated to advance.
- Precludes: a same-day launch of the full product. A deliberately minimal v1 can
  still be built quickly, but not by skipping the definition gate.

## Alternatives considered

- Build first, document later: rejected. The highest risk here is a planning risk,
  and planning risks are invisible to code review.
- A lighter intent such as `feature`: rejected for v1, because auto-crossing gates on
  a product that holds a de-anonymisation mapping is the wrong trade. Appropriate
  later for additive UI work.

## Implementation notes

Isolated specialist agents are a requirement of this archetype, not a nicety: a
reviewer that shares the implementer's context inherits the implementer's blind
spots. Run the phase loop in a client that can spawn genuinely separate agents.
Where a client cannot, say so rather than collapsing the team into one context.
