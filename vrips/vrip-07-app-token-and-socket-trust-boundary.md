# VRIP-07: The app token and what the socket is allowed to know

**Status:** Accepted
**Date:** 2026-08-12
**Author:** Harshal More

## Context

VRIP-04 settled what the socket layer must never learn: not the institutional
email, not the V Auth subject. `PRODUCT.md` and `AGENTS.md` fix the mechanism —
a short-lived app JWT, minted by the app after V Auth OIDC, validated on the
WebSocket upgrade request before the socket is accepted. `.env.example` fixes
the lifetime at `APP_JWT_TTL_SECONDS=900`.

What none of them settle is the part that decides whether the design actually
works: how the token reaches the Worker, what happens to a live socket when the
token expires fifteen minutes into a conversation, and what closes a socket that
should no longer exist. Those three questions produce wrong answers by default.
The default way to pass a token to a browser WebSocket is a query parameter,
which puts a bearer credential into every request log. The default reading of a
15-minute TTL is that sockets die every 15 minutes. And the default assumption
about suspension is that the next token mint will catch it, which is fifteen
minutes too late for the one control whose whole purpose is response time.

## Decision

The app mints an HS256 JWT over `APP_JWT_SECRET` carrying exactly `sub` (the
pseudonym), `room`, `iss`, `aud`, `iat`, `exp` and `jti` — nothing else, and in
particular no moderator claim, because moderation never travels over the socket.
The browser passes it as the second WebSocket subprotocol, not as a query
parameter. The token authorizes opening a socket and nothing more: it is not
re-checked for the life of the connection, and an open socket is instead
terminated by the Durable Object itself when the room or the account changes
state.

## Consequences

- Win: a credential never appears in a URL, so it is never written to Cloudflare
  request logs, a browser history entry, or a `Referer` header.
- Win: the TTL means what it should mean — it bounds how long a leaked token can
  be used to *open* a socket, which is the real threat. A conversation is not
  interrupted every fifteen minutes for no security gain.
- Win: the Durable Object is the enforcement point for suspension and the kill
  switch, so both take effect on the next frame with no Neon read in the hot
  path and no dependence on token expiry.
- Win: a compromised Worker or Durable Object yields a list of handles. That is
  VRIP-04's structural blindness made concrete.
- Cost: HS256 with a shared secret means the app and the Worker must hold the
  same secret. Here they are the same Worker (VRIP-06), so this is free today —
  but it is the thing that would have to become asymmetric if they ever split.
- Cost: the subprotocol carries the token, so the Worker must echo a protocol
  value back on the 101 response or the browser closes the connection
  immediately. This is an easy thing to omit and produces a failure that looks
  like a network problem.
- Risk: a socket outlives its token, so revocation is not "wait for expiry" — it
  is an explicit close from the Durable Object. Any future reason to revoke
  access has to be wired into that path deliberately, or it silently will not
  work.
- Risk: `jti` is minted but not tracked. There is no replay store, so the same
  token can open several sockets until it expires. At 10-20 concurrent this is
  a non-issue and the rate limit is per account rather than per socket, so it
  buys an attacker nothing. It would matter at a scale this product does not
  have.
- Precludes: any Worker-side feature that needs to know who the user really is.
  That is the point, and it is why the moderator console is an app route rather
  than a socket capability.

## Alternatives considered

- Token in the query string (`wss://.../ws?t=...`): rejected. It is the common
  pattern and it writes a bearer credential into every log line on the path.
- A cookie on the upgrade request: rejected. It works only because the socket is
  same-origin today (VRIP-06), so it silently couples the transport to the
  deployment shape, and it reintroduces CSRF surface on the upgrade.
- Re-validating the token on every frame, with the client refreshing before
  expiry: rejected as churn that buys nothing. It does not make suspension
  faster — the Durable Object close does — and it adds a refresh path that fails
  in exactly the conditions where the room matters most.
- Putting the moderator flag in the token so moderation could act over the
  socket: rejected. It would make the socket a privilege boundary, and VRIP-05
  requires every moderator action to re-check the role server-side against Neon.
- Asymmetric signing (EdDSA, JWKS from the app): rejected as premature while the
  signer and verifier are the same Worker. Revisit if they ever separate.

## Implementation notes

- Mint at `POST /api/socket-token`, which requires a better-auth session,
  assigns the pseudonym on first call, and refuses with `403 suspended` for a
  suspended member so a suspended user cannot even obtain a token.
- Browser: `new WebSocket(url, ["v-rooms.v1", token])`. Worker: read
  `sec-websocket-protocol`, take the second value, verify with `jose`, and set
  `Sec-WebSocket-Protocol: v-rooms.v1` on the 101 response.
- Verification happens in the Worker's fetch handler, before `env.ROOM.get()` is
  called at all. A bad token never reaches the Durable Object.
- Close codes are part of the contract: `4001 token_expired` (client refetches a
  token and reconnects), `4002 bad_token` (client sends the user to sign in),
  `4003 suspended` (terminal, the client must not reconnect).
