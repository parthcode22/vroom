/**
 * The V Rooms wire contract. Imported by the Durable Object and by the browser
 * client, so the two cannot drift. Keep it free of runtime dependencies.
 */

export const PROTOCOL_ID = "v-rooms.v1";

/** Newest-messages page size on join, and the backfill page size. */
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface Msg {
  id: string;
  seq: number;
  who: string;
  body: string;
  at: number;
}

export type SystemTone = "join" | "warn" | "dead";

export type ClientFrame =
  | { t: "send"; body: string }
  | { t: "history"; before: number; limit?: number };

export type ServerFrame =
  | {
      t: "ready";
      pseudonym: string;
      room: string;
      killed: boolean;
      count: number;
      members: string[];
      messages: Msg[];
      hasMore: boolean;
    }
  | { t: "message"; m: Msg }
  | { t: "deleted"; id: string }
  | { t: "presence"; count: number; members: string[] }
  | { t: "room"; killed: boolean; at: number }
  | { t: "system"; tone: SystemTone; text: string }
  | { t: "history"; messages: Msg[]; hasMore: boolean }
  | { t: "error"; code: SocketErrorCode; message: string; retryAfter?: number };

export type SocketErrorCode =
  | "rate_limited"
  | "room_closed"
  | "too_long"
  | "empty"
  | "suspended"
  | "bad_frame";

/** Close codes are part of the contract (VRIP-07). */
export const CLOSE = {
  NORMAL: 1000,
  TOKEN_EXPIRED: 4001,
  BAD_TOKEN: 4002,
  SUSPENDED: 4003,
} as const;

/** What each socket persists across hibernation. Kept short on purpose. */
export interface SocketAttachment {
  v: 1;
  p: string;
  j: number;
}

export function isSocketAttachment(value: unknown): value is SocketAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as SocketAttachment).v === 1 &&
    typeof (value as SocketAttachment).p === "string"
  );
}

export function parseClientFrame(raw: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;

  if (frame.t === "send" && typeof frame.body === "string") {
    return { t: "send", body: frame.body };
  }
  if (frame.t === "history" && typeof frame.before === "number") {
    const limit = typeof frame.limit === "number" ? frame.limit : undefined;
    return { t: "history", before: frame.before, limit };
  }
  return null;
}

export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return PAGE_SIZE;
  }
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}
