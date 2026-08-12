# VRIP-06: One Cloudflare Worker running React Router, not a separate Next.js app

**Status:** Accepted
**Date:** 2026-08-12
**Author:** Harshal More

## Context

VRIP-03 fixed the realtime transport (Worker + one Durable Object per room) and
`AGENTS.md` records the frontend as "Next.js + Tailwind, mobile-first, on
Cloudflare Pages". That line was written before the moderator console existed.
VRIP-05 then put the console in v1 and made three of its controls — kill switch,
suspension, message deletion — Durable Object state that has to change within a
second of a moderator clicking.

That is the part the Next.js decision did not anticipate. With the app and the
Worker as two deployments, every console action has to cross a network boundary
into the Worker, which means inventing a second authentication mechanism (a
shared admin secret or a service token) whose only purpose is to let our own
server talk to our own Durable Object. `.env.example` already carries the
symptoms: `WORKER_URL` and `PUBLIC_WS_URL` exist because the socket lives at a
different origin than the page that authenticates the user.

Two further facts make the split worse than it looks. Cloudflare Pages is no
longer the recommended target for a server-rendered Next.js app; the supported
path is the OpenNext adapter onto Workers, which is a heavier and less proven
piece of infrastructure than anything else in this stack. And the repo's working
tree has already deleted the `create-next-app` scaffold and replaced it with a
React Router v8 framework-mode scaffold, so the written decision and the code no
longer agree.

The house already has a working answer. `voss-auth` runs React Router v8 in
framework mode on a single Worker with `@cloudflare/vite-plugin`, better-auth,
Neon over the serverless HTTP driver, drizzle, and shadcn on `base-nova`. It is
the same shape V Rooms needs, minus the Durable Object.

## Decision

V Rooms ships as one Cloudflare Worker. React Router v8 in framework mode serves
both surfaces — the room and the moderator console — and the `RoomDurableObject`
class is exported from the same Worker entry and reached through a Durable Object
binding. This supersedes the "Next.js on Cloudflare Pages" line in VRIP-03 and
`AGENTS.md`; every other part of VRIP-03 stands unchanged.

## Consequences

- Win: the console reaches the Durable Object through `env.ROOM.get(id)` as a
  direct RPC call. The binding is the authorization boundary, so there is no
  admin secret, no service token, and no second auth mechanism to get wrong.
- Win: the page and the socket share an origin. No CORS, no cross-origin cookie
  handling, and `WORKER_URL` / `PUBLIC_WS_URL` stop existing.
- Win: one deploy, one secret store, one observability surface, one wrangler
  config. A student contributor runs `npm run dev` and has the whole product.
- Win: `voss-auth` is a working reference for every non-obvious part of this
  stack — the lazy `getDb()` / `getAuth()` proxies that exist because module
  scope on Workers runs before secrets are injected, `run_worker_first` on the
  assets binding, `nodejs_compat` for better-auth.
- Cost: React Router framework mode is less familiar to a student contributor
  than Next.js, and VERP being Next.js means the two products no longer share a
  frontend idiom. This is the same cost VRIP-03 already accepted for Durable
  Objects, paid a second time.
- Cost: no React Server Components. `components.json` is `rsc: false`, matching
  `voss-auth` rather than VERP, so shadcn components copied between the two
  repos are not always drop-in.
- Cost: the whole product is on one provider. A Cloudflare account problem takes
  down the room, the console and the login page together.
- Risk: better-auth on Workers has sharp edges that `voss-auth` documents at
  length — construction must be lazy, `transaction: false` is required on the
  neon-http drizzle adapter, and scrypt does not fit the free-tier CPU budget.
  Ignoring any of them produces a failure that `wrangler dev` hides.
- Precludes: deploying the app to Vercel later without unpicking the direct DO
  binding and reintroducing an HTTP control path to the Worker.

## Alternatives considered

- Next.js on Vercel with the Worker as a second deployment: rejected because it
  makes the kill switch reachable only over an authenticated HTTP call between
  two of our own services, which is a trust boundary that exists solely to
  accommodate the framework choice. Two hosting providers for a zero-budget
  student project is also a poor trade.
- Next.js on Workers via `@opennextjs/cloudflare`: rejected as the heaviest
  option. It keeps the single-Worker win but pays for it with an adapter nobody
  in VOSS has run in production, on the product with the least room for a
  confusing infrastructure bug.
- Next.js on Cloudflare Pages, as originally written: rejected because it is no
  longer the recommended path for a server-rendered Next.js app, and because a
  Pages Function cannot hold the Durable Object class.
- Keep the Next.js scaffold and revert the working tree: rejected, but it is the
  honest fallback if this VRIP is not accepted. It costs an admin token, a
  cross-origin socket, and a second deployment.

## Implementation notes

Mirror `voss-auth`: `workers/app.ts` as the wrangler `main`, `@cloudflare/vite-plugin`,
`compatibility_flags: ["nodejs_compat"]`, and `assets.run_worker_first: ["/*", "!/assets/*"]`
so non-GET requests are not answered by the asset layer with a 405.

The Worker entry checks for the socket path before handing off to React Router —
`createRequestHandler` has no useful way to return a 101 response.

The Durable Object class must be created with a `new_sqlite_classes` migration
(VRIP-03), and it is exported from the same module as the default fetch handler.
