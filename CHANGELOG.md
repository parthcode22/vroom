# Changelog

All notable changes to V Rooms are recorded here. Format loosely follows
Keep a Changelog. Dates are ISO.

## [Unreleased]

### Added
- Project scaffold and preset ai-native-team workflow init
- VRIP-01: adopt XIP methodology
- VRIP-02: adopt the AI-native team workflow
- VRIP-03: realtime transport and storage split
- VRIP-04: pseudonymous identity with server-side attribution retained
- VRIP-05: moderator console in v1, reversing the moderation-UI exclusion
- Approved interface prototype (`prototype.html`) for the room and the console
- VRIP-06: one Cloudflare Worker running React Router v8, superseding VRIP-03's
  Next.js on Pages deployment line
- VRIP-07: app token scope and the socket trust boundary
- VRIP-08: one moderation control plane behind two front doors
- Architecture (`.preset/ARCHITECTURE.md`)
- V Rooms v1 implementation: one Cloudflare Worker running React Router v8, a
  Durable Object per room on the WebSocket Hibernation API, Neon Postgres for
  accounts, reports and the moderation audit, and both surfaces built to the
  approved prototype
- Contributor scaffolding: MIT LICENSE, CONTRIBUTING.md, issue and pull request
  templates, and a CI workflow running typecheck, format, tests and build
- Prettier with the Tailwind class-sorting plugin, matching voss-auth
- Product definition (`.preset/PRODUCT.md`), pending human gate approval
- Implementation: one Cloudflare Worker running React Router v8, exporting
  `RoomDurableObject` from the same entry
- Durable Object on the WebSocket Hibernation API with SQLite-backed messages,
  a `seq` pagination cursor, per-pseudonym rate limiting, suspensions and the
  kill switch
- Neon + Drizzle data layer: better-auth tables plus `members`, `reports` and
  `moderation_audit`, with a CHECK that a `reveal` audit row must carry a
  `report_id`
- V Auth OIDC relying-party config (better-auth + genericOAuth, PKCE required)
- App token minting and verification (jose HS256, handle and room claims only),
  validated on the WebSocket upgrade before the socket is accepted
- Pseudonym generator ported from voss-ask, with a race-safe claim
- Moderator console and `scripts/mod.ts`, both behind one moderation module
- Incremental message rendering and scroll-up backfill, replacing the
  prototype's full re-render
- Member sheet on narrow viewports, replacing the prototype's hidden rails
- Test suite: unit tests on Node, Durable Object and upgrade tests in workerd

### Removed
- `Dockerfile` and `.dockerignore`, which contradicted VRIP-06's single-Worker
  deployment
