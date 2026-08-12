# V Rooms — phase summary

Newest entry at top. Written for a human or a cold agent picking up the project.

## product-definition — 2026-08-12
- Goal: feature — define and scope V Rooms v1, a pseudonymous real-time campus
  conversation for verified VIT students, as the social entry point into VOSS.
- Done this phase:
  - `.preset/PRODUCT.md` written and accepted by the referee (shape valid).
  - v1 scoped to a single Campus Live room: V Auth login, stable pseudonym, realtime
    send/receive, online count, history on join, report, block, rate limit, and
    moderator script actions including a kill switch.
  - Rooms, discovery, DMs, identity reveal, reactions, threads, uploads, and any
    moderation UI deferred. The deferred list is intended to become GitHub issues
    that student contributors build.
  - Success metrics fixed on activation, daily participation, reply density, peak
    concurrency, retention, and contribution conversion. Registrations explicitly
    rejected as a metric.
  - Three bootstrap decisions recorded: VRIP-01 (XIP methodology), VRIP-02
    (ai-native-team workflow, new-product intent, all human gates kept), VRIP-03
    (Cloudflare Durable Objects for realtime with DO SQLite plus Neon split).
  - Research saved to the shared library under `cloudflare-durable-objects-websockets`.
- Implemented so far: no product code. Scaffold and process docs only.
- Open blockers, both owned by Boss and both tracked as todos:
  - The launch moment and kill date are undecided. A live room needs simultaneous
    presence, so this determines the concurrency target the architecture must hit.
  - The moderation roster and response-time commitment do not exist yet, and neither
    does a plan for bringing the VIT administration in before launch.
- Next: product-definition gate awaits human approval (`approve_gate`). After that,
  architecture phase, lead `architect-system`, producing `.preset/ARCHITECTURE.md`
  with Modules, Data model, API contracts, Deployment shape, Decisions.
