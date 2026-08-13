/**
 * Every statement against the Durable Object's SQLite. No ORM inside the object.
 *
 * `seq` is an AUTOINCREMENT integer primary key, which makes it a stable
 * pagination cursor under concurrent inserts — that is the whole reason it
 * exists alongside the public `id`.
 */

import type { DeletedBy, Msg } from "./protocol";

const SCHEMA_VERSION = 2;

/**
 * A type alias rather than an interface on purpose: `sql.exec<T>` constrains T
 * to Record<string, SqlStorageValue>, and only a type literal gets the implicit
 * index signature that satisfies it.
 */
type MessageRow = {
  seq: number;
  id: string;
  pseudonym: string;
  body: string;
  created_at: number;
  deleted_at: number | null;
  deleted_by: string | null;
};

function toMsg(row: MessageRow): Msg {
  return {
    id: row.id,
    seq: row.seq,
    who: row.pseudonym,
    body: row.body,
    at: row.created_at,
  };
}

export function ensureSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      id         TEXT NOT NULL UNIQUE,
      pseudonym  TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      deleted_by TEXT
    );
  `);
  addDeletedBy(sql);
  sql.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_pseudonym ON messages(pseudonym);`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS room_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS suspensions (pseudonym TEXT PRIMARY KEY, at INTEGER NOT NULL);`,
  );
  sql.exec(`
    CREATE TABLE IF NOT EXISTS rate (
      pseudonym    TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count        INTEGER NOT NULL
    );
  `);
  sql.exec(
    `INSERT INTO room_state (k, v) VALUES ('schema_version', ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    String(SCHEMA_VERSION),
  );
}

/**
 * VRIP-11 on a table that already exists in production. `CREATE TABLE IF NOT
 * EXISTS` above only describes a fresh object, so the live room needs the
 * column added and its history told the truth: every deletion that happened
 * before this shipped was a moderator's, because withdrawal did not exist. The
 * backfill runs once, inside the same branch as the ALTER.
 */
function addDeletedBy(sql: SqlStorage): void {
  const columns = sql
    .exec<{ name: string }>(`PRAGMA table_info(messages)`)
    .toArray();
  if (columns.some((column) => column.name === "deleted_by")) return;

  sql.exec(`ALTER TABLE messages ADD COLUMN deleted_by TEXT`);
  sql.exec(
    `UPDATE messages SET deleted_by = 'moderator' WHERE deleted_at IS NOT NULL`,
  );
}

/* ---------------- room state ---------------- */

export function getState(sql: SqlStorage, key: string): string | null {
  const rows = sql
    .exec<{ v: string }>(`SELECT v FROM room_state WHERE k = ?`, key)
    .toArray();
  return rows.length ? rows[0].v : null;
}

export function setState(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    `INSERT INTO room_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    key,
    value,
  );
}

export interface RoomState {
  killed: boolean;
  killedAt: number | null;
  killedBy: string | null;
}

export function readRoomState(sql: SqlStorage): RoomState {
  const at = getState(sql, "killed_at");
  return {
    killed: getState(sql, "killed") === "1",
    killedAt: at ? Number(at) : null,
    killedBy: getState(sql, "killed_by"),
  };
}

export function writeRoomState(
  sql: SqlStorage,
  killed: boolean,
  actor: string,
  at: number,
): void {
  setState(sql, "killed", killed ? "1" : "0");
  setState(sql, "killed_at", String(at));
  setState(sql, "killed_by", actor);
}

/* ---------------- messages ---------------- */

export function insertMessage(
  sql: SqlStorage,
  msg: { id: string; pseudonym: string; body: string; createdAt: number },
): Msg {
  const row = sql
    .exec<{ seq: number }>(
      `INSERT INTO messages (id, pseudonym, body, created_at) VALUES (?, ?, ?, ?) RETURNING seq`,
      msg.id,
      msg.pseudonym,
      msg.body,
      msg.createdAt,
    )
    .one();
  return {
    id: msg.id,
    seq: row.seq,
    who: msg.pseudonym,
    body: msg.body,
    at: msg.createdAt,
  };
}

/** Newest `limit` messages, returned oldest-first for direct rendering. */
export function recentMessages(
  sql: SqlStorage,
  limit: number,
): { messages: Msg[]; hasMore: boolean } {
  const rows = sql
    .exec<MessageRow>(
      `SELECT seq, id, pseudonym, body, created_at, deleted_at, deleted_by FROM messages
       WHERE deleted_at IS NULL ORDER BY seq DESC LIMIT ?`,
      limit + 1,
    )
    .toArray();
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(toMsg), hasMore };
}

/** One page older than `before`, oldest-first. */
export function messagesBefore(
  sql: SqlStorage,
  before: number,
  limit: number,
): { messages: Msg[]; hasMore: boolean } {
  const rows = sql
    .exec<MessageRow>(
      `SELECT seq, id, pseudonym, body, created_at, deleted_at, deleted_by FROM messages
       WHERE seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?`,
      before,
      limit + 1,
    )
    .toArray();
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(toMsg), hasMore };
}

export function findMessage(sql: SqlStorage, id: string): Msg | null {
  const rows = sql
    .exec<MessageRow>(
      `SELECT seq, id, pseudonym, body, created_at, deleted_at, deleted_by FROM messages WHERE id = ?`,
      id,
    )
    .toArray();
  return rows.length ? toMsg(rows[0]) : null;
}

/**
 * Soft delete, never a hard one: the row survives so a moderator can still read
 * what was said. Returns false when nothing changed — an unknown id, or a
 * deletion this call cannot make more true than it already is.
 *
 * The two actors are not symmetric (VRIP-11). A moderator deleting a message
 * the author already withdrew still records the moderator action, because the
 * row is the only place that fact lives inside the object; an author
 * withdrawing a message a moderator already removed changes nothing, or the
 * record would start describing a moderator's deletion as the author's.
 *
 * `deleted_at` is preserved by the moderator branch on purpose: it is when the
 * message left the room, which the withdrawal decided. When the moderator
 * acted is in the Neon audit row.
 */
export function softDeleteMessage(
  sql: SqlStorage,
  id: string,
  at: number,
  by: DeletedBy,
): boolean {
  if (by === "moderator") {
    sql.exec(
      `UPDATE messages SET deleted_at = COALESCE(deleted_at, ?), deleted_by = 'moderator'
       WHERE id = ? AND COALESCE(deleted_by, '') <> 'moderator'`,
      at,
      id,
    );
  } else {
    sql.exec(
      `UPDATE messages SET deleted_at = ?, deleted_by = 'author'
       WHERE id = ? AND deleted_at IS NULL`,
      at,
      id,
    );
  }
  return sql.exec<{ n: number }>(`SELECT changes() AS n`).one().n === 1;
}

/* ---------------- suspensions ---------------- */

export function isSuspended(sql: SqlStorage, pseudonym: string): boolean {
  return (
    sql
      .exec(`SELECT 1 FROM suspensions WHERE pseudonym = ?`, pseudonym)
      .toArray().length > 0
  );
}

export function addSuspension(
  sql: SqlStorage,
  pseudonym: string,
  at: number,
): void {
  sql.exec(
    `INSERT INTO suspensions (pseudonym, at) VALUES (?, ?)
     ON CONFLICT(pseudonym) DO UPDATE SET at = excluded.at`,
    pseudonym,
    at,
  );
}

export function removeSuspension(sql: SqlStorage, pseudonym: string): void {
  sql.exec(`DELETE FROM suspensions WHERE pseudonym = ?`, pseudonym);
}

export function countSuspensions(sql: SqlStorage): number {
  return sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM suspensions`).one()
    .n;
}

/* ---------------- rate limiting ---------------- */

export interface RateVerdict {
  allowed: boolean;
  retryAfter: number;
}

/**
 * Fixed-window counter keyed on the pseudonym, so two tabs share one budget.
 * The object is single-threaded, so this read-check-write needs no locking.
 */
export function checkRate(
  sql: SqlStorage,
  pseudonym: string,
  limit: number,
  now: number,
  windowMs = 60_000,
): RateVerdict {
  const rows = sql
    .exec<{ window_start: number; count: number }>(
      `SELECT window_start, count FROM rate WHERE pseudonym = ?`,
      pseudonym,
    )
    .toArray();

  const current = rows[0];
  if (!current || now - current.window_start >= windowMs) {
    sql.exec(
      `INSERT INTO rate (pseudonym, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(pseudonym) DO UPDATE SET window_start = excluded.window_start, count = 1`,
      pseudonym,
      now,
    );
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((current.window_start + windowMs - now) / 1000),
    };
  }

  sql.exec(`UPDATE rate SET count = count + 1 WHERE pseudonym = ?`, pseudonym);
  return { allowed: true, retryAfter: 0 };
}

/* ---------------- stats ---------------- */

export interface MessageStats {
  total: number;
  since: number | null;
}

export function messageStats(sql: SqlStorage): MessageStats {
  const row = sql
    .exec<{ total: number; since: number | null }>(
      `SELECT COUNT(*) AS total, MIN(created_at) AS since FROM messages WHERE deleted_at IS NULL`,
    )
    .one();
  return { total: row.total, since: row.since };
}

export function countsByPseudonym(sql: SqlStorage): Record<string, number> {
  const rows = sql
    .exec<{ pseudonym: string; n: number }>(
      `SELECT pseudonym, COUNT(*) AS n FROM messages WHERE deleted_at IS NULL GROUP BY pseudonym`,
    )
    .toArray();
  const out: Record<string, number> = {};
  for (const row of rows) out[row.pseudonym] = row.n;
  return out;
}

/** Peak concurrent count for a UTC day, kept in room_state under `peak:<date>`. */
export function recordPeak(
  sql: SqlStorage,
  day: string,
  online: number,
): number {
  const key = `peak:${day}`;
  const previous = Number(getState(sql, key) ?? "0");
  if (online > previous) {
    setState(sql, key, String(online));
    return online;
  }
  return previous;
}

export function readPeak(sql: SqlStorage, day: string): number {
  return Number(getState(sql, `peak:${day}`) ?? "0");
}

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
