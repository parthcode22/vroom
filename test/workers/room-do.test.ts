import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";

import {
  CLOSE,
  isSocketAttachment,
  type ServerFrame,
} from "../../workers/protocol";
import type { RoomDurableObject } from "../../workers/room-do";
import { clear, open, token, ROOM } from "./helpers";

function stub() {
  return env.ROOM.get(env.ROOM.idFromName(ROOM));
}

async function connect(handle: string) {
  const { socket } = await open(await token(handle));
  if (!socket) throw new Error("upgrade failed");
  await socket.next("ready");
  return socket;
}

describe("join", () => {
  it("sends a ready frame carrying history, presence and room state", async () => {
    const socket = await connect("quiet-ibex");
    const ready = (await socket.next("ready")) as Extract<
      ServerFrame,
      { t: "ready" }
    >;

    expect(ready.pseudonym).toBe("quiet-ibex");
    expect(ready.room).toBe(ROOM);
    expect(ready.killed).toBe(false);
    expect(Array.isArray(ready.messages)).toBe(true);
    expect(ready.members).toContain("quiet-ibex");
    socket.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("hibernation contract", () => {
  it("keeps per-socket identity in the attachment, not in an in-memory map", async () => {
    const a = await connect("swift-heron");
    const b = await connect("polite-okapi");

    await runInDurableObject(
      stub(),
      async (instance: RoomDurableObject, state) => {
        const sockets = state.getWebSockets();
        expect(sockets.length).toBeGreaterThanOrEqual(2);

        const handles = sockets
          .map((ws) => ws.deserializeAttachment())
          .filter(isSocketAttachment)
          .map((att) => att.p);
        expect(handles).toContain("swift-heron");
        expect(handles).toContain("polite-okapi");

        // Nothing on the instance holds connections. A field here works for about
        // ten seconds after hibernation and then silently stops delivering.
        const fields = Object.values(
          instance as unknown as Record<string, unknown>,
        );
        expect(fields.some((v) => v instanceof Map || v instanceof Set)).toBe(
          false,
        );
      },
    );

    a.ws.close(CLOSE.NORMAL, "done");
    b.ws.close(CLOSE.NORMAL, "done");
  });

  it("handles a frame delivered with only a socket and its attachment", async () => {
    // This is exactly the wake-up path: workerd hands the handler a socket off
    // the wire and the instance has no memory of the connection.
    const socket = await connect("brave-lynx");
    clear(socket);

    await runInDurableObject(
      stub(),
      async (instance: RoomDurableObject, state) => {
        const ws = state.getWebSockets().find((candidate) => {
          const att = candidate.deserializeAttachment();
          return isSocketAttachment(att) && att.p === "brave-lynx";
        });
        expect(ws).toBeDefined();
        await instance.webSocketMessage(
          ws!,
          JSON.stringify({ t: "send", body: "after a wake" }),
        );
      },
    );

    const frame = (await socket.next("message")) as Extract<
      ServerFrame,
      { t: "message" }
    >;
    expect(frame.m.who).toBe("brave-lynx");
    expect(frame.m.body).toBe("after a wake");
    socket.ws.close(CLOSE.NORMAL, "done");
  });

  it("counts distinct pseudonyms, so two tabs are one student", async () => {
    const tab1 = await connect("mellow-tapir");
    const tab2 = await connect("mellow-tapir");

    const presence = await runInDurableObject(
      stub(),
      async (instance: RoomDurableObject) => {
        return instance.stats();
      },
    );

    const handles = await runInDurableObject(stub(), async (_i, state) =>
      state
        .getWebSockets()
        .map((ws) => ws.deserializeAttachment())
        .filter(isSocketAttachment)
        .map((a) => a.p),
    );

    expect(handles.filter((h) => h === "mellow-tapir").length).toBe(2);
    expect(presence.online).toBe(new Set(handles).size);

    tab1.ws.close(CLOSE.NORMAL, "done");
    tab2.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("sending", () => {
  it("broadcasts a message to everyone and persists it", async () => {
    const a = await connect("sunny-otter");
    const b = await connect("hazy-newt");
    clear(a);
    clear(b);

    a.send({ t: "send", body: "mess food was edible today" });

    const seenByB = (await b.next("message")) as Extract<
      ServerFrame,
      { t: "message" }
    >;
    expect(seenByB.m.who).toBe("sunny-otter");
    expect(seenByB.m.body).toBe("mess food was edible today");
    expect(seenByB.m.seq).toBeGreaterThan(0);

    const stored = await stub().getMessage(seenByB.m.id);
    expect(stored?.body).toBe("mess food was edible today");

    a.ws.close(CLOSE.NORMAL, "done");
    b.ws.close(CLOSE.NORMAL, "done");
  });

  it("rejects an empty body and one past the character cap", async () => {
    const socket = await connect("clever-marmot");
    clear(socket);

    socket.send({ t: "send", body: "   " });
    expect(
      (await socket.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({
      code: "empty",
    });

    clear(socket);
    socket.send({ t: "send", body: "x".repeat(501) });
    expect(
      (await socket.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({
      code: "too_long",
    });

    socket.ws.close(CLOSE.NORMAL, "done");
  });

  it("rejects an unrecognised frame rather than half-handling it", async () => {
    const socket = await connect("witty-dace");
    clear(socket);
    socket.ws.send(JSON.stringify({ t: "drop_table" }));
    expect(
      (await socket.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({
      code: "bad_frame",
    });
    socket.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("rate limiting", () => {
  it("keys on the pseudonym, so two tabs share one budget", async () => {
    // RATE_LIMIT_MESSAGES_PER_MINUTE is 3 in the test bindings.
    const tab1 = await connect("frosty-quail");
    const tab2 = await connect("frosty-quail");
    clear(tab1);
    clear(tab2);

    tab1.send({ t: "send", body: "one" });
    await tab1.next("message");
    clear(tab1);

    tab2.send({ t: "send", body: "two" });
    await tab2.next("message");
    clear(tab2);

    tab1.send({ t: "send", body: "three" });
    await tab1.next("message");
    clear(tab1);

    // Fourth message from the second tab: a per-socket limiter would allow it.
    tab2.send({ t: "send", body: "four" });
    const error = (await tab2.next("error")) as Extract<
      ServerFrame,
      { t: "error" }
    >;
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBeGreaterThan(0);

    tab1.ws.close(CLOSE.NORMAL, "done");
    tab2.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("history", () => {
  it("pages backwards on the seq cursor", async () => {
    const socket = await connect("jolly-vole");
    clear(socket);

    for (let i = 0; i < 3; i++) {
      socket.send({ t: "send", body: `history probe ${i}` });
      await socket.next("message");
      clear(socket);
    }

    const ready = await runInDurableObject(
      stub(),
      async (instance: RoomDurableObject) => instance.stats(),
    );
    expect(ready.total).toBeGreaterThanOrEqual(3);

    const fresh = await connect("keen-shrike");
    const readyFrame = (await fresh.next("ready")) as Extract<
      ServerFrame,
      { t: "ready" }
    >;
    const oldest = readyFrame.messages[0];
    clear(fresh);

    fresh.send({ t: "history", before: oldest.seq, limit: 2 });
    const page = (await fresh.next("history")) as Extract<
      ServerFrame,
      { t: "history" }
    >;
    expect(page.messages.every((m) => m.seq < oldest.seq)).toBe(true);
    // The page arrives oldest-first so it can be prepended directly.
    expect([...page.messages].sort((x, y) => x.seq - y.seq)).toEqual(
      page.messages,
    );

    socket.ws.close(CLOSE.NORMAL, "done");
    fresh.ws.close(CLOSE.NORMAL, "done");
  });

  it("budgets history frames, so a loop cannot starve the object", async () => {
    // RATE_LIMIT_HISTORY_PER_MINUTE is 3 in the test bindings. A history frame
    // is a scan plus a serialisation of up to 100 rows, and the object is
    // single-threaded: an unbudgeted loop starves delivery, presence and the
    // moderator's setKilled RPC for every other student in the room.
    const socket = await connect("eager-dunlin");
    clear(socket);

    for (let i = 0; i < 3; i++) {
      socket.send({ t: "history", before: 10_000, limit: 100 });
      await socket.next("history");
      clear(socket);
    }

    socket.send({ t: "history", before: 10_000, limit: 100 });
    const error = (await socket.next("error")) as Extract<
      ServerFrame,
      { t: "error" }
    >;
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBeGreaterThan(0);

    socket.ws.close(CLOSE.NORMAL, "done");
  });

  it("keeps the two budgets apart, so backfilling does not cost you your voice", async () => {
    const socket = await connect("patient-godwit");
    clear(socket);

    for (let i = 0; i < 3; i++) {
      socket.send({ t: "history", before: 10_000, limit: 50 });
      await socket.next("history");
      clear(socket);
    }
    socket.send({ t: "history", before: 10_000, limit: 50 });
    expect(
      (await socket.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({
      code: "rate_limited",
    });
    clear(socket);

    // Spent every history request; can still speak.
    socket.send({ t: "send", body: "still here" });
    const message = (await socket.next("message")) as Extract<
      ServerFrame,
      { t: "message" }
    >;
    expect(message.m.body).toBe("still here");

    socket.ws.close(CLOSE.NORMAL, "done");
  });

  it("refuses history to a suspended handle instead of serving it", async () => {
    // The race the gate exists for: a socket accepted before the suspension
    // lands, still holding a frame in flight. Built by hand because the fetch
    // path now refuses a suspended handle before accepting it at all.
    const served = await runInDurableObject(
      stub(),
      async (instance: RoomDurableObject, state) => {
        await instance.suspend("banned-ferret");

        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        state.acceptWebSocket(server);
        server.serializeAttachment({ v: 1, p: "banned-ferret", j: Date.now() });

        const frames: string[] = [];
        client.accept();
        client.addEventListener("message", (event) =>
          frames.push(String(event.data)),
        );

        // Before the fix this returned above the suspension check, the kill-switch
        // check and checkRate alike.
        await instance.webSocketMessage(
          server,
          JSON.stringify({ t: "history", before: 10_000 }),
        );
        await scheduler.wait(50);

        return frames.some((frame) => frame.includes('"t":"history"'));
      },
    );

    expect(served).toBe(false);
    await stub().restore("banned-ferret");
  });
});

describe("a suspended reconnect", () => {
  it("is refused without announcing itself to the room", async () => {
    const watcher = await connect("calm-avocet");
    await stub().suspend("loud-shrew");
    clear(watcher);

    // The token is still valid for its full TTL, so this is the loop a suspended
    // account can run. Each attempt used to accept the socket first, which fired
    // webSocketClose and broadcast a departure line to everyone.
    for (let i = 0; i < 3; i++) {
      const { socket } = await open(await token("loud-shrew"));
      expect((await socket!.closed()).code).toBe(CLOSE.SUSPENDED);
    }

    const noise = watcher.frames.filter(
      (f) => f.t === "system" && f.text.includes("loud-shrew"),
    );
    expect(noise).toEqual([]);

    await stub().restore("loud-shrew");
    watcher.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("moderation enforcement", () => {
  it("closes the room and refuses further posts", async () => {
    const socket = await connect("spry-linnet");
    clear(socket);

    await stub().setKilled(true, "moderator");
    const roomFrame = (await socket.next("room")) as Extract<
      ServerFrame,
      { t: "room" }
    >;
    expect(roomFrame.killed).toBe(true);

    clear(socket);
    socket.send({ t: "send", body: "still talking" });
    expect(
      (await socket.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({
      code: "room_closed",
    });

    await stub().setKilled(false, "moderator");
    socket.ws.close(CLOSE.NORMAL, "done");
  });

  it("suspends a handle, closes its sockets with 4003, and refuses reconnection", async () => {
    const socket = await connect("grumpy-heron");

    await stub().suspend("grumpy-heron");
    expect((await socket.closed()).code).toBe(CLOSE.SUSPENDED);

    // The token is still valid, so this is the object doing the enforcing.
    const { socket: again } = await open(await token("grumpy-heron"));
    expect((await again!.closed()).code).toBe(CLOSE.SUSPENDED);

    await stub().restore("grumpy-heron");
    const restored = await connect("grumpy-heron");
    expect(restored.closes.length).toBe(0);
    restored.ws.close(CLOSE.NORMAL, "done");
  });

  it("soft-deletes a message and tells every client", async () => {
    const author = await connect("misty-mole");
    const watcher = await connect("noble-orca");
    clear(author);
    clear(watcher);

    author.send({ t: "send", body: "delete me" });
    const posted = (await watcher.next("message")) as Extract<
      ServerFrame,
      { t: "message" }
    >;
    clear(watcher);

    const result = await stub().deleteMessage(posted.m.id);
    expect(result.ok).toBe(true);

    const deleted = (await watcher.next("deleted")) as Extract<
      ServerFrame,
      { t: "deleted" }
    >;
    expect(deleted.id).toBe(posted.m.id);

    // Deleting twice is not an error, it is a no-op.
    expect((await stub().deleteMessage(posted.m.id)).ok).toBe(false);

    author.ws.close(CLOSE.NORMAL, "done");
    watcher.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("rooms", () => {
  it("keeps rooms apart: a message in one room never reaches another", async () => {
    const campus = await connect("quiet-ibex");
    const { socket: hostel } = await open(
      await token("polite-okapi", 900, "hostel"),
      "hostel",
    );
    if (!hostel) throw new Error("upgrade failed");
    const ready = (await hostel.next("ready")) as Extract<
      ServerFrame,
      { t: "ready" }
    >;
    expect(ready.room).toBe("hostel");
    expect(ready.members).not.toContain("quiet-ibex");

    clear(campus);
    clear(hostel);
    campus.send({ t: "send", body: "only for campus live" });
    await campus.next("message");
    await scheduler.wait(50);
    expect(hostel.frames.some((frame) => frame.t === "message")).toBe(false);

    campus.ws.close(CLOSE.NORMAL, "done");
    hostel.ws.close(CLOSE.NORMAL, "done");
  });
});
