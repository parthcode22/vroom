import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";

import { CLOSE, type ServerFrame } from "../../workers/protocol";
import { ensureSchema } from "../../workers/room-sql";
import { clear, open, token, ROOM } from "./helpers";

/**
 * VRIP-11, against the real Durable Object SQLite.
 *
 * Two properties carry the whole VRIP and both are read off the row rather than
 * off a frame: the message is still there after a withdrawal, and the row says
 * who took it out. A test that only watched the broadcast would pass just as
 * happily against a hard delete, which is the one thing the moderation model
 * cannot allow.
 */

const NUMBER = "9876543210";

function stub() {
  return env.ROOM.get(env.ROOM.idFromName(ROOM));
}

async function connect(handle: string) {
  const { socket } = await open(await token(handle));
  if (!socket) throw new Error("upgrade failed");
  await socket.next("ready");
  clear(socket);
  return socket;
}

/** The stored row, unfiltered by any query that hides deletions. */
async function row(id: string) {
  return runInDurableObject(stub(), async (_i, state) => {
    const rows = state.storage.sql
      .exec<{
        body: string;
        pseudonym: string;
        deleted_at: number | null;
        deleted_by: string | null;
      }>(
        `SELECT body, pseudonym, deleted_at, deleted_by FROM messages WHERE id = ?`,
        id,
      )
      .toArray();
    return rows[0] ?? null;
  });
}

async function say(socket: Awaited<ReturnType<typeof connect>>, body: string) {
  socket.send({ t: "send", body });
  const frame = (await socket.next("message")) as Extract<
    ServerFrame,
    { t: "message" }
  >;
  clear(socket);
  return frame.m;
}

function deletions(socket: Awaited<ReturnType<typeof connect>>) {
  return socket.frames.filter((f) => f.t === "deleted") as Array<
    Extract<ServerFrame, { t: "deleted" }>
  >;
}

describe("an author withdrawing their own message", () => {
  it("soft-deletes the row, records the author, and tells every client", async () => {
    const author = await connect("sunny-otter");
    const watcher = await connect("hazy-newt");

    const msg = await say(author, "meant to send that to one person");
    await watcher.next("message");
    clear(watcher);

    author.send({ t: "withdraw", id: msg.id });

    const heard = (await watcher.next("deleted")) as Extract<
      ServerFrame,
      { t: "deleted" }
    >;
    expect(heard).toMatchObject({ id: msg.id, by: "author" });
    // The author is not excluded from the fan-out: their own row has to change.
    expect((await author.next("deleted")) as ServerFrame).toMatchObject({
      id: msg.id,
      by: "author",
    });

    const stored = await row(msg.id);
    expect(stored?.body).toBe("meant to send that to one person");
    expect(stored?.deleted_at).toBeGreaterThan(0);
    expect(stored?.deleted_by).toBe("author");

    author.ws.close(CLOSE.NORMAL, "done");
    watcher.ws.close(CLOSE.NORMAL, "done");
  });

  it("keeps it out of the page a later student joins to", async () => {
    const author = await connect("brave-lynx");
    const msg = await say(author, "withdrawn before anyone else arrived");
    author.send({ t: "withdraw", id: msg.id });
    await author.next("deleted");

    const { socket: fresh } = await open(await token("keen-shrike"));
    const ready = (await fresh!.next("ready")) as Extract<
      ServerFrame,
      { t: "ready" }
    >;
    expect(ready.messages.some((m) => m.id === msg.id)).toBe(false);

    author.ws.close(CLOSE.NORMAL, "done");
    fresh!.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("authorisation", () => {
  it("refuses another handle and leaves the row untouched", async () => {
    const author = await connect("misty-mole");
    const other = await connect("noble-orca");

    const msg = await say(author, "not yours to remove");
    await other.next("message");
    clear(other);

    other.send({ t: "withdraw", id: msg.id });

    const error = (await other.next("error")) as Extract<
      ServerFrame,
      { t: "error" }
    >;
    expect(error.code).toBe("not_author");

    const stored = await row(msg.id);
    expect(stored?.deleted_at).toBeNull();
    expect(stored?.deleted_by).toBeNull();
    expect(deletions(other)).toEqual([]);
    expect(deletions(author)).toEqual([]);

    author.ws.close(CLOSE.NORMAL, "done");
    other.ws.close(CLOSE.NORMAL, "done");
  });

  it("ignores a handle sent in the frame in favour of the socket's own", async () => {
    const author = await connect("quiet-ibex");
    const attacker = await connect("loud-shrew");

    const target = await say(author, "the message being spoofed for");
    await attacker.next("message");
    clear(attacker);

    // Every shape a client could use to claim it is somebody else.
    attacker.send({
      t: "withdraw",
      id: target.id,
      who: "quiet-ibex",
      pseudonym: "quiet-ibex",
      p: "quiet-ibex",
    });
    expect(
      (await attacker.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({ code: "not_author" });
    expect((await row(target.id))?.deleted_at).toBeNull();

    // And the other direction: the author's own frame naming somebody else is
    // still the author's, because the socket is what the room reads.
    const own = await say(author, "mine, mislabelled");
    author.send({ t: "withdraw", id: own.id, who: "loud-shrew" });
    await author.next("deleted");
    expect((await row(own.id))?.deleted_by).toBe("author");

    author.ws.close(CLOSE.NORMAL, "done");
    attacker.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("idempotence", () => {
  it("succeeds quietly the second time, without a second broadcast", async () => {
    const author = await connect("witty-dace");
    const watcher = await connect("polite-okapi");

    const msg = await say(author, "said once, withdrawn twice");
    await watcher.next("message");
    clear(watcher);

    author.send({ t: "withdraw", id: msg.id });
    await watcher.next("deleted");
    const first = await row(msg.id);

    author.send({ t: "withdraw", id: msg.id });
    await scheduler.wait(60);

    expect(deletions(watcher).length).toBe(1);
    expect(watcher.frames.some((f) => f.t === "error")).toBe(false);
    expect(author.frames.some((f) => f.t === "error")).toBe(false);
    // Nothing about the row moved, including the moment it left the room.
    expect(await row(msg.id)).toEqual(first);

    author.ws.close(CLOSE.NORMAL, "done");
    watcher.ws.close(CLOSE.NORMAL, "done");
  });

  it("says nothing at all about an id that was never stored", async () => {
    const author = await connect("jolly-vole");

    // An ephemeral message (VRIP-10) is exactly this case: it has an id the
    // client can see and no row behind it, so there is nothing to withdraw.
    author.send({ t: "send", body: `call me on ${NUMBER}`, confirmed: true });
    const temp = (await author.next("ephemeral")) as Extract<
      ServerFrame,
      { t: "ephemeral" }
    >;
    clear(author);

    author.send({ t: "withdraw", id: temp.m.id });
    author.send({ t: "withdraw", id: "no-such-message" });
    await scheduler.wait(60);

    expect(author.frames.some((f) => f.t === "error")).toBe(false);
    expect(deletions(author)).toEqual([]);
    expect(await row(temp.m.id)).toBeNull();

    author.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("the two deletions stay distinguishable", () => {
  it("records a moderator's deletion as a moderator's, withdrawn first or not", async () => {
    const author = await connect("spry-linnet");

    const plain = await say(author, "removed by a moderator only");
    expect((await stub().deleteMessage(plain.id)).ok).toBe(true);
    expect((await row(plain.id))?.deleted_by).toBe("moderator");

    const withdrawn = await say(author, "withdrawn, then moderated");
    author.send({ t: "withdraw", id: withdrawn.id });
    await author.next("deleted");
    const afterWithdrawal = await row(withdrawn.id);
    expect(afterWithdrawal?.deleted_by).toBe("author");

    // The moderator acted on it too, and the row has to say so.
    expect((await stub().deleteMessage(withdrawn.id)).ok).toBe(true);
    const afterModerator = await row(withdrawn.id);
    expect(afterModerator?.deleted_by).toBe("moderator");
    // When it left the room is still when the author withdrew it. The moment
    // the moderator acted is in the Neon audit row, not here.
    expect(afterModerator?.deleted_at).toBe(afterWithdrawal?.deleted_at);
    expect(afterModerator?.body).toBe("withdrawn, then moderated");

    author.ws.close(CLOSE.NORMAL, "done");
  });

  it("never lets an author rewrite a moderator's deletion as their own", async () => {
    const author = await connect("clever-marmot");
    const msg = await say(author, "moderated first");

    expect((await stub().deleteMessage(msg.id)).ok).toBe(true);
    await author.next("deleted");
    clear(author);

    author.send({ t: "withdraw", id: msg.id });
    await scheduler.wait(60);

    expect(author.frames.some((f) => f.t === "error")).toBe(false);
    expect(deletions(author)).toEqual([]);
    expect((await row(msg.id))?.deleted_by).toBe("moderator");

    author.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("the evidence chain", () => {
  it("leaves the text readable to a moderator after a withdrawal", async () => {
    const author = await connect("frosty-quail");
    const msg = await say(author, "the thing that got reported");

    // This is the read the report route makes when it snapshots a message, and
    // the read a moderator makes when they go looking afterwards.
    const snapshot = await stub().getMessage(msg.id);
    expect(snapshot?.body).toBe("the thing that got reported");

    author.send({ t: "withdraw", id: msg.id });
    await author.next("deleted");

    const afterwards = await stub().getMessage(msg.id);
    expect(afterwards?.body).toBe("the thing that got reported");
    expect(afterwards?.who).toBe("frosty-quail");
    expect((await row(msg.id))?.body).toBe("the thing that got reported");

    author.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("rate limiting", () => {
  it("spends the same budget as sending", async () => {
    // RATE_LIMIT_MESSAGES_PER_MINUTE is 3 in the test bindings.
    const author = await connect("eager-dunlin");

    const first = await say(author, "one");
    await say(author, "two");

    // The third write in the window is a withdrawal rather than a message.
    author.send({ t: "withdraw", id: first.id });
    await author.next("deleted");
    clear(author);

    author.send({ t: "send", body: "three" });
    const error = (await author.next("error")) as Extract<
      ServerFrame,
      { t: "error" }
    >;
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBeGreaterThan(0);

    author.ws.close(CLOSE.NORMAL, "done");
  });

  it("refuses a withdrawal once the budget is gone", async () => {
    const author = await connect("patient-godwit");
    const msg = await say(author, "one");
    await say(author, "two");
    await say(author, "three");

    author.send({ t: "withdraw", id: msg.id });
    expect(
      (await author.next("error")) as Extract<ServerFrame, { t: "error" }>,
    ).toMatchObject({ code: "rate_limited" });
    expect((await row(msg.id))?.deleted_at).toBeNull();

    author.ws.close(CLOSE.NORMAL, "done");
  });
});

describe("the column arriving at a room that is already live", () => {
  it("adds it and reads every deletion already there as a moderator's", async () => {
    // The shape of the production table before this shipped, rebuilt exactly:
    // a deleted row and a live one, with no deleted_by at all. The room is
    // running with students in it, so this path is not hypothetical.
    const seen = await runInDurableObject(stub(), async (_i, state) => {
      const sql = state.storage.sql;
      sql.exec(`ALTER TABLE messages DROP COLUMN deleted_by`);
      sql.exec(
        `INSERT INTO messages (id, pseudonym, body, created_at, deleted_at)
         VALUES ('legacy-deleted', 'old-handle', 'removed before VRIP-11', 1, 2)`,
      );
      sql.exec(
        `INSERT INTO messages (id, pseudonym, body, created_at)
         VALUES ('legacy-live', 'old-handle', 'still in the room', 3)`,
      );

      // What the constructor runs on the next wake.
      ensureSchema(sql);

      return sql
        .exec<{ id: string; deleted_by: string | null }>(
          `SELECT id, deleted_by FROM messages WHERE id LIKE 'legacy-%' ORDER BY id`,
        )
        .toArray();
    });

    expect(seen).toEqual([
      { id: "legacy-deleted", deleted_by: "moderator" },
      { id: "legacy-live", deleted_by: null },
    ]);

    // Twice is a no-op: the object wakes far more often than it migrates.
    const again = await runInDurableObject(stub(), async (_i, state) => {
      ensureSchema(state.storage.sql);
      state.storage.sql.exec(
        `UPDATE messages SET deleted_by = 'author' WHERE id = 'legacy-deleted'`,
      );
      ensureSchema(state.storage.sql);
      return state.storage.sql
        .exec<{
          deleted_by: string | null;
        }>(`SELECT deleted_by FROM messages WHERE id = 'legacy-deleted'`)
        .one().deleted_by;
    });
    expect(again).toBe("author");

    await runInDurableObject(stub(), async (_i, state) => {
      state.storage.sql.exec(`DELETE FROM messages WHERE id LIKE 'legacy-%'`);
    });
  });
});
