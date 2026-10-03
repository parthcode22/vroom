import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

import { CLOSE, PROTOCOL_ID } from "../../workers/protocol";
import { open, token } from "./helpers";

/**
 * The upgrade is the only trust boundary on the socket. A bad token must be
 * rejected before env.ROOM.get() is reached, and the rejection must carry the
 * documented close code — a plain HTTP error arrives at the browser as an
 * opaque 1006 and the client cannot tell "refetch" from "sign in".
 */

async function upgrade(protocolHeader: string | null, room = "campus-live") {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (protocolHeader !== null)
    headers["Sec-WebSocket-Protocol"] = protocolHeader;
  return SELF.fetch(`https://v-rooms.test/ws?room=${room}`, { headers });
}

describe("socket upgrade", () => {
  it("accepts a valid token and echoes the subprotocol", async () => {
    const response = await upgrade(
      `${PROTOCOL_ID}, ${await token("quiet-ibex")}`,
    );
    expect(response.status).toBe(101);
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(PROTOCOL_ID);
    expect(response.webSocket).not.toBeNull();
    response.webSocket?.accept();
    response.webSocket?.close(CLOSE.NORMAL, "done");
  });

  it("closes with 4002 when the token is missing", async () => {
    const { socket } = await open("");
    expect(socket).not.toBeNull();
    expect((await socket!.closed()).code).toBe(CLOSE.BAD_TOKEN);
  });

  it("closes with 4002 when the subprotocol is absent entirely", async () => {
    const response = await upgrade(null);
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    const code = await new Promise<number>((resolve) => {
      response.webSocket?.addEventListener("close", (e) => resolve(e.code));
    });
    expect(code).toBe(CLOSE.BAD_TOKEN);
  });

  it("closes with 4002 when the protocol id is wrong", async () => {
    const response = await upgrade(`chat.v9, ${await token("quiet-ibex")}`);
    response.webSocket?.accept();
    const code = await new Promise<number>((resolve) => {
      response.webSocket?.addEventListener("close", (e) => resolve(e.code));
    });
    expect(code).toBe(CLOSE.BAD_TOKEN);
  });

  it("closes with 4002 on a forged signature", async () => {
    const valid = await token("quiet-ibex");
    const parts = valid.split(".");
    const forged = `${parts[0]}.${parts[1]}.${"a".repeat(parts[2].length)}`;
    const { socket } = await open(forged);
    expect((await socket!.closed()).code).toBe(CLOSE.BAD_TOKEN);
  });

  it("closes with 4001 on an expired token so the client just reconnects", async () => {
    const { socket } = await open(await token("quiet-ibex", -30));
    expect((await socket!.closed()).code).toBe(CLOSE.TOKEN_EXPIRED);
  });

  it("closes with 4002 when the token was minted for another room", async () => {
    const { socket } = await open(await token("quiet-ibex", 900, "other-room"));
    expect((await socket!.closed()).code).toBe(CLOSE.BAD_TOKEN);
  });

  it("accepts a token for another configured room on that room's socket", async () => {
    const { socket } = await open(
      await token("quiet-ibex", 900, "hostel"),
      "hostel",
    );
    expect(socket).not.toBeNull();
    const ready = await socket!.next("ready");
    expect(ready).toMatchObject({ t: "ready", room: "hostel" });
    socket!.ws.close(CLOSE.NORMAL, "done");
  });

  it("closes with 4002 when a hostel token is presented on the placements socket", async () => {
    const { socket } = await open(
      await token("quiet-ibex", 900, "hostel"),
      "placements",
    );
    expect((await socket!.closed()).code).toBe(CLOSE.BAD_TOKEN);
  });

  it("rejects a room the deployment does not serve", async () => {
    const response = await upgrade(
      `${PROTOCOL_ID}, ${await token("quiet-ibex")}`,
      "somewhere-else",
    );
    response.webSocket?.accept();
    const code = await new Promise<number>((resolve) => {
      response.webSocket?.addEventListener("close", (e) => resolve(e.code));
    });
    expect(code).toBe(CLOSE.BAD_TOKEN);
  });

  it("refuses a plain GET that is not an upgrade", async () => {
    const response = await SELF.fetch(
      "https://v-rooms.test/ws?room=campus-live",
    );
    expect(response.status).toBe(426);
  });
});
