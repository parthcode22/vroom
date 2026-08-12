# Implementation: V Rooms

Built to `.preset/ARCHITECTURE.md`, VRIP-01 through VRIP-08, and the approved
interface at `prototype.html`. One Cloudflare Worker: React Router v8 in
framework mode serves the room and the console, and `RoomDurableObject` is
exported from the same entry.

Verified state after the code-review rework:

```
npm run typecheck   exit 0   (wrangler types + react-router typegen + tsc)
npm test            exit 0   124 tests, 13 files
npm run build       exit 0   server 2,008.68 kB raw / 446.54 kB gzip
```

Nothing is committed. The working tree is left for review.

---

## Rework after code review

The code-review gate rejected the build with four blockers and sent it back to
implementation. All four are fixed, along with M1-M3 and L1-L3.

**Every fix below was checked against the unfixed code first.** Each new test was
run with its fix reverted and asserted to fail, then run again with the fix in
place. A test that passes either way proves nothing, and the first version of the
suspended-history test was exactly that — it was rewritten until it discriminated.

The gate's most useful finding was not any single defect. It was that **no test
at any level touched `api.report.ts`, `api.socket-token.ts`, `api.mod.$action.ts`
or `mod.tsx`'s loader and action**, and that the role check was exercised only as
`assertModerator` against hand-built records. That is precisely where H1 and M2
hid: a fabricated `MemberRecord` cannot show you that the field set the real read
path produces differs from the field set the guard inspects. Five new test files
close that gap.

### H1 — suspension revokes moderator access

`app/lib/require-role.server.ts`. `requireModerator` and `assertModerator`
checked `isModerator` and `deletedAt` and never `suspendedAt`, so suspending a
rogue moderator closed their sockets and left them the console: the kill switch,
`restore` on themselves, and `reveal`, which returns an institutional email
address. Both guards now go through `isSuspended()` from `membership.server.ts`,
which covers `suspendedAt` and `deletedAt` in one definition — so the two checks
cannot diverge again.

Every other consumer of a member record was audited for the same omission:

- `api.socket-token.ts` already called `isSuspended`. Unchanged.
- `api.report.ts` did not. It does now (H2).
- `mod.tsx` and `api.mod.$action.ts` reach it through the two guards above.
- `moderation.server.ts`'s `requireMember` deliberately does **not** check the
  target: the account being suspended or restored is expected to be suspended,
  and checking there would make `restore` impossible.
- `room.tsx`'s loader takes a session only. A suspended student can still load
  the page and is refused the token, which is the existing designed behaviour —
  the socket, not the HTML, is the thing suspension removes.

Covered by: `test/unit/route-mod.test.ts` (a suspended moderator is refused the
loader, refused all six intents with nothing enforced and nothing audited, and
cannot restore itself; a tombstoned one is refused the same way),
`test/unit/moderation.test.ts` (a suspended moderator is refused every intent at
both front doors), `test/unit/members-query.test.ts` (a suspended moderator read
through the real query path is refused — the assertion a hand-built record could
not make).

### H2 — the report queue no longer floods or truncates silently

Three separate defects, all fixed.

`app/routes/api.report.ts` had no rate limit and no suspension check. It now
runs, in order: same-origin, session, `isSuspended`, then a budget of 10 reports
per 10 minutes per member counted in Neon via `countRecentReportsBy`. All of it
sits **before** the Durable Object RPC, so a flood is refused without spending an
object call or the three Neon round trips that follow it.

The budget is a database count rather than an in-memory counter on purpose: a
Worker isolate is not a place to keep one, and the same member arriving on a
different isolate must see the same budget.

`app/db/queries/reports.ts` ordered by `createdAt desc` with `limit(200)` and no
status filter, so resolved reports consumed the same 200 slots. `listReports`
now orders open reports first, newest first within each group, with a real
`limit`/`offset` on a 50-row page, and `countReports()` was added.

`app/components/mod/ReportTable.tsx` hardcoded Previous and Next to `disabled`.
They are now links, the footer states the page number, the page count and the
total, and it says out loud that the filter box acts on the current page only.
Silent truncation on a safety queue was the actual defect, and there is now no
truncation to be silent about: every row is reachable. `app/routes/mod.tsx`
reads `?page=`, clamps junk to 0, and returns `page`, `pageCount` and
`totalReports`.

Covered by: `test/unit/reports-query.test.ts` (the emitted SQL is asserted
through a `drizzle-orm/pg-proxy` stub driver — open-first ordering ahead of the
recency tiebreak, limit and offset, a negative page clamped, and a fixture of one
genuine open report behind 260 newer resolved ones still arriving on page one),
`test/unit/route-api.test.ts` (a suspended reporter, a tombstoned reporter, and a
flood all refused before the object is touched; the window asserted to be
bounded), `test/unit/route-mod.test.ts` (the loader passes the page through and
returns the total, so the console can show what it is not showing).

### H3 — `history` frames are gated and budgeted

`workers/room-do.ts` returned the history page before reaching any of the checks
in `handleSend`. A client looping `{"t":"history","before":n,"limit":100}`
starved a single-threaded object — including the moderator's `setKilled` RPC,
whose entire value is that it lands on the next frame.

History now goes through `handleHistory`, which checks suspension and then spends
a budget of `RATE_LIMIT_HISTORY_PER_MINUTE` (default 30) on the rate key
`history:<pseudonym>`. The key is separate from the send budget so that
backfilling a long scrollback never costs a student their voice, and the colon
cannot collide with a pseudonym because the charset CHECK is `[a-z-]` and digits.

**One deliberate departure from the review's wording.** The review asked for the
suspension, kill-switch and rate checks. The kill switch is *not* applied to
history, and should not be: the room's own copy says "You can read, you cannot
post", and `onJoin` already delivers a page of history to a killed room. Gating
backfill on the kill switch would make the scrollback of a closed room readable
for the first 50 messages and not beyond, which is worse than either consistent
answer. The starvation this blocker is about is the rate limit's job, and that is
applied.

One client-side consequence had to be fixed with it: `app/routes/room.tsx`'s
`onError` did not clear `loadingMore`, so the first refused backfill would have
left the loading row spinning forever and blocked every later page. It clears it
now. This is a regression the fix introduced, found by reading the client rather
than by a test — there are still no component tests.

Covered by: `test/workers/room-do.test.ts` (a fourth history frame is
`rate_limited` with a `retryAfter`; a client that has spent its whole history
budget can still send a message, proving the budgets are separate; and a
suspended handle holding an accepted socket is refused history rather than served
— built by hand with `acceptWebSocket` and a `WebSocketPair`, because the fetch
path now refuses a suspended handle before accepting it at all).

### H4 — an explicit same-origin check on every state-changing action

`app/lib/origin.server.ts` is new and holds two functions:

- `isSameOrigin(request)` for the cookie-authenticated doors. It accepts
  `sec-fetch-site: same-origin` and `none`, refuses `cross-site` **and**
  `same-site` (V Rooms is one Worker on one origin), falls back to comparing
  `Origin` against the request's own origin, and refuses a request that carries
  neither header rather than assuming the best.
- `isBrowserCrossOrigin(request)` for the script door, which authenticates with a
  bearer header a cross-site page cannot set without a preflight. It admits a
  caller with no browser metadata — which is what `scripts/mod.ts` is — and
  refuses a browser that announces itself as cross-origin.

Applied to `mod.tsx`'s action, `api.report.ts`, `api.socket-token.ts` and
`api.mod.$action.ts`. On the console action the check runs **before**
`requireModerator`, so a cross-origin post cannot be used to probe who holds the
role: a student and a moderator get the same 403.

Covered by: `test/unit/origin.test.ts` (both functions across every header
combination, including a forged `Origin` failing to override honest fetch
metadata), plus cross-origin cases on all four routes in the two route test
files.

### Cleanups

- **M1** — `workers/room-do.ts` checked suspension *after* `ctx.acceptWebSocket`
  and `serializeAttachment`, so closing the socket fired `webSocketClose` and
  broadcast `"<handle> left"` to the whole room. A suspended account holding a
  still-valid token could inject a system line on a loop for 15 minutes. The
  check moved above the accept, and rejection now goes through `rejectSocket`,
  the same plain accept-and-close `workers/upgrade.ts` uses. Tested: three
  reconnects produce zero system lines in a watcher's frame log.
- **M2** — `ensureMember` threw on a tombstoned row, because the read filters
  `deletedAt` and the insert then loses to the `user_id` unique index. Every
  request that account made would have 500'd forever, which made `deletedAt`
  unusable as the soft delete `AGENTS.md` mandates. It now falls back to
  `findAnyMemberByUserId` and returns the tombstone for the guards to reject.
  Tested through the real read path in `test/unit/members-query.test.ts`, which
  is the point: the old tombstone test used a record the read path could never
  produce.
- **M3** — `setRoomState` dropped `fields.reason`, so
  `npm run mod -- close "reports arriving faster than we can act"` recorded a
  `room_close` row with no reason. It is threaded into the audit `details` now,
  matching what `suspend` already did. Tested in `route-mod.test.ts`.
- **L1** — `tokensMatch` claimed a timing property it did not have. It now
  hashes both values with SHA-256 and compares the digests with
  `timingSafeEqual` from `node:crypto`: equal-length inputs, no early return, no
  length leak, and the comment is true. Brute-force throttling was added as
  `RoomDurableObject.checkScriptAuth` — the room object is the only state two
  isolates share — at 10 attempts a minute. It **fails open** when the object is
  unreachable, deliberately: the token is still the control, and an unreachable
  throttle must not take moderation offline during an incident. Both paths are
  tested.
- **L2** — `.row-btn` is 44x44 below 720px. See deviation 7.
- **L3** — `app/app.css` split into three partials. See deviation 12.

Not done, and not in this rework's scope: **L4** (deleting
`sec-websocket-protocol` from the request forwarded to the object — the review
records that the requirement already holds and the token carries nothing
sensitive) and **L5** (`webSocketError` emitting the departure line
`webSocketClose` does, a cosmetic asymmetry).

### What the new tests still do not prove

The declared gaps from the first pass all stand: no test touches Neon, the
`reveal_must_be_bound` CHECK has never run, and there is still no database.

Three new limits are worth naming rather than leaving implied:

- `reports-query.test.ts` and `members-query.test.ts` drive **real drizzle query
  builders** through a stub driver, so the SQL they assert is the SQL that would
  be sent. They do not prove Postgres executes it as described. The open-first
  ordering and the tombstone read still want a live Neon branch.
- The report budget is asserted at the endpoint, not under concurrency. Two
  simultaneous requests from the same member can both read a count below the
  limit and both write. The window is 10 minutes and the overshoot is one
  report, so this is accepted rather than solved with a lock.
- There are still no component or browser tests, which is how the `loadingMore`
  regression above had to be found by reading.

---

## Modules built

### Worker and realtime

| Module | Lines | What it does |
|---|---|---|
| `workers/app.ts` | 25 | Worker entry. Exports `RoomDurableObject`. Checks `/ws` before handing off to the React Router handler, because `createRequestHandler` has no way to return a 101. |
| `workers/upgrade.ts` | 81 | The trust boundary. Reads the token from the second `sec-websocket-protocol` value, verifies with `jose`, checks the room claim, and only then calls `env.ROOM.get()`. Echoes `Sec-WebSocket-Protocol: v-rooms.v1` on the 101. |
| `workers/room-do.ts` | 348 | Hibernation handlers, broadcast, derived presence, kill switch, suspension enforcement, the gated history reader, and the nine RPC methods the console and the script door call. No connection map anywhere — `serializeAttachment` per socket, `ctx.getWebSockets()` for every enumeration. |
| `workers/room-sql.ts` | 271 | DO SQLite: `ensureSchema()` with `schema_version`, messages with a `seq` cursor and soft delete, `room_state`, `suspensions`, per-pseudonym `rate`, stats and peak. |
| `workers/protocol.ts` | 102 | The wire types plus `parseClientFrame`, `clampLimit`, `isSocketAttachment`, and the close codes. Imported by the object and the browser, so the contract cannot drift. |
| `workers/env.ts` | 26 | Small env accessors. Not in the architecture's list; see Deviations. |

### App server

| Module | Lines | What it does |
|---|---|---|
| `app/lib/auth.server.ts` | 118 | better-auth relying party behind a lazy Proxy. `genericOAuth` with `providerId: "voss"`, `pkce: true`, `requireIssuerValidation: true`, `mapProfileToUser` deriving a name, `transaction: false` on the neon-http adapter, `emailAndPassword: false`. |
| `app/lib/app-token.server.ts` | 78 | Mint and verify the app JWT. The only module touching `APP_JWT_SECRET`. Claims are `sub` (handle), `room`, `iss`, `aud`, `iat`, `exp`, `jti` and nothing else. |
| `app/lib/pseudonym.ts` | 73 | The 80 adjectives and 71 animals ported verbatim from `voss-ask`, `crypto.getRandomValues` over a `BigUint64Array`, `%04d` suffix, and the third-collision escalation threshold. Pure, no I/O. |
| `app/lib/membership.server.ts` | 44 | `ensurePseudonym`, the claim-with-retry loop. A collision is a `false` return, never an error; a concurrent claim on the same member is resolved by re-reading rather than looping. |
| `app/lib/identity.server.ts` | 68 | The one function that joins `members` to `user`. Audit row first, read only if that write succeeded. Refuses a call with no `reportId` before writing anything. |
| `app/lib/moderation.server.ts` | 253 | All six actions for both front doors. Re-checks the role, enforces in the object first, records in Neon second. Structured `ModerationError` codes, never raw database errors. |
| `app/lib/require-role.server.ts` | 61 | `requireSession`, `requireModerator` (404, not 403 — a student has no business learning the console exists), `assertModerator` for the token door, and `ModerationError`. Both role checks go through `isSuspended()`, so there is one definition of who is revoked. |
| `app/lib/origin.server.ts` | 44 | `isSameOrigin` for the cookie doors and `isBrowserCrossOrigin` for the bearer door. Added by the rework; see H4. |
| `app/lib/room.server.ts` | 47 | Lazy DO-binding accessor plus `tryRoom`, which is how the console degrades to em dashes instead of failing. |
| `app/lib/room-client.ts` | 204 | Browser socket: token fetch per connect, reconnect with jittered backoff, close-code handling (4001 immediate retry, 4002 sign-in, 4003 terminal), backfill request, `localStorage` block list. |
| `app/lib/auth-client.ts` | 16 | better-auth React client with `genericOAuthClient`. No `signUp` — accounts exist at V Auth. |
| `app/lib/utils.ts` | 53 | `cn`, the eight-colour handle palette, `clockTime`, `auditTime`. |

### Data access

`app/db/index.ts` is the lazy `drizzle(neon(url), { schema })` Proxy singleton.
Schema is one file per domain — `auth.ts` (better-auth's four tables),
`members.ts`, `reports.ts`, `audit.ts`, `relations.ts` — behind
`schema/index.ts`. Queries are one file per domain, `members.ts`, `reports.ts`,
`audit.ts`, with explicit column lists throughout.

`members` carries no email and no V Auth subject, as the architecture recorded.
`claimPseudonym` reproduces `voss-ask`'s guarded single-statement claim:

```sql
UPDATE members SET pseudonym = $1
WHERE id = $2 AND pseudonym IS NULL
  AND NOT EXISTS (SELECT 1 FROM members m2 WHERE m2.pseudonym = $1)
```

`app/db/migrate.ts` applies numbered SQL over a TCP `Pool` on `ws` using
`DIRECT_URL ?? DATABASE_URL`, tracked in `_migrations`, skipping `0000*`.
`0001_reveal_binding_and_timestamps.sql` carries the constraint that matters:

```sql
ALTER TABLE moderation_audit ADD CONSTRAINT reveal_must_be_bound
  CHECK (action <> 'reveal' OR report_id IS NOT NULL);
```

plus vocabulary CHECKs on `actor_kind` and `reports.status`, a `[a-z-]` charset
CHECK on `members.pseudonym`, and a `set_updated_at()` trigger. Every statement
is guarded so the file is re-runnable over a `drizzle-kit push`ed database.

### Routes and interface

`home.tsx` (signed-out, carrying the VRIP-04 copy verbatim and a redirect to
`/room` when signed in), `api.auth.$.ts`, `api.socket-token.ts`,
`api.report.ts`, `api.mod.$action.ts`, `room.tsx`, `mod.tsx`.

Room components: `MessageList`, `MessageRow`, `Composer`, `SystemLine`,
`ConnectionState`, `RoomRail`, `MemberRail`, `MemberSheet`.
Console components: `StatCards`, `RoomSwitch`, `ReportTable`, `AccountTable`,
`AuditList`, `RevealDialog`, `RowMenu`.

`scripts/mod.ts` is the second front door: `close`, `open`, `suspend`,
`restore`, `delete`, `dismiss`, `reveal`. It talks HTTP to the deployment rather
than the database, so it cannot bypass the audit trail, and it prints the row it
caused.

### The two prototype gaps, closed

**Incremental rendering and backfill.** The prototype's `renderLog()` cleared
the log and rebuilt every row on every state change. `MessageList` keys entries
stably and memoises rows, so appending one message touches one DOM node.
Scrolling within 120px of the top requests a page on the `seq` cursor; a loading
row renders at the top while in flight and an end-of-history line when there is
nothing older. Prepending is scroll-anchored — pre-update `scrollHeight` and
`scrollTop` are captured during render and restored in `useLayoutEffect`, with
`overflow-anchor: none` on `.log` so the browser does not fight it. Auto-scroll
to the bottom only fires when the reader is already within 80px of it;
otherwise a jump-to-latest control appears.

**Who is online, on a phone.** The prototype set both rails to `display: none`
below 720px. `MemberSheet` is a bottom sheet on a native `<dialog>`, triggered
from the topbar under 1040px, carrying the member list and the handle panel,
dismissible by backdrop and Escape, with 44x44 targets.

---

## Tests

`npm test` runs two Vitest projects. 124 tests, 13 files, all passing — the 67
in 8 files from the first pass, plus the route and query coverage listed under
"Rework after code review".

**`unit` (Node, 99 tests)** — `test/unit/`

- `pseudonym` — wordlist sizes pinned at 80 and 71 (a changed count means
  someone edited the lists, which is exactly when this should fail), charset,
  four-digit zero-padded suffix, spread across 400 draws, the third-collision
  escalation, and `isValidHandle` rejecting uppercase, underscores, spaces and
  over-length input.
- `app-token` — round trip; **the claim set is asserted to be exactly
  `aud, exp, iat, iss, jti, room, sub`** and to contain no `@`; wrong room
  rejected; expired reported separately from invalid so the client can just
  reconnect; tampered signature, wrong secret and garbage all rejected.
- `membership` — the collision path: three `false` returns escalate to a
  suffixed candidate on the fourth; no candidate repeats within a run; a
  concurrent claim on the same member is picked up by the re-read rather than
  looping; exhaustion throws after eight attempts; a database failure propagates
  instead of being read as a collision.
- `moderation` — **every one of the six intents is asserted to reject a
  non-moderator**, and to leave the object and Neon untouched when it does; a
  tombstoned moderator is refused; the script door gets the same check. Call
  ordering is recorded and asserted: `do, neon, audit` for suspend and delete,
  `do, audit` for the kill switch, `neon, audit` for dismiss (no object leg).
  When the object is unreachable, nothing is written anywhere. Reveal cannot run
  without a report, and an unknown report does not fall through to a bare lookup.
- `identity` — the audit write is asserted to happen **before** the account read;
  the row's shape is asserted; a missing `reportId` throws before either; and
  when the audit write fails the account is never read (this is the path the
  CHECK constraint produces).
- `protocol` — frame parsing accepts the two documented shapes and rejects seven
  malformed ones; limit clamping; attachment version guard.

Added by the rework, and described in full in that section above:

- `origin` — both same-origin predicates across every header combination.
- `route-mod` — `mod.tsx`'s real loader and action: a suspended moderator, a
  tombstoned one and a student all refused; cross-origin refused ahead of the
  role check; the close reason reaching the audit row; the queue's page, total
  and page count.
- `route-api` — the real actions of `api.report.ts`, `api.socket-token.ts` and
  `api.mod.$action.ts`: suspension, the report budget, cross-origin, the bearer
  compare, the attempt throttle and its deliberate fail-open.
- `reports-query` — the queue query's emitted SQL and its behaviour under a
  flooded fixture.
- `members-query` — `ensureMember` over the real read path, including the
  tombstone that used to throw.

**`workers` (workerd via `@cloudflare/vitest-pool-workers`, 25 tests)** —
`test/workers/`

- `upgrade` — a valid token gets a 101 with the subprotocol echoed. Missing
  token, absent subprotocol header, wrong protocol id, forged signature and
  wrong-room token all close **4002**; an expired token closes **4001**; a
  non-upgrade GET gets a 426. Every rejection is asserted to arrive as a close
  code rather than an HTTP error.
- `room-do` — the `ready` frame's contents. **Hibernation contract**: per-socket
  identity is asserted to live in the attachment and to be readable through
  `ctx.getWebSockets()`, the instance is asserted to hold no `Map` or `Set`
  field, and a frame is delivered by calling `webSocketMessage` with a socket
  taken from `getWebSockets()` — the wake-up path, where the instance has no
  memory of the connection — and asserted to broadcast correctly. Presence
  counts distinct pseudonyms, so two tabs are one student. **Rate limiting is
  asserted across two sockets sharing a handle**: with the limit at 3, messages
  one and three come from tab A, two from tab B, and tab B's fourth is
  `rate_limited` with a `retryAfter` — a per-socket limiter would have allowed
  it. History pages backwards on `seq` and arrives oldest-first. The kill switch
  broadcasts and then refuses posts; suspension closes the open socket with 4003
  and refuses a reconnection carrying a still-valid token, proving the object
  and not the token is doing the enforcing; restore lets them back; delete
  broadcasts once and is a no-op the second time. The rework adds the history
  budget, the proof that the history and send budgets are separate, a suspended
  handle refused history, and a suspended reconnect loop that broadcasts nothing.

### What the tests do not cover

- **The `reveal_must_be_bound` CHECK is not exercised against a live Postgres.**
  The unit tests cover the application-level precondition and the
  audit-write-fails-so-no-read path, which is the behaviour the constraint
  produces, but the constraint itself has only been written, not run. It needs
  `npm run db:push && npm run db:migrate` against a real Neon branch. Same for
  the `members_pseudonym_charset` CHECK and the `updated_at` trigger.
- No test touches Neon. Two of the query modules are now genuinely executed —
  `reports.ts` and `members.ts` run through a `drizzle-orm/pg-proxy` stub driver
  in the rework's tests, so the SQL they emit is asserted — but a stub driver is
  not Postgres, and every other database boundary is still mocked at the module
  edge. `claimPseudonym`'s raw `NOT EXISTS` fragment in particular is unverified
  against a real server.
- Hibernation eviction cannot be forced from a test. What is asserted is the
  property that makes eviction survivable — state in the attachment, enumeration
  through `getWebSockets()`, and a handler that works when handed only a socket.
  A real eviction has not been observed.
- No component or browser tests. The room and console UI are typechecked and
  build, and have not been run against a browser.
- better-auth and the V Auth OIDC handshake are untested. No client is
  registered yet, so the flow has never run.

---

## Deviations

Ordered by how much they matter.

1. **`POST /api/report` was added.** The architecture's HTTP table has no report
   endpoint and the wire protocol has no `report` frame, but `PRODUCT.md` puts
   reporting in scope and the prototype draws the button. A report writes to
   Neon, which the Durable Object cannot reach, so it could not have ridden the
   socket. It is an authenticated POST that reads the message text back from the
   object rather than trusting the client, so the snapshot in the queue is what
   was actually said. **This is a real gap in the architecture, not a
   preference.**

2. **`MOD_SCRIPT_MEMBER_HANDLE` was added as a var.** VRIP-08 says the script
   token "resolves to a designated moderator row" without saying how. The route
   looks the row up by handle — readable in an audit row in a way an id is not —
   and still calls `performModeration`, which re-checks the role. Holding the
   token is not the authorisation; being a moderator row is. `.env.example` and
   `worker-secrets.d.ts` carry it.

3. **A failed upgrade completes the 101 and then closes with the contract's
   code.** The architecture implies an HTTP rejection, but a browser
   `WebSocket` surfaces an HTTP error as an opaque 1006, so the client could not
   tell "refetch a token" (4001) from "go and sign in" (4002) — and VRIP-07
   makes those close codes part of the contract. The Worker creates a
   short-lived pair, `accept()`s it plainly (not hibernation) and closes it.
   `env.ROOM.get()` is still never reached, so VRIP-07's actual requirement
   holds.

4. **No `app/components/ui/*` shadcn primitives.** The prototype is a bespoke
   dark terminal design, not a shadcn skin; generating base-nova components and
   restyling them to match would have produced more code and less fidelity. The
   prototype's tokens are in `@theme` and its component classes are ported into
   `@layer components` in `app/app.css` under the same class names, so fidelity
   stays checkable by diffing against `prototype.html`. `components.json` is
   written to match `voss-auth` exactly, so `npx shadcn add` works when a
   primitive is actually wanted. The two things the prototype styles inline —
   the row menu and the reveal dialog — live in their components.

5. **Two modules the architecture does not list.** `app/lib/room.server.ts`
   exists because the console needs the DO binding from app code, and the house
   pattern for a non-string binding is a lazy `cloudflare:workers` import so
   every module stays loadable under plain Node for `tsx` and drizzle-kit.
   `workers/env.ts` holds four env accessors used by the object and the upgrade
   guard. `app/lib/auth-client.ts` was needed for the browser-side OIDC call.

6. **Migration 0001 carries more than the architecture asked for.** Beyond the
   reveal CHECK: vocabulary CHECKs on `moderation_audit.actor_kind` and
   `reports.status`, a `[a-z-]` charset CHECK on `members.pseudonym`, and the
   `updated_at` trigger the architecture mentions but does not write. The charset
   CHECK is the guarantee that survives a future write path nobody has written.

7. **Mobile control sizing departs from the prototype.** `AGENTS.md` requires
   44x44 targets; the prototype's rail items are 34px, its composer is 40px with
   14px text, and its filter inputs are 36px. Rail items, the composer and the
   filter inputs are 44px, and text inputs are 16px so iOS does not zoom on
   focus. In the console, menu items, the dots button, sort headers, checkbox
   hit areas and the dialog buttons are 44px, with negative margins pulling the
   layout box back so rows stay near the prototype's height.

   **Two targets are still short, knowingly.** The `blocks` button in the rail's
   handle panel is 30px — the rail is `display: none` below 720px so it is a
   pointer-only surface, and the same control is 44px inside the member sheet.
   The kill switch is 44x26: widened from the prototype's 40x22 but still under
   44 tall, because a taller track stops reading as a switch. Both are
   exceptions rather than a clean pass against `AGENTS.md`.

   A third was undeclared and the review found it (L2): `.row-btn` was 44x32
   below 720px. It is the `report` and `block` pair on a chat row — the abuse
   controls a student reaches for on a phone — so it is now 44x44 rather than a
   third declared exception.

8. **The audit list shows a date.** The prototype renders `HH:MM`, which is fine
   for rows seeded today and wrong for a trail read months later.

9. **Three small room-behaviour departures from the prototype's script.** The
   online pill keeps the real presence count when the room is closed; the
   prototype forces it to zero, which would be a lie, since readers stay
   connected and the object keeps broadcasting presence. The "You joined as X"
   line is the last of the initial entries rather than the first, because the
   `ready` page is what was said before you arrived and a backfill has to
   prepend cleanly above it. And the client adds no system line on a kill or
   reopen, because the object already broadcasts one and the prototype's
   client-side copy would double it.

   In the console: the room badge reads "Unknown" with the switch disabled when
   the object is unreachable, a state the prototype has no drawing for; column
   toggles hide by not rendering the cell rather than by `display: none`; and
   the empty states distinguish "nothing yet" from "nothing matches that
   filter", where the prototype only has the latter. About a dozen classes the
   prototype styles inline — `.tbl-foot`, `.sortbtn`, `.cbx`, `.dots`, the
   `.menu*` family — are not in `app.css` and were rebuilt as Tailwind
   utilities, exported as shared constants from `RowMenu.tsx` so the two tables
   cannot drift apart.

10. **Test runner setup.** `@cloudflare/vitest-pool-workers` 0.21 (the Vitest 4
   line) removed the `./config` export documented everywhere; the current API is
   a `cloudflareTest()` Vite plugin. Two projects, because the Worker tests need
   workerd and the rest do not. The Worker under test is
   `test/workers/entry.ts`, which mounts the real `handleUpgrade` and the real
   `RoomDurableObject` but not the React Router handler — `workers/app.ts`
   imports `virtual:react-router/server-build`, which only exists inside the
   React Router build.

11. **`Dockerfile` and `.dockerignore` deleted** (as instructed), along with the
    scaffold's `app/welcome/` directory. `tsconfig.json` gained
    `@cloudflare/vitest-pool-workers/types`, and `worker-secrets.d.ts` was added
    and committed because `wrangler types` cannot see secrets and the generated
    `worker-configuration.d.ts` is gitignored — without it a fresh checkout
    fails `tsc`.

12. **`workers/room-do.ts` was not split.** The architecture names
    `room-broadcast.ts` as the seam past 400 lines; it is at 348 after the
    history gate.

    The first pass claimed here that every file in the repo was inside the
    budget. That was not true: `app/app.css` was 915 lines against `AGENTS.md`'s
    200-400 maximum, and the review was right to record it (L3). It is now split
    along the seams it already had — `app/styles/base.css` (tokens, base layer,
    primitives, frame), `app/styles/room.css`, `app/styles/console.css` — with
    `app/app.css` reduced to the Tailwind import and the three partials. The
    claim now holds: the largest file in the repo is `app/styles/room.css` at
    394 lines. The built stylesheet was diffed before and after the split and is
    unchanged except for the `.row-btn` height, the position of `.sr`, and one
    unused `.collapse` utility Tailwind now emits because it scans the partials
    as sources. `@source not` does not suppress it and was not left in the file
    claiming to.

### Left unbuilt

- **The database has never been created.** No `DATABASE_URL` was available, so
  `drizzle-kit push` and `migrate.ts` have not run anywhere. This is the first
  thing to do on review, and it is what would exercise the reveal CHECK.
- **No V Auth client is registered**, because there is still no deployment name
  (architecture open question 3). The relying-party config is written and
  typechecks; the handshake has never run.
- **The four "not built yet" rail items link nowhere.** `RoomRail` renders them
  exactly as the prototype does, with the `issue` badge. Four GitHub issues need
  creating before that rail is honest rather than decorative.
- **No CI.** `voss-auth`'s workflow (`npm ci`, `typecheck`, `build`) plus
  `npm test` is the obvious thing to copy, and it is not here.
- **No prettier or eslint config.** `voss-auth`'s prettier setup is broken —
  the binary is not in its devDependencies and CI does not run it — so there was
  nothing to copy that works.
- **`policy.go`'s pre-send flag layer is still out of scope**, as the
  architecture recommended. `MessageRow` renders the `flagged` row style the
  prototype defines, so the interface is ready for it, but nothing sets the flag.

### Still open, unchanged by this phase

Both product blockers remain: the moderation roster and response-time
commitment, and the launch moment and kill date. Neither is a code problem and
neither is closer to resolution. The moderator-witnesses-something path noted in
the architecture is as clunky as predicted — a moderator has to report a message
themselves before the console can reach it — and it is worth deciding about
before someone discovers it at 2am rather than after.
