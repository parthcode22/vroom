/**
 * Socket fan-out and presence, split out of `room-do.ts` at the seam the
 * architecture names, because VRIP-09's enforcement pushed that file past its
 * 400-line budget.
 *
 * Every function takes the DurableObjectState rather than closing over one:
 * under hibernation the live sockets are `ctx.getWebSockets()` and nothing
 * else. A module-level cache here would work for about ten seconds after an
 * eviction and then silently stop delivering.
 */

import {
  isSocketAttachment,
  type ServerFrame,
  type SocketErrorCode,
} from "./protocol";

/** Derived, never stored. Two tabs are one student. */
export function members(
  ctx: DurableObjectState,
  exclude?: WebSocket,
): string[] {
  const seen = new Set<string>();
  for (const ws of ctx.getWebSockets()) {
    if (ws === exclude) continue;
    const attachment = ws.deserializeAttachment();
    if (isSocketAttachment(attachment)) seen.add(attachment.p);
  }
  return [...seen].sort();
}

export function socketsFor(
  ctx: DurableObjectState,
  pseudonym: string,
  exclude?: WebSocket,
): WebSocket[] {
  return ctx.getWebSockets().filter((ws) => {
    if (ws === exclude) return false;
    const attachment = ws.deserializeAttachment();
    return isSocketAttachment(attachment) && attachment.p === pseudonym;
  });
}

export function sendTo(ws: WebSocket, frame: ServerFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // A socket the edge has already dropped. Presence corrects on the next close.
  }
}

/** Every refusal the sender ever sees goes out through here. */
export function fail(
  ws: WebSocket,
  code: SocketErrorCode,
  message: string,
  retryAfter?: number,
): void {
  sendTo(ws, { t: "error", code, message, retryAfter });
}

export function broadcast(
  ctx: DurableObjectState,
  frame: ServerFrame,
  exclude?: WebSocket,
): void {
  const payload = JSON.stringify(frame);
  for (const ws of ctx.getWebSockets()) {
    if (ws === exclude) continue;
    try {
      ws.send(payload);
    } catch {
      // See sendTo.
    }
  }
}

export function closeQuietly(
  ws: WebSocket,
  code: number,
  reason: string,
): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closing. A second close is not a new fact.
  }
}
