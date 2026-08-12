# VRIP-03: Cloudflare Durable Objects for realtime, with a split storage model

**Status:** Accepted (deployment line superseded by VRIP-06)
**Date:** 2026-08-12
**Author:** Harshal More

## Context

Campus Live needs simultaneous presence: roughly 70-100 concurrent connections for
the first experiment, in one room, with history on join and a live online count.
Budget is zero. Contributors are students, so the stack has to be approachable.

The candidates considered all fail differently. A managed realtime service bills
fan-out, so one message to a 100-person room costs about 100 messages against the
quota. Vercel Functions can now hold a WebSocket, but connections pin to one
instance with no cross-instance broadcast and a short duration cap, so a shared room
needs an external pub/sub layer anyway. Redis solves multi-instance fan-out, which is
a problem that only exists if there is more than one instance.

## Decision

Run realtime on a Cloudflare Worker with one Durable Object per room using the
WebSocket Hibernation API. Split storage: message history in the Durable Object's own
SQLite, and users, reports, and the moderation audit trail in Neon Postgres accessed
through the serverless HTTP driver. No Redis.

## Consequences

- Win: the Durable Object is the coordination point, so fan-out needs no pub/sub
  layer and no Redis.
- Win: outbound broadcasts are not billed as requests, and incoming WebSocket
  messages count at a reduced rate, so the free plan is not a real ceiling at this
  size. Exceeding a free limit fails the operation rather than producing a bill.
- Win: history reads are colocated with the socket, so no network hop on join.
- Cost: Durable Objects are the least familiar piece here for a student
  contributor. This will reduce PR volume relative to a plain Node or FastAPI
  server, and that is a real cost against the project's contribution goal.
- Cost: two storage systems means two mental models and two migration paths.
- Risk: hibernation evicts in-memory state. Connection state must be persisted with
  `serializeAttachment()` / `deserializeAttachment()` and restored via
  `ctx.getWebSockets()`, or sockets appear to die after a few seconds. This is the
  most likely source of a confusing early bug.
- Constraint: only SQLite-backed Durable Object classes work on the Workers free
  plan, so classes must be created with a `new_sqlite_classes` migration.
- Constraint: Workers cannot hold TCP Postgres connections, so Neon must be accessed
  over its HTTP driver.
- Precludes: message queries that span rooms, since Durable Object storage is scoped
  to a single object. This is why moderation data lives in Neon rather than in the
  object.

## Alternatives considered

- Ably or Pusher: rejected because fan-out counts against the quota, and Pusher's
  free concurrency ceiling sits exactly at the expected peak, so a good day becomes
  an outage.
- Vercel Functions WebSockets: rejected because connections pin per instance with no
  built-in cross-instance broadcast, forcing an external state layer.
- Self-hosted FastAPI or Node WebSocket server on a small box: rejected, narrowly.
  It handles this load easily and is the most approachable option for contributors.
  Reconsider if PR volume matters more than infrastructure quality.
- Postgres LISTEN/NOTIFY as pub/sub: rejected because it needs an unpooled direct
  connection, which fights both Neon's pooling and its autosuspend behaviour.
- Everything in Neon including messages: viable and simpler to reason about, at the
  cost of a network hop per join. Reconsider if the two-store split causes friction.

## Implementation notes

Auth is validated on the upgrade request, before the socket is accepted, since the
upgrade is an ordinary HTTP request and is the only clean place to reject.
Filled in further during implementation.
