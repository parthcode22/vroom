import { SELF } from "cloudflare:test";

import { mintAppToken } from "~/lib/app-token.server";
import { PROTOCOL_ID, type ServerFrame } from "../../workers/protocol";

export const ROOM = "campus-live";

export async function token(
  pseudonym: string,
  ttl = 900,
  room = ROOM,
): Promise<string> {
  return mintAppToken({ pseudonym, room }, ttl);
}

export interface Socket {
  ws: WebSocket;
  frames: ServerFrame[];
  closes: Array<{ code: number; reason: string }>;
  /** Resolves with the first frame of type `t` seen from now, or after it arrives. */
  next(t: ServerFrame["t"], timeoutMs?: number): Promise<ServerFrame>;
  closed(timeoutMs?: number): Promise<{ code: number; reason: string }>;
  send(frame: unknown): void;
}

export async function open(
  tokenValue: string,
  room = ROOM,
): Promise<{ status: number; socket: Socket | null }> {
  const response = await SELF.fetch(`https://v-rooms.test/ws?room=${room}`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `${PROTOCOL_ID}, ${tokenValue}`,
    },
  });

  if (response.status !== 101 || !response.webSocket) {
    return { status: response.status, socket: null };
  }

  const ws = response.webSocket;
  const frames: ServerFrame[] = [];
  const closes: Array<{ code: number; reason: string }> = [];

  ws.accept();
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string")
      frames.push(JSON.parse(event.data) as ServerFrame);
  });
  ws.addEventListener("close", (event) => {
    closes.push({ code: event.code, reason: event.reason });
  });

  const socket: Socket = {
    ws,
    frames,
    closes,
    send(frame) {
      ws.send(JSON.stringify(frame));
    },
    async next(t, timeoutMs = 2000) {
      return waitFor(
        () => frames.find((f) => f.t === t),
        timeoutMs,
        `frame ${t}`,
      );
    },
    async closed(timeoutMs = 2000) {
      return waitFor(() => closes[0], timeoutMs, "close");
    },
  };

  return { status: response.status, socket };
}

async function waitFor<T>(
  probe: () => T | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await scheduler.wait(5);
  }
}

/** Drains anything already queued so the next assertion sees only new frames. */
export function clear(socket: Socket): void {
  socket.frames.length = 0;
}
