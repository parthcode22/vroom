# VRIP-04: Pseudonymous identity, with server-side attribution retained

**Status:** Accepted
**Date:** 2026-08-12
**Author:** Harshal More

## Context

V Rooms shows students a handle and nothing else. The open question was what the
platform itself retains: whether the V Auth account behind a pseudonym stays
readable to VOSS, or is thrown away so that nobody, including us, can reverse it.

The sibling products answer this the other way. vask and confess derive identity as
`sha256(marshalled SSH public key)` and never store the raw key, so VOSS genuinely
cannot identify a vask user. That is only available to them because they never learn
who the key belongs to in the first place.

V Rooms cannot copy it. V Auth hands us a verified student, and PRODUCT.md requires
one stable pseudonym per account, which forces a per-account lookup key. The college
is a few thousand people and we hold the full V Auth user list, so any deterministic
derivation from the account subject — hash, HMAC, or otherwise — is reversible by
enumerating those few thousand subjects and comparing. There is no middle ground at
this scale that is anything more than theatre.

So the choice is binary: verified membership with a readable mapping, or genuine
anonymity with no membership guarantee. Given that institutional buy-in from VIT is
a top-three risk and moderation capacity is the top one, an incident that VOSS
cannot act on decisively is the outcome that ends the project.

## Decision

V Rooms is pseudonymous, not anonymous. Students see only handles. VOSS retains a
readable mapping from pseudonym to V Auth account, including the institutional
email, and moderators can resolve it online in order to act on abuse and, where
necessary, to escalate to the VIT administration by name.

The mapping is held in a single table in Neon and reached through exactly one
function. It never enters the app JWT, the Worker, or the Durable Object.

## Consequences

- Win: a report can end in a real remedy. Suspension, and escalation with a name
  where the incident warrants it, rather than a shrug.
- Win: this is defensible to the administration ahead of launch, which the
  recognition proposal depends on.
- Win: the socket layer stays structurally blind. The token carries a pseudonym and
  a room claim only, so a compromised Worker or Durable Object yields no identities.
- Cost: the mapping is both a breach target and a disclosure target, and the
  obligation sits with VOSS rather than a third party. This risk is accepted, not
  mitigated away.
- Cost: students must be told plainly that VOSS can see who they are. Anonymity here
  is between students, never between a student and the platform, and the product
  must not imply otherwise anywhere in its copy.
- Risk: a moderator with the connection string can read the mapping outside the
  sanctioned path, and no audit row is written when they do. The audit trail is
  therefore honour-system with respect to whoever holds database credentials.
  Narrowing who holds them is the only real control.
- Precludes: any later claim that V Rooms is anonymous in the vask sense. Reversing
  this decision after launch does not un-retain what was already collected.

## Alternatives considered

- The vask model, `sha256` of a key with no mapping retained: rejected because it
  cannot coexist with verified college membership and a stable per-account
  pseudonym, which are both v1 requirements.
- HMAC of the V Auth subject under a server secret: rejected as false comfort. With
  a few thousand known subjects, the mapping is recovered by enumeration in
  milliseconds. It would have looked like a control while being none.
- Mapping encrypted at rest under an offline key: rejected because it makes the
  reveal a manual out-of-band ceremony, which is exactly wrong when the constraint
  is response time. Correct if the answer to "does moderation need a name" had been
  no; it is yes.

## Implementation notes

- Refined during architecture, 2026-08-12: the `members` table holds pseudonym,
  moderator flag, suspension and tombstone, and carries NO email and NO V Auth
  subject. Both already exist exactly once in better-auth's own tables, and a
  second copy of the most sensitive data in the system is the thing this VRIP
  exists to avoid. The mapping is the foreign key `members.user_id`, joined only
  inside `identity.server.ts`. No other module reads it.
- Every resolution writes an audit row: who asked, which message or report it was
  bound to, and when.
- A reveal must be bound to a specific message or report rather than answering a
  bare "who is this handle". The binding is what makes the audit trail meaningful.
- The email never leaves the server. It is not in the JWT, not in any socket frame,
  and not in any client payload.
- Restrict resolution to the moderator role, checked server-side before the query,
  per the house rule that every action checks permissions before executing.
