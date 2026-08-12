## What and why

<!-- What does this change, and what problem does it solve? -->

## Does it touch anything in AGENTS.md "Hard constraints"?

<!-- The identity mapping, the app token, the Durable Object hibernation
     contract, the kill switch, role checks, or the reveal binding. If yes,
     explain what you changed about the security behaviour and why it is safe.
     If no, delete this section. -->

## Checked

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] I read `AGENTS.md` and did not widen `run_worker_first`, move the email
      into the token, or add a moderator path that skips the server-side role
      check — or this PR does not touch them
- [ ] If this changes the auth chain, the data model, the realtime transport,
      the identity mapping or moderation policy, I wrote a VRIP in `/vrips/`
