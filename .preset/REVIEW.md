# V Rooms — code review

Reviewer: code-reviewer (no shared history with the implementer)
Scope: `app/`, `workers/`, `scripts/`, `test/`, config, against VRIP-01..08,
`.preset/ARCHITECTURE.md`, `.preset/IMPLEMENTATION.md`, `AGENTS.md` and
`prototype.html`.

Note: `preset://agents/code-reviewer`, `preset://skills/code-review` and the
archetype constraints could not be read — no MCP resource-read tool is exposed to
this agent. The review was run against the repo artifacts and the accepted VRIPs.

## Verdict

**Approve with required changes.** Four defects block deployment.

The architecture is sound and the hard parts are genuinely right: the token
boundary, the hibernation contract, per-pseudonym rate limiting, the reveal
binding, and the kill switch all survive adversarial reading. I tried to defeat
each of them and failed. That is worth saying plainly, because it is the part
that is usually wrong.

What is wrong is the moderation control plane's own perimeter. **This build is
not safe to run against a real database and real students as it stands.** Two
findings are the reason:

- A suspended moderator keeps every console power, including identity reveal.
  There is no way in this product to remove a moderator.
- The report queue can be flooded and silently truncates at 200 rows, so a
  genuine report can be buried by anyone with a session.

Both are the same failure shape: the student-facing surface enforces suspension
and the moderator-facing surface does not. Neither is architectural. R1–R4 are
localized fixes, and I would re-review only the diff.

Green checks confirm this: `typecheck`, 67 tests and `build` all pass, and none
of the four blockers is the kind of thing they can see.

## Findings

Ranked by severity. Declared gaps from `.preset/IMPLEMENTATION.md` are marked as
such and are not counted against the build.

### H1 — Suspension does not revoke moderator access (HIGH)

`app/lib/require-role.server.ts:40` and `:52`

```ts
if (!actor.member.isModerator || actor.member.deletedAt) { ... }   // :40
if (!member.isModerator || member.deletedAt) { ... }               // :52
```

Both check `isModerator` and `deletedAt`. Neither checks `suspendedAt`.
`isSuspended()` exists at `app/lib/membership.server.ts:42` and is called from
exactly one place: `app/routes/api.socket-token.ts:26`.

Failure scenario. A moderator abuses the console. A second moderator suspends
them. `moderation.server.ts:164-189` runs correctly: the Durable Object closes
their sockets with 4003, `setSuspended` writes `suspendedAt`, an audit row is
written. The suspended moderator then loads `/mod`. `requireModerator` passes.
They have the full report queue, `suspend`/`restore` on any account — including
`restore` on themselves — the kill switch, and `reveal`, which returns
institutional email addresses. The only remedy is a `psql` session, which
VRIP-05 exists to eliminate as the response path.

VRIP-05 names role gating as "the entire access control" and VRIP-04 makes the
mapping the most sensitive data in the system. Suspension is the product's stated
remedy and it does not reach the one account for which the remedy matters most.

Fix: `assertModerator` and `requireModerator` must reject `suspendedAt !== null`.
`isSuspended(member)` already expresses it.

### H2 — The report queue can be flooded and silently truncates (HIGH)

`app/routes/api.report.ts:23-63`, `app/db/queries/reports.ts:22-38`,
`app/components/mod/ReportTable.tsx:306-311`

`POST /api/report` requires a session and nothing else. There is no rate limit
of any kind, and it does not call `isSuspended` — a suspended account can still
file reports. The `unique("reports_message_reporter_uniq")` index blocks only the
same reporter reporting the same message twice; distinct messages are unbounded.

`listReports()` is `orderBy(desc(reports.createdAt)).limit(200)` with **no status
filter**, so resolved and dismissed reports consume the same 200 slots.
`ReportTable` renders exactly what the loader hands it: filtering and sorting are
client-side over that payload, and Previous/Next are hardcoded `disabled`.

Failure scenario. A student files a genuine report about a defamatory message.
The reported party, or anyone with a session, then reports 200 other messages —
each call is one `fetch`, no throttle. The genuine report falls off the end of
the loader's 200 rows. It is not on page two; there is no page two. It is
unreachable from the console, and the console is the only surface a moderator
has. Response time is the constraint the whole product is built around, and this
makes the queue unreadable at will.

Each call also costs one Durable Object RPC plus three Neon round trips, so the
same loop is a cost and latency attack independent of the burial.

The added `POST /api/report` endpoint is the right architectural call (see
Deviations below). It is authenticated. It is not rate-limited, and that is the
defect.

### H3 — `history` frames bypass every gate on the socket (HIGH)

`workers/room-do.ts:109-113`

```ts
if (frame.t === "history") {
  const page = db.messagesBefore(this.sql, frame.before, clampLimit(frame.limit));
  this.sendTo(ws, { t: "history", messages: page.messages, hasMore: page.hasMore });
  return;
}
```

This returns before reaching `handleSend`, where the suspension check, the
kill-switch check and `db.checkRate` all live (`:118-154`). There is no
per-connection frame budget anywhere in the object.

Failure scenario. One connected client loops
`{"t":"history","before":<n>,"limit":100}` as fast as the socket accepts writes.
Each frame is a `messagesBefore` scan plus a JSON serialisation of up to 100
rows. A Durable Object is single-threaded, so this starves message delivery,
presence and — importantly — the moderator's `setKilled` RPC for every other
student in the room. The kill switch's whole value is that it lands on the next
frame; it cannot if the object is saturated.

`clampLimit` bounds rows per request, not requests per second. The rate limiter
is correct and is simply not applied here.

### H4 — CSRF on the console action rests on an implicit framework default (MEDIUM-HIGH)

`app/routes/mod.tsx:65-102`

The action reads `request.formData()` and performs moderation with no Origin
check, no Referer check and no CSRF token. A cross-site HTML form POST of
`intent=set_room_state&killed=true`, or `intent=suspend&memberId=…`, is a simple
request that triggers no preflight.

The only thing stopping it is better-auth's default `sameSite: "lax"` session
cookie. Nothing in this repo sets that, asserts it, or tests it — it is inherited
from a dependency default that a future `better-auth` config change or a
`sameSite: "none"` needed for some later embed would silently remove. Given that
this is the endpoint that closes the room and reveals identities, the check
should be explicit and one line.

The JSON endpoints (`/api/report`, `/api/mod/:action`) are incidentally protected
because their `content-type` forces a CORS preflight.

### M1 — A suspended account can spam the room for the life of its token (MEDIUM)

`workers/room-do.ts:49-64`

```ts
this.ctx.acceptWebSocket(server);
server.serializeAttachment(attachment);

if (db.isSuspended(this.sql, pseudonym)) {
  server.close(CLOSE.SUSPENDED, "suspended");
  return new Response(null, { status: 101, webSocket: client });
}
```

The socket is registered as a hibernation socket **with an attachment** before
the suspension check. Closing it therefore fires `webSocketClose` (`:165-176`),
which deserializes the attachment, finds no other socket for that handle, and
broadcasts `"<handle> left"` to the entire room.

Failure scenario. A suspended student still holds a valid app token —
`APP_JWT_TTL_SECONDS` is 900, and VRIP-07 deliberately does not re-check the
token for the life of a connection. They reconnect in a loop. Every attempt
injects a system line into every open client. The honest client stops (4003 is
terminal at `app/lib/room-client.ts:141`); nothing server-side does. Suspension
is supposed to remove someone from the room, and for fifteen minutes it does not.

It also publishes the fact that a suspended handle is trying to get back in, to
everyone.

Fix: check `db.isSuspended` before `ctx.acceptWebSocket`, and reject with a
plain accept/close pair the way `workers/upgrade.ts:39-46` already does.

### M2 — `ensureMember` cannot handle the tombstone the schema defines (MEDIUM)

`app/db/queries/members.ts:56-72`, with `:36`

`findMemberByUserId` filters `isNull(members.deletedAt)`. For a soft-deleted
member `ensureMember` therefore: reads null → inserts → hits the `user_id` unique
constraint → `onConflictDoNothing` returns no rows → re-reads → null →
`throw new Error("ensureMember: no row for user ...")`.

Every request through `requireSession` — `/room`, `/mod`, `/api/socket-token`,
`/api/report` — then 500s into the error boundary, permanently, for that account.

Two consequences beyond the crash:

- `deletedAt` is unusable as the soft delete `AGENTS.md` mandates. The column,
  the comment "Tombstone. Soft delete, never hard delete." (`schema/members.ts:28`)
  and the `deletedAt` guards at `require-role.server.ts:40` and `:52` are all
  unreachable in practice.
- `test/unit/moderation.test.ts` "refuses a tombstoned moderator" passes only
  because it hands `assertModerator` a hand-built record the real read path can
  never produce. This is the same blind spot that hides H1.

Nothing sets `deletedAt` today, so this is latent rather than live. It breaks the
first time the feature is used.

### M3 — The reason for closing the room is silently discarded (MEDIUM)

`scripts/mod.ts:79` sends `{ killed: true, reason: rest[0] ?? null }`.
`app/routes/api.mod.$action.ts:79` parses it into `fields.reason`.
`app/lib/moderation.server.ts:233-249` (`setRoomState`) reads only `fields.killed`
and writes the audit row with no `details`.

Failure scenario. At 2am an operator runs
`npm run mod -- close "reports arriving faster than we can act"` — the exact
invocation the script's own usage text documents — and the audit trail records
`room_close` with nothing about why. VRIP-08 makes the audit trail the record of
moderator action, and this is the action taken under the most pressure. `suspend`
gets this right (`:186`); `set_room_state` does not.

### L1 — Bearer comparison: the comment is wrong, and there is no throttle (LOW)

`app/routes/api.mod.$action.ts:32-38`

```ts
/** Length-independent compare, so the token is not recoverable by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
```

It is length-*dependent*: the early return leaks the token length. The loop
itself is constant-time for equal lengths but is hand-rolled JS the engine is
free to optimise. `nodejs_compat` is on, so `crypto.timingSafeEqual` over encoded
buffers is available and is the right primitive.

Separately, `/api/mod/:action` has no throttle and no lockout, so an attacker
gets unlimited guesses at `MOD_SCRIPT_TOKEN`. Nothing in the repo requires a
minimum length for it. VRIP-08 already records this credential as "genuinely
worse than a login"; the entropy of the secret is currently the only control.

### L2 — A third short touch target, undeclared (LOW)

`app/app.css:895-898`

```css
.row-btn {
  min-width: 44px;
  height: 32px;
}
```

44x32, not 44x44, below 720px. These are the `report` and `block` buttons on a
chat row — the abuse controls a student uses on a phone. `IMPLEMENTATION.md`
deviation 7 declares two knowing exceptions (the rail's `blocks` button and the
kill switch) and does not mention this one.

### L3 — One file over the size limit, and the claim that none is (LOW)

`app/app.css` is 915 lines against `AGENTS.md`'s 200-400 maximum. It is the only
file over: every `.ts`/`.tsx` file in the repo is inside the budget, the largest
being `ReportTable.tsx` at 326 and `room.tsx` at 309.

`IMPLEMENTATION.md` deviation 12 states "Every file in the repo is inside the
budget." That is not accurate. Splitting `app.css` along the seams it already
has — tokens, room, console — is the obvious remedy.

### L4 — A valid token does reach the Durable Object (LOW)

`workers/upgrade.ts:70`

`new Request(request)` copies the client's header set, including
`sec-websocket-protocol` with the token in it, and forwards it to `stub.fetch`.
VRIP-07's actual requirement — "a bad token never reaches the Durable Object" —
holds, and the token carries only a handle and a room, so nothing sensitive
leaks. Deleting the header on the forwarded request costs one line and keeps the
boundary literal rather than incidental.

### L5 — Abnormal disconnects leave the room silently (LOW)

`workers/room-do.ts:178-180`. `webSocketError` broadcasts presence but never
emits the departure line `webSocketClose` does. Cosmetic asymmetry.

## What I tried to defeat and could not

Brief, because it is correct.

**The token boundary (VRIP-07).** `app/lib/app-token.server.ts:46-65` pins
`algorithms: ["HS256"]` in the verify options, so the header's `alg` is never
trusted — no `alg: none`, no RS256→HS256 confusion. `issuer`, `audience` and
`exp` are all enforced by jose with default zero clock tolerance. The room claim
is compared against the room being served (`:59`). `secret()` is called inside
the `try`, so a missing `APP_JWT_SECRET` fails closed to `invalid` rather than
throwing an unhandled error. Verification happens in the Worker fetch handler at
`workers/upgrade.ts:62`, before `env.ROOM.get()` at `:69`. `jti` replay is
unbounded and is an explicitly accepted risk in VRIP-07, correctly reasoned.

**The reveal binding (VRIP-04/05/08).** With no database, the migration's CHECK
has never run, so the application-level precondition is the whole enforcement. It
holds. `resolveIdentity` (`app/lib/identity.server.ts:36-51`) refuses an empty
`reportId` before touching anything, writes the audit row first, and reads only
if that write returned. Its single caller, `moderation.server.ts:131-141`,
resolves a real `reports` row and passes `report.reportedMemberId` —
`fields.memberId` from the script door is **ignored** on this intent, so
`POST /api/mod/reveal {"memberId": "..."}` cannot become a free lookup. I found
no path that writes a reveal without a bound report, and no path that reads an
identity before the audit write. Grep confirms `resolveIdentity` and `user.email`
each have exactly one call site.

**Loader over-fetch.** `room.tsx:35-39` returns handle, moderator flag and room
id only. `mod.tsx:45-58` returns handles throughout: `listReports` and
`listAccounts` use explicit column lists and never join `user`, and `listAudit`'s
`details` jsonb carries only handles and reasons. The email travels once, as an
action result, into `ReportTable`'s component state (`:49`, `:69-76`). The
mapping does not enter a client payload anywhere.

**Hibernation.** Correct throughout, and this is the thing `AGENTS.md` calls the
single most likely source of a confusing bug. Per-socket identity is in
`serializeAttachment` (`room-do.ts:51-56`); every enumeration goes through
`ctx.getWebSockets()` (`:185-201`); the rate window, suspensions, kill state and
peak counters are all DO SQLite, not fields. The instance holds no `Map` or `Set`
— asserted directly at `test/workers/room-do.test.ts:51`, which is the right
assertion to have written.

**Rate limiting.** Genuinely per pseudonym. I could not defeat it with two
sockets, a reconnect, or the wake-up path: the key comes from the verified token
via the attachment, and the counter is a SQLite row, so all three share it.
`test/workers/room-do.test.ts:157-184` tests exactly the case a per-socket
limiter would fail. The fixed window permits a 2x burst across a boundary; that
is fine at this scale and the comment says so.

**The kill switch.** `room-do.ts:123` reads DO SQLite per frame — no Neon in the
hot path. Flippable from the console (`RoomSwitch`) and from
`npm run mod -- close`, both through `performModeration`.

**Prototype fidelity on the two points that were re-decided.** Rows are memoised
with stable keys (`MessageRow.tsx:71`, `MessageList.tsx:110-125`), so appending a
message touches one node — the prototype's full rebuild is gone as required.
Backfill is a scroll-triggered `seq`-cursor request with scroll-anchor
restoration (`MessageList.tsx:55-84`, `room.tsx:188-197`). A phone user can see
who is online: the rails collapse below 1040px/720px and `MemberSheet` carries
the roster and the block controls.

**Handle colours** match VRIP-05: eight entries, orange-to-red band absent, brand
orange reserved for self (`app/lib/utils.ts:13-31`).

## Assessment of the three declared deviations

1. **`POST /api/report` added — justified.** A report writes to Neon and the
   Durable Object cannot reach Neon, so it could not have ridden the socket. The
   architecture had a real hole. Reading the message text back from the object
   rather than trusting the client is the right call: the queue snapshot is what
   was actually said. It is authenticated. It is **not** rate-limited and does
   not check suspension — see H2, which is the defect, not the deviation.

2. **`MOD_SCRIPT_MEMBER_HANDLE` invented — justified.** VRIP-08 says the token
   "resolves to a designated moderator row" without saying how. Resolving by
   handle keeps the audit row readable. Critically, holding the token is not the
   authorisation: `performModeration` re-checks the role
   (`api.mod.$action.ts:86` → `moderation.server.ts:112`), so a leaked token
   still cannot act if the designated row is not a moderator. Carried in
   `.env.example` and `worker-secrets.d.ts`. Correct.

3. **101-then-close on a bad token — justified, and it admits nobody.** The
   rejected socket is created and closed inside the Worker
   (`upgrade.ts:39-46`); `env.ROOM.get()` is never called, so no unauthenticated
   peer reaches the room even briefly. `server.accept()` rather than
   `ctx.acceptWebSocket` is right — it is not a hibernation socket. The
   information leak is that an unauthenticated caller can distinguish 4001 from
   4002, which tells them a token was expired versus malformed; that is
   negligible and is the point of the close-code contract. The residual cost is
   that `/ws` allocates a `WebSocketPair` per unauthenticated request with no
   throttle, which Cloudflare absorbs at this scale.

## Test quality

67 passing tests across 8 files, and the ones that exist are well chosen. The
hibernation suite asserts the property rather than the behaviour — no `Map` or
`Set` on the instance, a frame delivered by handing `webSocketMessage` a socket
pulled from `getWebSockets()` — which is the correct way to test a thing you
cannot force. The upgrade suite covers missing token, absent header, wrong
protocol id, forged signature, wrong room and expiry, each asserted as a close
code rather than an HTTP status. The rate-limit test constructs the exact
interleaving a per-socket limiter would let through. `moderation.test.ts` asserts
the ordering contract — object first, Neon second — including that nothing is
written to Neon when the object is unreachable.

**What a green suite proves here:** the wire protocol, the token trust boundary,
the hibernation properties, the DO's SQLite behaviour, and the ordering contract
in `moderation.server.ts`.

**What it does not prove, beyond what is already declared:** the implementer
correctly records that no test touches Neon, that the `reveal_must_be_bound`
CHECK and the `updated_at` trigger have never run, that `claimPseudonym`'s raw
`NOT EXISTS` fragment is unverified, and that eviction has never been observed.
Add one thing they do not: **there is no test at any level for `api.report.ts`,
`api.socket-token.ts`, `api.mod.$action.ts`, or `mod.tsx`'s loader and action.**
The role check is tested only as `assertModerator` in isolation against
hand-built records. That is precisely the gap H1 and M2 hide in — a fabricated
`MemberRecord` cannot show you that the field set the real read path produces is
different from the field set the guard inspects.

Integration is therefore untested end to end, and the first `db:push` will be the
first time any query in `app/db/queries/*` has executed.

## Required changes

Blocking. Do not run this against a real database with real students until R1–R4
are done.

- **R1 — H1.** Add `suspendedAt` to the moderator guards.
  `app/lib/require-role.server.ts:40` and `:52` must reject a suspended member;
  reuse `isSuspended()` from `membership.server.ts:42` so there is one definition.
  Add a test that a suspended moderator gets 404 from `/mod` and `not_moderator`
  from `performModeration`.
- **R2 — H2.** Rate-limit `POST /api/report` per member, refuse a suspended
  reporter (`isSuspended`), and make the console queue not lose reports: filter
  `listReports()` to `status = 'open'` for the working queue, or paginate. The
  current 200-row unfiltered cap plus disabled pagination means a report can
  become unreachable.
- **R3 — H3.** Apply a budget to `history` frames in
  `workers/room-do.ts:109-113`. Reusing `db.checkRate` with its own key and a
  separate limit is the smallest correct change.
- **R4 — H4.** Add an explicit same-origin check to the `/mod` action
  (`app/routes/mod.tsx:65`) rather than relying on better-auth's default cookie
  `sameSite`.

Should be fixed before launch, not blocking a first deploy behind a closed
audience:

- **R5 — M1.** Move the `db.isSuspended` check in `workers/room-do.ts` above
  `ctx.acceptWebSocket`, so a suspended reconnect cannot broadcast a system line.
- **R6 — M2.** Make `ensureMember` handle a tombstoned row: either re-read
  without the `deletedAt` filter and return the tombstone for the guards to
  reject, or refuse explicitly. Then make `test/unit/moderation.test.ts`'s
  tombstone test exercise the real read path.
- **R7 — M3.** Thread `fields.reason` into `setRoomState`'s audit `details`
  (`app/lib/moderation.server.ts:242-248`).

Cleanups, not blocking:

- **R8 — L1.** Use `crypto.timingSafeEqual` in `api.mod.$action.ts` and fix the
  comment, which currently claims a property the code does not have. Consider a
  simple attempt counter on the endpoint.
- **R9 — L2.** `.row-btn` to 44px tall below 720px, or declare it as a third
  knowing exception in `IMPLEMENTATION.md`.
- **R10 — L3.** Split `app/app.css` (915 lines) and correct deviation 12's claim
  that every file is inside the budget.
- **R11 — L4.** Delete `sec-websocket-protocol` from the forwarded request in
  `workers/upgrade.ts:70`.
- **R12 — L5.** Have `webSocketError` emit the departure line, matching
  `webSocketClose`.

Blocked on Boss, unchanged by this review and not counted against the build: no
database exists, so no migration has run and the reveal CHECK is unexercised; no
V Auth client is registered, so the OIDC handshake has never executed; no
deployment name. Both product blockers — the moderation roster with a
response-time commitment, and the launch moment with a kill date — are still
open, and R1 is a reminder of why the roster question matters: the product has no
answer today for a moderator who has to be removed.
