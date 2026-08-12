# Product Definition: V Rooms

## Problem

Students at VIT can only talk to people they already know. WhatsApp requires a phone
number or an invite, Instagram requires the other person's account to be open to
messages, and department or division groups only contain people you were already
placed alongside. There is no surface on which a student can reach the wider college
without a pre-existing connection, and no surface on which they can ask something
they would not put their name to: which elective is actually manageable, what a
company asked in the second round, whether they are the only one stuck on a lab.
The result is that a campus of several thousand verified peers behaves like a set of
disconnected private graphs.

V Rooms inverts the model. Instead of People to Groups to Conversations, it is
College to Conversations to People: the community already exists because everyone
belongs to the same campus, so a student can speak into it on day one without
joining anything or knowing anyone. Every participant authenticates through V Auth,
so the platform knows each person is a real member of the college while other
students see only a pseudonym.

## Target user

A currently enrolled VIT student, primarily second and third year, on a phone, on
college wifi or mobile data. They already hold a V Auth account because it is the
same identity used for VERP. They have a question, an opportunity, or a project they
want to put in front of the college, and no existing channel that reaches beyond the
people already in their contacts. Secondary user: the VOSS moderator, who needs to
act on abuse without publicly revealing who wrote what.

## In scope

- V Auth OIDC login, exchanged for a short-lived app JWT validated on socket connect
- One pseudonym per V Auth account, assigned on first login, stable thereafter
- Campus Live: a single college-wide real-time conversation
- Send and receive messages in real time
- Live count of students currently connected
- Recent message history on join
- Report a message, which writes a record that surfaces in the moderator console
- Client-side block of a pseudonym
- Per-account rate limiting
- Moderator actions runnable from a script: delete a message, suspend an account,
  and a global kill switch that closes the room
- A moderator console carrying the report queue, suspension, the kill switch and the
  audit trail, gated on a moderator role checked server-side (VRIP-05)
- Full message history, retained and scrollable rather than a rolling window
- Mobile-first web client

## Out of scope

Everything below is deliberately excluded from v1. Each one is a candidate GitHub
issue that a student contributor can pick up, which is itself part of the product
strategy: the product is the funnel into contributing to VOSS.

- Multiple rooms, room creation, room membership
- Discovery, trending, topic tags, room lists
- Private messaging, connection requests, mutual identity reveal
- Reputation, karma, badges, any public popularity metric
- Threads, replies, reactions, mentions, editing, message search
- File or image upload
- An out-of-band moderator alert when a report is filed. Reports write a record; at
  v1 scale a moderator checks the console rather than being pushed to
- Analytics, dashboards, or any reporting surface beyond the audit trail
- Push notifications
- Native mobile apps
- Department, division, or class groups
- Voice or video

## Success metrics

Registrations are explicitly not the metric. The MVP exists to answer one question:
will students participate more openly in a college-wide community when they are
pseudonymous but everyone present is a verified member of their college?

- Activation: share of authenticated students who send at least one message
- Daily participation: distinct students sending a message per day
- Conversation density: share of messages that receive a reply within ten minutes
- Concurrency: peak simultaneous connections, since a live room needs simultaneous
  presence to feel alive at all. v1 is built for 10-20 concurrent, not the 70-100
  first assumed; the launch is a seeded experiment, not an open release
- Retention: share of first-day participants who return on a later day
- Contribution conversion: issues filed by non-VOSS students, and PRs opened against
  those issues
- Strongest qualitative signal: students opening V Rooms without VOSS prompting them

## Phases

1. **v1 — Campus Live.** Goal: prove the hypothesis. Scope is the In scope list
   above. Success criteria: the activation and concurrency metrics above, measured
   over a fixed window with a kill date decided before launch. Risk: high, because
   a live chat with low concurrency reads as abandoned.
2. **v2 — Rooms.** Goal: test whether conversations naturally branch. Create and
   enter topic, event, or project rooms. Gated on v1 showing sustained
   participation, not on v1 merely working.
3. **v3 — Discovery.** Goal: make rooms findable once there are enough to need it.
   Active, recent, trending. Explicitly deferred: with one campus and a handful of
   rooms, a list sorted by last activity is discovery.
4. **v4 — Private interaction.** Connection requests, then pseudonymous private
   chat, then mutual identity reveal. This is the phase that turns conversation into
   real-world collaboration, and it is where the product either delivers on "meet
   people" or reveals itself to be a feed.

## Revision history

Revision 2, 2026-08-12. Moderator console moved into scope (VRIP-05) after the
out-of-band alert was cut, since a report queue with no alert and no surface is a
queue nobody reads. History fixed as fully retained and scrollable. Concurrency
target set at 10-20. Identity model settled in VRIP-04: pseudonymous to students,
attributable to VOSS.

## Risks and unknowns

- **Cold start.** A live room with four people is worse than the WhatsApp group the
  student is already in. Mitigation: launch attached to a specific event or week,
  and seed with VOSS contributors present from minute one. Unresolved: which event.
- **Moderation capacity, and it is the top risk.** Anonymity between students does
  not reduce harm, only impunity. Attribution after the fact does not undo a
  defamatory message about a named student or professor that spread in twenty
  minutes. Detection and response time is the real constraint, and a student lab
  cannot staff it around the clock. Unresolved: who is on duty, and what the
  response-time commitment is.
- **Institutional risk.** VOSS has an open proposal to VIT management for
  recognition as a student technical society. One harassment incident traceable to a
  VOSS-run anonymous app could end that. The administration should be brought in
  deliberately before launch rather than discovering the product afterwards.
- **Custody of the identity mapping.** Settled in VRIP-04 by accepting the risk
  rather than engineering it away: the map stays readable online so moderation can
  reach a real identity. It remains a breach target and a disclosure target, and the
  obligation sits with VOSS rather than with a third party. Mitigations are
  structural — the map never enters the token, the Worker or the Durable Object; one
  function resolves it; every resolution is bound to a message and audited. Residual
  and unfixed: anyone holding the database connection string bypasses all of that.
- **Anonymity works against the contribution goal.** Reputation is what motivates
  open-source contribution, and a pseudonym is not portable to a resume or a GitHub
  profile. The funnel from anonymous participation to a merged PR loses at every
  step. A voluntary, per-project bind from pseudonym to GitHub handle is the
  candidate fix and is not yet designed.
- **Prior art is not encouraging on safety.** Campus-verified anonymous apps have
  repeatedly produced targeted harassment of named students and staff despite email
  verification, in some cases prompting institutions to push students off the
  platform. Verification alone has not prevented this elsewhere and should not be
  assumed to prevent it here.
- **Differentiation is narrower than it looks.** Against Discord specifically, the
  real advantages are guaranteed college-verified membership and the absence of a
  join step. Discord already provides pseudonymity, topic channels, and discovery.
