# Architecture: V Rooms

Scope is `.preset/PRODUCT.md` revision 2, built to VRIP-01 through VRIP-08 and to
the approved interface at `prototype.html`. Target is one room, 10-20 concurrent
connections, full retained history, zero budget.

The whole product is one Cloudflare Worker. React Router v8 in framework mode
serves the room and the moderator console, and the `RoomDurableObject` class is
exported from the same Worker entry (VRIP-06). Messages live in that object's
SQLite; members, reports and the audit trail live in Neon (VRIP-03). The socket
knows a pseudonym and a room and nothing else (VRIP-04, VRIP-07).

```
browser ──101 upgrade (JWT in subprotocol)──> Worker.fetch ──verify──> ROOM binding ──> RoomDurableObject
   │                                              │                                       │ SQLite: messages,
   └──HTTP──────────────────────────────────> React Router SSR                            │ room_state,
                                                  │                                       │ suspensions, rate
                                                  ├── env.ROOM.get(id).rpc()  ────────────┘
                                                  └── Neon (HTTP driver): members, reports, moderation_audit
```

---

## Modules

Every file stays inside the 200-400 line budget in `AGENTS.md`. Anything marked
"split when it grows" has an obvious seam named next to it.

### Worker and realtime

| Module | Responsibility | Owner agent |
|---|---|---|
| `workers/app.ts` | Worker entry. Exports `RoomDurableObject`. Routes `/ws` to the upgrade guard, everything else to the React Router request handler. ~40 lines. | backend-engineer |
| `workers/upgrade.ts` | The only trust boundary on the socket. Reads the token from `sec-websocket-protocol`, verifies it with `jose`, checks the room claim, and only then calls `env.ROOM.get()`. A bad token never reaches the object (VRIP-07). | backend-engineer |
| `workers/room-do.ts` | `RoomDurableObject`: hibernation handlers (`webSocketMessage`, `webSocketClose`, `webSocketError`), broadcast, presence, kill switch, suspension enforcement, and the RPC methods the console calls. Split into `room-do.ts` + `room-broadcast.ts` when it passes 400 lines. | backend-engineer |
| `workers/room-sql.ts` | DO SQLite schema (`ensureSchema()` with `CREATE TABLE IF NOT EXISTS` plus a `schema_version` row) and every statement against it. No ORM inside the object. | backend-engineer |
| `workers/protocol.ts` | The wire types, shared by the object and the browser client. One file, imported by both, so the contract cannot drift. | backend-engineer |

### App server

| Module | Responsibility | Owner agent |
|---|---|---|
| `app/lib/auth.server.ts` | better-auth relying-party config: `genericOAuth` with `providerId: "voss"`, `pkce: true`, `requireIssuerValidation: true`, `mapProfileToUser` deriving a name. Built lazily behind a Proxy — module scope on Workers runs before secrets exist. | backend-engineer |
| `app/lib/app-token.server.ts` | Mint and verify the app JWT (`jose`, HS256). The only module that touches `APP_JWT_SECRET`. | backend-engineer |
| `app/lib/pseudonym.ts` | The wordlists and `randomHandle()` / `randomHandleWithSuffix()`, ported from `voss-ask`'s `internal/username`. Pure, no I/O, unit-testable. | backend-engineer |
| `app/lib/membership.server.ts` | Ensure a `members` row for the signed-in user and claim a pseudonym race-safely. The claim loop lives here. | backend-engineer |
| `app/lib/identity.server.ts` | **The one function** that resolves a pseudonym to a real V Auth account (VRIP-04). No other module joins `members` to better-auth's `user`. | backend-engineer |
| `app/lib/moderation.server.ts` | Every moderator action, for both front doors. Re-checks the role, calls the DO, writes Neon, writes the audit row (VRIP-08). Split by action group if it passes 400 lines. | backend-engineer |
| `app/lib/require-role.server.ts` | `requireSession()` and `requireModerator()`. Called at the top of every loader and action that needs them. | backend-engineer |
| `app/lib/room-client.ts` | Browser-side socket: connect, reconnect with backoff, close-code handling, backfill request, and the local block list in `localStorage`. | frontend-engineer |

### Data access

| Module | Responsibility | Owner agent |
|---|---|---|
| `app/db/index.ts` | `drizzle(neon(url), { schema })` behind a lazy Proxy singleton, `transaction: false` on the adapter. Copied shape from VERP and `voss-auth`. | backend-engineer |
| `app/db/schema/{auth,members,reports,audit,relations,index}.ts` | One file per domain plus a barrel and separate relations. House pattern. | backend-engineer |
| `app/db/queries/{members,reports,audit}.ts` | One file per domain. Explicit column lists everywhere — never a bare `select()` on `members` or `user`. | backend-engineer |
| `app/db/migrate.ts` | Numbered `.sql` files applied over a `Pool` on `ws`, tracked in `_migrations`. Schema itself goes through `drizzle-kit push`. Two-track, as in VERP. | devops-engineer |

### Routes and interface

| Module | Responsibility | Owner agent |
|---|---|---|
| `app/routes/home.tsx` | Signed out: what V Rooms is and the plain statement that VOSS can see who you are (VRIP-04 requires the copy). Signed in: redirect to `/room`. | frontend-engineer |
| `app/routes/api.auth.$.ts` | better-auth handler mount. | backend-engineer |
| `app/routes/api.socket-token.ts` | Mints the app token. Session required, pseudonym assigned on first call, refuses a suspended member. | backend-engineer |
| `app/routes/room.tsx` | Campus Live. Loader returns pseudonym, moderator flag and socket origin; the socket does the rest. | frontend-engineer |
| `app/routes/mod.tsx` | The console. Loader is moderator-gated; the action dispatches on `intent` into `moderation.server.ts`. | frontend-engineer |
| `app/routes/api.mod.$action.ts` | Script front door. Bearer `MOD_SCRIPT_TOKEN`, same module, `actor_kind: "script"`. | backend-engineer |
| `app/components/room/*` | `MessageList`, `MessageRow`, `Composer`, `MemberRail`, `RoomRail`, `SystemLine`, `ConnectionState`. | frontend-engineer |
| `app/components/mod/*` | `StatCards`, `RoomSwitch`, `ReportTable`, `AccountTable`, `AuditList`, `RevealDialog`. shadcn data-table pattern per VRIP-05. | frontend-engineer |
| `app/components/ui/*` | shadcn, `base-nova`, neutral, lucide, `rsc: false`, `~/` aliases — matching `voss-auth`'s `components.json`, not VERP's. | frontend-engineer |
| `scripts/mod.ts` | The CLI path VRIP-05 keeps. Prints the audit row it caused. | devops-engineer |

Each module has one reason to change. The two that matter most:
`identity.server.ts` changes only when the mapping rule changes, and
`workers/upgrade.ts` changes only when the trust boundary changes.

---

## Data model

### Neon Postgres

better-auth owns `user`, `session`, `account`, `verification` in the shape its
CLI generates (VERP's `src/db/schema/auth.ts` is the reference). V Rooms adds
three tables.

**`members`** — one row per V Auth account that has entered V Rooms.

| column | type | notes |
|---|---|---|
| `id` | uuid pk default random | the id the rest of the app uses |
| `user_id` | text not null unique → `user.id` | the mapping. See below. |
| `pseudonym` | text unique | NULL until claimed; `[a-z-]` only |
| `is_moderator` | boolean not null default false | granted out of band, not self-service |
| `suspended_at` | timestamptz | NULL means active |
| `suspended_reason` | text | |
| `deleted_at` | timestamptz | tombstone; soft-delete, never hard-delete |
| `created_at` / `updated_at` | timestamptz not null default now() | `updated_at` by trigger |

Indexes: `pseudonym`, `suspended_at`, `is_moderator`.

**There is no email column and no `vauth_subject` column, deliberately.** Both
already exist, once, in better-auth's `user` and `account` rows. Duplicating them
into `members` would create a second copy of the most sensitive data in the
system and a second place to forget about on deletion. The mapping VRIP-04 talks
about is therefore the foreign key `members.user_id`, and resolving it to a
human requires reading `user`, which only `identity.server.ts` does. This
refines VRIP-04's implementation note ("one table holds subject, email,
pseudonym, suspended flag, tombstone") while keeping its decision exactly: the
mapping is reachable through exactly one function, it never enters the token,
the Worker or the Durable Object, and every resolution is audited. It also makes
VRIP-05's sentence "the accounts table has no email column" literally true
rather than true only of the console view. **This needs Boss's yes** — it is a
schema-shaped reading of an accepted VRIP, and it belongs appended to VRIP-04's
implementation notes if accepted.

**`reports`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk default random | |
| `room_id` | text not null default `'campus-live'` | |
| `message_id` | text not null | the DO SQLite message id |
| `reported_member_id` | uuid not null → `members.id` | |
| `reporter_member_id` | uuid not null → `members.id` | |
| `message_snapshot` | text not null | the text as reported |
| `reason` | text | v1: a short label, may be null |
| `status` | text not null default `'open'` | `open` \| `resolved` \| `dismissed` |
| `resolved_by` | uuid → `members.id` | |
| `resolved_at`, `created_at` | timestamptz | |

Unique `(message_id, reporter_member_id)` so one student cannot inflate a queue.
Index `(status, created_at desc)`.

`message_snapshot` copies message text into Neon, which is the one place the
VRIP-03 storage split bends. It is deliberate: the console has to show the
reported text after the message is deleted, the reveal dialog quotes it, and the
queue must render when the Durable Object is asleep or unreachable. It is report
data, not message data — a frozen quote, not a second copy of the log.

**`moderation_audit`** — follows VERP's `audit_logs` shape.

| column | type | notes |
|---|---|---|
| `id` | uuid pk default random | |
| `action` | text not null | `reveal` \| `delete_message` \| `suspend` \| `restore` \| `dismiss_report` \| `room_close` \| `room_open` |
| `actor_member_id` | uuid → `members.id` | |
| `actor_kind` | text not null | `console` \| `script` (VRIP-08) |
| `target_type` | text not null | `member` \| `message` \| `report` \| `room` |
| `target_id` | text | |
| `report_id` | uuid → `reports.id` | the binding |
| `details` | jsonb | |
| `created_at` | timestamptz not null default now() | |

Indexes on `action`, `actor_member_id`, `(target_type, target_id)`,
`created_at`. And the constraint that makes VRIP-04's binding rule structural
rather than cultural:

```sql
ALTER TABLE moderation_audit
  ADD CONSTRAINT reveal_must_be_bound
  CHECK (action <> 'reveal' OR report_id IS NOT NULL);
```

A bare "who is this handle" cannot be recorded, so it cannot be performed
through the sanctioned path.

### Durable Object SQLite (per room)

Created by `ensureSchema()` in the constructor. No ORM.

```sql
CREATE TABLE IF NOT EXISTS messages (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- the pagination cursor
  id         TEXT NOT NULL UNIQUE,               -- public id, referenced by reports
  pseudonym  TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,                   -- epoch ms
  deleted_at INTEGER                             -- soft delete
);
CREATE INDEX IF NOT EXISTS idx_messages_pseudonym ON messages(pseudonym);

CREATE TABLE IF NOT EXISTS room_state  (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suspensions (pseudonym TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate        (pseudonym TEXT PRIMARY KEY,
                                        window_start INTEGER NOT NULL,
                                        count INTEGER NOT NULL);
```

`room_state` holds `killed` (`0`/`1`), `killed_at`, `killed_by`, and
`peak:YYYY-MM-DD` for the console's "peak today". `suspensions` is the
enforcement projection of `members.suspended_at` — the Durable Object is the
only thing that can stop a socket, so it has to hold the flag (VRIP-08).

`rate` is per pseudonym, not per socket, which is what `PRODUCT.md` asks for. It
is SQLite rather than a socket attachment precisely because a user with two tabs
must not get twice the budget. The Durable Object is single-threaded, so the
read-check-write is race-free with no locking. One upsert per message at 20
users is nothing.

### Connection state

There is no connection map. `serializeAttachment` holds `{ v: 1, p: pseudonym,
j: joinedAt }` per socket, and `ctx.getWebSockets()` is the only enumeration.
This is the hibernation contract from `AGENTS.md` and the research doc, and it
is the single most likely source of a confusing bug in this codebase: an
in-memory `Map` works for about ten seconds and then silently stops delivering.

Presence is derived, never stored: the online count is the number of *distinct*
pseudonyms across `ctx.getWebSockets()`, so two tabs are one student.

---

## API contracts

Errors follow the shape from `preset://skills/api-design`:
`{ "error": { "code": "...", "message": "...", "field": "..." } }`. Successful
JSON responses return `{ "data": ... }`. Loaders return plain objects, since
React Router is the type boundary there.

### HTTP

| Method / path | Auth | Request | Response |
|---|---|---|---|
| `GET /` | none | — | Marketing / sign-in, or redirect to `/room` |
| `ALL /api/auth/*` | — | better-auth | better-auth |
| `POST /api/socket-token` | session | — | `{ data: { token, expiresIn, pseudonym, wsUrl } }` · `401 unauthenticated` · `403 suspended` |
| `GET /room` | session | — | loader `{ pseudonym, isModerator, wsUrl }` |
| `GET /mod` | session + moderator | — | loader `{ stats, reports[], accounts[], audit[] }` |
| `POST /mod` | session + moderator | `intent` + fields | action result, see below |
| `POST /api/mod/:action` | `Authorization: Bearer $MOD_SCRIPT_TOKEN` | JSON body | `{ data: ... }` · `401 bad_token` · `403 not_moderator` |

`GET /mod` never returns an email address. `reports[]` carries
`{ id, messageId, snapshot, reason, handle, status, createdAt }` and nothing
that identifies a person. `accounts[]` carries `{ id, handle, messages, status }`.

`POST /mod` intents, all routed into `moderation.server.ts`:

| intent | fields | returns |
|---|---|---|
| `reveal` | `reportId` | `{ data: { email } }` — audit row written first (VRIP-08) |
| `delete_message` | `reportId` | `{ data: { ok: true } }` |
| `suspend` | `memberId`, `reportId?` | `{ data: { ok: true } }` |
| `restore` | `memberId` | `{ data: { ok: true } }` |
| `dismiss_report` | `reportId` | `{ data: { ok: true } }` |
| `set_room_state` | `killed: boolean` | `{ data: { killed, at } }` |

Error codes: `not_moderator`, `report_not_found`, `member_not_found`,
`room_unreachable`, `already_resolved`.

### WebSocket

`wss://<origin>/ws?room=campus-live`, opened as
`new WebSocket(url, ["v-rooms.v1", token])`. The Worker verifies before
upgrading and echoes `Sec-WebSocket-Protocol: v-rooms.v1` (VRIP-07).

Client to server:

```ts
{ t: "send",    body: string }                       // trimmed, 1..500 chars
{ t: "history", before: number, limit?: number }     // before = seq, limit <= 100
```

Server to client:

```ts
{ t: "ready",    pseudonym, room, killed, count, members: string[],
                 messages: Msg[], hasMore: boolean }
{ t: "message",  m: Msg }
{ t: "deleted",  id: string }
{ t: "presence", count: number, members: string[] }
{ t: "room",     killed: boolean, at: number }
{ t: "system",   tone: "join" | "warn" | "dead", text: string }
{ t: "history",  messages: Msg[], hasMore: boolean }
{ t: "error",    code, message, retryAfter?: number }
```

`Msg = { id: string, seq: number, who: string, body: string, at: number }`.

WebSocket error codes: `rate_limited` (with `retryAfter`), `room_closed`,
`too_long`, `empty`, `suspended`.

Close codes: `1000` normal, `4001 token_expired` (client refetches a token and
reconnects), `4002 bad_token` (client sends the user to sign in), `4003
suspended` (terminal — the client must not reconnect).

**History and backfill.** The `ready` frame carries the newest 50 messages and
`hasMore`. Scrolling to the top sends `{ t: "history", before: <oldest seq>,
limit: 50 }`, and the object answers with
`SELECT ... WHERE seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?`.
`seq` is a monotonic `INTEGER PRIMARY KEY AUTOINCREMENT`, so the cursor is
stable under concurrent inserts and needs no offset. Backfill rides the socket
rather than a second HTTP endpoint because the socket is already authenticated,
and because incoming WebSocket messages bill at 20:1 against the free plan while
an HTTP request bills at 1:1.

### Durable Object RPC

Called from app server code as `env.ROOM.get(env.ROOM.idFromName(ROOM_ID))`.
The binding is the authorization boundary — there is no token between the
console and the object (VRIP-06).

```ts
getRoomState(): { killed: boolean; killedAt: number | null; killedBy: string | null }
setKilled(killed: boolean, actor: string): Promise<{ killed: boolean; at: number }>
suspend(pseudonym: string): Promise<void>   // writes, broadcasts, closes that handle's sockets with 4003
restore(pseudonym: string): Promise<void>
deleteMessage(id: string): Promise<{ ok: boolean }>
getMessage(id: string): Promise<Msg | null>
stats(): Promise<{ total: number; since: number | null; peakToday: number; online: number }>
countsByPseudonym(): Promise<Record<string, number>>
```

---

## Deployment shape

One Cloudflare Worker on the free plan, one Neon project, one V Auth client.

**`wrangler.jsonc`** — `main: "./workers/app.ts"`,
`compatibility_flags: ["nodejs_compat"]` (better-auth reaches for `node:crypto`
and `AsyncLocalStorage`), `assets.run_worker_first: ["/*", "!/assets/*"]` (or
the asset layer answers non-GET requests with a 405 and silently breaks every
form post), `observability.enabled: true`, a custom domain route, and:

```jsonc
"durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "RoomDurableObject" }] },
"migrations":      [{ "tag": "v1", "new_sqlite_classes": ["RoomDurableObject"] }]
```

`new_sqlite_classes` is not optional — key-value backed classes do not exist on
the free plan (VRIP-03).

**Secrets** (`wrangler secret put`): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`APP_JWT_SECRET`, `VAUTH_CLIENT_ID`, `VAUTH_CLIENT_SECRET`, `MOD_SCRIPT_TOKEN`.
**Vars**: `BETTER_AUTH_URL`, `VAUTH_DISCOVERY_URL`, `APP_JWT_TTL_SECONDS=900`,
`RATE_LIMIT_MESSAGES_PER_MINUTE=20`, `MESSAGE_MAX_CHARS=500`,
`ROOM_ID=campus-live`.

Everything is built lazily behind a Proxy. Module scope on Workers runs at
isolate boot, before secrets are injected, so a top-level `neon(process.env.DATABASE_URL)`
throws in production while `wrangler dev` hides it — `voss-auth` documents this
at length and the same fix applies here.

**`.env.example` needs three corrections before implementation:**

- `KILL_SWITCH_ENABLED=false` must be deleted. VRIP-05 is explicit that the kill
  switch is Durable Object state and not an environment variable, because an
  environment variable needs a redeploy and is therefore useless as an emergency
  control. Leaving the line there invites someone to wire it up.
- `MODERATOR_ALERT_WEBHOOK` must be deleted. The out-of-band alert was cut from
  v1, and its removal is the reason the console exists.
- `WORKER_URL` and `PUBLIC_WS_URL` become unnecessary under VRIP-06. The socket
  is same-origin; the client derives `wss://` from `location.origin`.

**V Auth**: register the client in `voss-auth`'s `clients.config.ts` with
redirect URI `https://<origin>/api/auth/oauth2/callback/voss` and discovery at
`https://accounts.vosslabs.org/api/auth/.well-known/openid-configuration`. The
issuer is path-prefixed at `/api/auth` — a relying party pointed at the bare
origin fails discovery. `pkce: true` is mandatory (it defaults false client-side
while V Auth requires OAuth 2.1 PKCE) and `mapProfileToUser` must derive a name,
or the login fails with `name_is_missing` *after* the OAuth dance succeeded.

**Migrations**: `drizzle-kit push` carries the schema; numbered `.sql` files in
`app/db/migrations/` carry triggers, the CHECK constraint and any backfill, and
are applied by `app/db/migrate.ts` over a `Pool` on `ws` using
`DIRECT_URL ?? DATABASE_URL`. That script runs on Node, never on the Worker.
Durable Object SQLite has its own path: `ensureSchema()` in the constructor,
`CREATE TABLE IF NOT EXISTS`, with a `schema_version` row for anything a plain
`IF NOT EXISTS` cannot express.

**Free-plan headroom.** 100,000 requests/day. Assets are excluded from the
Worker so they cost nothing. Incoming WebSocket messages bill at 20:1 and
outbound broadcasts are not billed at all, which is the property that makes
fan-out free here: 20 students sending 100 messages each is 2,000 incoming
frames, or 100 requests. SSR document loads and console actions dominate, and
they are nowhere near the ceiling. Exceeding a free limit fails the operation
rather than producing a bill.

**Local development**: `npm run dev` (`react-router dev` through
`@cloudflare/vite-plugin`) runs the Worker, the Durable Object and its SQLite
locally. Neon is the real remote database in development; there is no local
Postgres.

---

## Decisions

Accepted and unchanged: **VRIP-01** (XIPs), **VRIP-02** (the preset workflow),
**VRIP-03** (Worker + one Durable Object per room on the Hibernation API, DO
SQLite for messages, Neon over the HTTP driver for everything cross-room, no
Redis), **VRIP-04** (pseudonymous to students, attributable to VOSS; one
function, never in the token, always audited, always bound to a report),
**VRIP-05** (the console in v1, moderator-gated server-side, reveal only from a
report, kill switch as object state).

Written for this phase, all **Proposed** and awaiting the architecture gate:

- **[VRIP-06](../vrips/vrip-06-one-worker-react-router.md)** — one Cloudflare
  Worker running React Router v8, superseding VRIP-03's "Next.js on Cloudflare
  Pages" line and nothing else. The deciding argument is that VRIP-05 made the
  kill switch object state, and a split deployment would need a second auth
  mechanism whose only job is letting our server talk to our own object.
- **[VRIP-07](../vrips/vrip-07-app-token-and-socket-trust-boundary.md)** — the
  token carries pseudonym, room and nothing else; it travels in the WebSocket
  subprotocol rather than the query string; it authorizes opening a socket, not
  holding one, and revocation is an explicit close from the object.
- **[VRIP-08](../vrips/vrip-08-moderation-control-plane.md)** — one moderation
  module behind two front doors; enforcement in the object first, record and
  audit in Neon second; the single exception is a reveal, where the audit row is
  the precondition.

One schema-shaped reading is recorded above and needs Boss's yes rather than a
VRIP: `members` carries no email and no V Auth subject, because both already
exist exactly once in better-auth's tables, and the mapping is the foreign key.
VRIP-04's decision is unchanged; its implementation note wants a sentence
appended if this is accepted.

---

## Open questions

Things I could not resolve, stated plainly.

1. **VRIP-06 is a reversal and I cannot accept it on Boss's behalf.** The
   working tree has already deleted the `create-next-app` scaffold and installed
   a React Router v8 one, so the code and the written decision currently
   disagree either way. This is the one item that blocks implementation.
2. **Both product blockers are still open** and one of them is load-bearing
   here. The launch moment sets the concurrency target, and this design is built
   for 10-20. Nothing in it breaks at 100; the parts that would need attention
   past roughly 200 are the per-frame broadcast loop and the client's message
   rendering, not the storage or auth design. The moderation roster is not an
   architecture problem and no amount of console makes up for its absence.
3. **No name for the deployment.** `rooms.vosslabs.org` is the obvious one and
   determines the V Auth redirect URI, which has to be registered before the
   first real login.
4. **`MOD_SCRIPT_TOKEN` is a genuinely weak credential** — long-lived, no
   expiry, full moderator power, and its audit rows name a designated row rather
   than a person. It exists because VRIP-05 keeps the script path. If the roster
   turns out to be one or two people who always have a browser, deleting the
   script and this secret is a real simplification.
5. **`voss-ask`'s `policy.go` pre-send flag layer is not in scope** and I have
   not assumed it. It is a good fit: cheap regexes for phone numbers, emails,
   social handles and honorific-plus-name, firing a confirm dialog before the
   message is sent. The prototype already renders a `flagged` row style and
   seeds a message with a phone number in it, which suggests it was in mind.
   Recommended as the first post-v1 issue, or as v1 scope if Boss says so — it
   is one pure module and one dialog, and it is the only thing in the design
   that acts *before* harm rather than after.
6. **Nothing tracks a message's reporter count** beyond one row per reporter.
   Ten reports on one message look like ten rows in the queue. At this size that
   is arguably correct, but the console will feel wrong the first time it
   happens.
7. **`user.name` is derived from the institutional email** by both V Auth and
   the relying-party mapper, so it is effectively the student's real name and
   sits in the same row as the address. `identity.server.ts` is the only reader
   either way, but it means "resolve the mapping" returns a name as well as an
   email whether or not that was intended.

## What the prototype implies that this does not cheaply deliver

The interface is approved and this architecture can build it. These are the
places where building it exactly will cost more than the prototype suggests, or
where the prototype is silent on something the product requires.

- **Full retained history versus `renderLog()`.** The prototype clears the log
  and rebuilds every row on every state change, and its own console reports
  8,412 messages kept. That is fine for eighteen seeded messages and unusable
  for a real log. The React implementation has to render incrementally and
  window the list; this is a build cost, not an architectural obstacle.
- **No backfill affordance exists in the prototype.** "Scrollable history" is
  drawn as a plain overflow container that auto-scrolls to the bottom. Real
  backfill needs a loading row at the top, scroll-anchoring so prepending does
  not jump the viewport, and an end-of-history state. The wire protocol above
  supports it; the interface does not yet specify it.
- **On a phone there is no way to see who is online.** Below 720px the members
  rail and the rooms rail are both `display: none`, leaving only the topbar
  count. `AGENTS.md` says hiding content on mobile means it was not important —
  either the member list gets a sheet or drawer on mobile, or the design should
  concede that the count is enough.
- **The console's "Messages" column, "Messages kept" and "peak today" are
  Durable Object reads**, not Neon reads, so the console has a live dependency
  on the room object. Design position: those three numbers degrade to `—` when
  the object is unreachable, and the report queue still renders. The prototype
  shows them as always-present figures.
- **A moderator has no way to act on a message they can see.** Row actions in
  the room are `report` and `block` for everyone, and the console can only reach
  a message through a report. So a moderator who witnesses something has to
  report it themselves and then act on their own report. That works and it keeps
  every action bound to a report, which VRIP-04 wants — but it is a clunky path
  through the product's fastest-moving surface and it is worth naming before
  someone discovers it at 2am.
- **Blocking is presentation only.** A blocked pseudonym's messages still arrive
  over the socket and are hidden client-side, which is what "client-side block"
  in `PRODUCT.md` means. It is not a privacy control and the copy should not
  imply that it is.
- **The prototype has no signed-out state, no loading state, no error state and
  no reconnect state.** `AGENTS.md` requires all of them and specifically says
  the empty state of Campus Live matters more here than in most products. The
  `chat-state` slot in the header is the natural home for `connecting` /
  `reconnecting` next to the existing `closed` tag.
- **The audit list renders `HH:MM` with no date.** Fine for a prototype seeded
  today; a real trail needs a date, and the reveal rows need to survive being
  read months later.
- **The "Not built yet" rail items point at issues that do not exist.** Four
  GitHub issues need creating before those links are real, and that rail is a
  deliberate part of the contribution funnel rather than decoration.
- **The online count can briefly overstate.** `ctx.getWebSockets()` includes
  sockets whose client vanished without a close frame until the edge notices.
  There is no heartbeat in this design and I do not think one is worth adding at
  this size, but the number is not exact.
- **The role toggle in the topbar is prototype-only.** In the build the
  Moderation tab does not render for a student and every action re-checks the
  role server-side. The check is the control; not rendering the tab is
  presentation (VRIP-05).
