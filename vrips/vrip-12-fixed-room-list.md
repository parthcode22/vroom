# VRIP-12: A fixed list of rooms

**Status:** Accepted
**Date:** 2026-10-02
**Author:** Harshal More

## Context

`PRODUCT.md` puts multiple rooms out of v1 scope and names them as the v2
question: do conversations branch once a single room has sustained
participation? The v1 rail still listed four rooms — placements, electives,
hostel, projects — as locked placeholders, each meant to become a GitHub issue
a student could claim. The issues were never filed, and a student contributor
built the four rooms anyway (PR #63).

The code was already shaped for it. VRIP-03 chose one Durable Object per room,
VRIP-07 put a `room` claim in the app token and checks it on the upgrade, and
`reports` carries a `room_id` column with a `campus-live` default. What the
single-room build left unsettled is everything a second room makes ambiguous:
which rooms exist and who decides, what a suspension means when a handle can
be in five places, and what the one emergency control closes.

## Decision

The rooms are a fixed list in `app/lib/rooms.ts`: five ids, each with its copy.
Adding a room is a pull request, not a feature. There is no room creation, no
membership and no discovery; the rail lists all five and that is the room list.

One Durable Object per room, named by its id. The Worker refuses any id not on
the list before it verifies the token, the token is minted for one room and is
only good for that room's socket, and the Worker passes the verified room to the
object in a header, the same way it passes the pseudonym.

Moderation is campus-wide. A suspension and a restore run in every room before
Neon is written, all or nothing: a handle silenced in four rooms and posting in
the fifth is not suspended, so one unreachable room fails the action rather
than half-applying it. The kill switch closes every room under one audit row.
A deletion runs in the room the report names. The console reads every room and
shows one set of numbers, or none if any room cannot be read.

`/room` redirects to the default room, so every existing entry point still
works.

## Consequences

- Win: nothing in the trust boundary moved. The token still carries a handle
  and a room, the upgrade still rejects before the object is reached, and the
  hibernation contract is unchanged. Each room is the v1 room, five times.
- Win: the four rooms are real surfaces for the questions `PRODUCT.md` opens
  with — which elective is manageable, what a company asked — rather than
  locked buttons pointing at issues that did not exist.
- Cost: the rate limit is per pseudonym per object, so five rooms are five
  budgets. At the v1 limit that is a hundred messages a minute for one student
  determined to use all of them. The token-bucket rewrite (#47) is where a
  campus-wide budget belongs if one is ever needed.
- Cost: the console's peak is the sum of per-room peaks, an upper bound rather
  than a reading. Online now is exact: the rooms report who is present and the
  merge counts a handle once.
- Cost: the stats and kill-switch reads are five object calls per console load
  rather than one, and every suspension is five RPCs.
- Risk: the cold-start risk `PRODUCT.md` names is multiplied. Ten students
  spread over five rooms is five rooms that read as abandoned. The launch
  seeding has to cover every room, or the four new ones should start closed.
- Precludes: nothing that was planned. Room creation and discovery remain the
  v2 and v3 questions, gated as before.

## Alternatives considered

- Keep the four locked placeholders: rejected. The issues were never filed, and
  a built room is a better contribution funnel than a disabled button.
- Rooms as a database table with creation in the console: rejected. That is v2,
  gated on v1 showing sustained participation, and a table brings membership
  and discovery questions with it.
- A per-room kill switch: rejected for now. The emergency control is one button
  under pressure; a per-room switch is a feature with a UI, and there is no
  incident yet that needed one.
- Best-effort fan-out, suspending in the rooms that can be reached: rejected.
  It makes Neon say suspended while a room still serves the handle, which is
  the exact inconsistency VRIP-08's ordering exists to prevent.

## Implementation notes

- `app/lib/rooms.ts` is the single list. `isRoomId` guards every boundary that
  takes a room id from outside: the socket upgrade, the token mint, the report
  endpoint and the route loader.
- `workers/upgrade.ts` sets `x-vrooms-room` beside `x-vrooms-pseudonym`; the
  object trusts both, because the binding is the boundary (VRIP-06).
- `moderation.server.ts` fans suspend, restore and set_room_state out through
  `everyRoom`, which converts any failure to `room_unreachable` before a Neon
  write. The audit row for the kill switch has `target_id = 'all'`.
- `readRooms` in `room.server.ts` merges the per-room reads for the console.
- Below 720px the room rail is hidden, so the member sheet carries the room
  list as well.
- `ROOM_ID` is gone from `wrangler.jsonc`, `.env.example` and the Worker env.
