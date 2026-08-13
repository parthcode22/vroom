import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, data } from "react-router";

import type { Route } from "./+types/room";
import { Composer } from "~/components/room/Composer";
import { ConnectionState } from "~/components/room/ConnectionState";
import { MemberRail } from "~/components/room/MemberRail";
import { MemberSheet } from "~/components/room/MemberSheet";
import { MessageList } from "~/components/room/MessageList";
import { RoomRail } from "~/components/room/RoomRail";
import { ensurePseudonym } from "~/lib/membership.server";
import { requireSession } from "~/lib/require-role.server";
import {
  loadBlocked,
  RoomConnection,
  saveBlocked,
  type ConnectionState as SocketState,
  type LogEntry,
} from "~/lib/room-client";
import { ROOMS, isRoomId } from "~/lib/rooms";
import { cn } from "~/lib/utils";
import {
  EPHEMERAL_TTL_MS,
  type EphemeralMsg,
  type Msg,
  type SystemTone,
} from "../../workers/protocol";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "V Rooms" }];
  return [
    { title: `${loaderData.room.name} - V Rooms` },
    { name: "description", content: loaderData.room.subtitle },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const actor = await requireSession(request);
  if (!isRoomId(params.roomId)) {
    throw data("No such room.", { status: 404 });
  }
  const member = await ensurePseudonym(actor.member);

  return {
    pseudonym: member.pseudonym ?? "",
    isModerator: actor.member.isModerator,
    room: ROOMS[params.roomId],
  };
}

const EMPTY: ReadonlySet<string> = new Set();

function toEntry(msg: Msg): LogEntry {
  return { kind: "msg", key: `m-${msg.id}`, msg };
}

/** Distinct from a stored message's key, so the two can never collide. */
function tempKey(id: string): string {
  return `t-${id}`;
}

/** Keyed on the room, so switching rooms remounts with an empty log and a fresh socket. */
export default function RoomRoute({ loaderData }: Route.ComponentProps) {
  return <RoomView key={loaderData.room.id} loaderData={loaderData} />;
}

function RoomView({
  loaderData,
}: {
  loaderData: Route.ComponentProps["loaderData"];
}) {
  const room = loaderData.room;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [pseudonym, setPseudonym] = useState(loaderData.pseudonym);
  const [status, setStatus] = useState<SocketState>("connecting");
  const [killed, setKilled] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [online, setOnline] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(EMPTY);
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(EMPTY);
  const [reported, setReported] = useState<ReadonlySet<string>>(EMPTY);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The sheet is only reachable below 1040px, but nothing closed it when the
  // viewport grew past that — a stale sheet then sat on top of the composer on
  // desktop, and the input looked missing.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1041px)");
    const sync = () => {
      if (wide.matches) setSheetOpen(false);
    };
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  const connection = useRef<RoomConnection | null>(null);
  const blockedRef = useRef<ReadonlySet<string>>(EMPTY);
  const systemSeq = useRef(0);
  const expiries = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Presentation only. A client that skipped this timer would gain nothing:
  // the message was never stored, so there is nothing to come back for.
  const expire = useCallback((msg: EphemeralMsg) => {
    const key = tempKey(msg.id);
    const timer = setTimeout(() => {
      expiries.current.delete(key);
      setEntries((prev) => prev.filter((entry) => entry.key !== key));
    }, EPHEMERAL_TTL_MS);
    expiries.current.set(key, timer);
  }, []);

  useEffect(() => {
    const timers = expiries.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const pushSystem = useCallback((tone: SystemTone, text: string) => {
    systemSeq.current += 1;
    const key = `sys-${systemSeq.current}`;
    setEntries((prev) => [...prev, { kind: "system", key, tone, text }]);
  }, []);

  /* ---------------- the socket ---------------- */

  useEffect(() => {
    const socket = new RoomConnection(room.id, {
      onState: setStatus,

      onReady(ready) {
        systemSeq.current += 1;
        setPseudonym(ready.pseudonym);
        setKilled(ready.killed);
        setHasMore(ready.hasMore);
        setLoadingMore(false);
        setDeleted(EMPTY);
        // The log is replaced wholesale, so any pending removals are moot. The
        // messages they pointed at were never stored and do not come back.
        for (const timer of expiries.current.values()) clearTimeout(timer);
        expiries.current.clear();
        // The joined line goes last: the page above it is what was said before
        // you arrived, and a backfill prepends further above that.
        setEntries([
          ...ready.messages.map(toEntry),
          {
            kind: "system",
            key: `sys-${systemSeq.current}`,
            tone: "join",
            text: `You joined as ${ready.pseudonym}. Nobody here can see your name.`,
          },
        ]);
      },

      onMessage(msg) {
        setEntries((prev) => [...prev, toEntry(msg)]);
      },

      onEphemeral(msg) {
        setEntries((prev) => [
          ...prev,
          {
            kind: "temp",
            key: tempKey(msg.id),
            msg,
            expiresAt: Date.now() + EPHEMERAL_TTL_MS,
          },
        ]);
        expire(msg);
      },

      onDeleted(id) {
        setDeleted((prev) => new Set(prev).add(id));
      },

      onPresence(count, list) {
        setOnline(count);
        setMembers(list);
      },

      // The room broadcasts its own system line for this, so do not add one.
      onRoom: setKilled,

      onSystem: pushSystem,

      onHistory(messages, more) {
        setLoadingMore(false);
        setHasMore(more);
        if (messages.length > 0)
          setEntries((prev) => [...messages.map(toEntry), ...prev]);
      },

      onError(code, message, retryAfter) {
        // Backfill is the only request left in flight when an error arrives, and
        // it can now be refused by the object's history budget. Without this the
        // loading row never clears and no further page is ever requested.
        setLoadingMore(false);
        const text =
          code === "rate_limited" && retryAfter
            ? `${message} Try again in ${retryAfter}s.`
            : message;
        pushSystem("warn", text);
      },
    });

    connection.current = socket;
    socket.start();
    return () => {
      socket.stop();
      connection.current = null;
    };
  }, [expire, pushSystem, room.id]);

  /* ---------------- blocking, presentation only ---------------- */

  const applyBlocked = useCallback((next: Set<string>, persist: boolean) => {
    blockedRef.current = next;
    setBlocked(next);
    if (persist) saveBlocked(next);
  }, []);

  useEffect(() => {
    applyBlocked(loadBlocked(), false);
  }, [applyBlocked]);

  const handleBlock = useCallback(
    (who: string) => {
      const next = new Set(blockedRef.current);
      next.add(who);
      applyBlocked(next, true);
    },
    [applyBlocked],
  );

  const handleClearBlocks = useCallback(
    () => applyBlocked(new Set(), true),
    [applyBlocked],
  );

  /* ---------------- reporting, backfill, sending ---------------- */

  const handleReport = useCallback(
    async (msg: Msg) => {
      setReported((prev) => new Set(prev).add(msg.id));
      try {
        const response = await fetch("/api/report", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId: msg.id, roomId: room.id }),
        });
        if (!response.ok) throw new Error(`report ${response.status}`);
        pushSystem(
          "join",
          "Report sent. A moderator reads every one of these.",
        );
      } catch {
        setReported((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
        pushSystem(
          "warn",
          "That report did not send. Try it again in a moment.",
        );
      }
    },
    [pushSystem, room.id],
  );

  // Only the stored arm carries a seq, so an ephemeral message can never become
  // the paging cursor and ask the room for history "before" something it has
  // never heard of.
  const oldestSeq = useMemo(() => {
    for (const entry of entries) if (entry.kind === "msg") return entry.msg.seq;
    return null;
  }, [entries]);

  const handleBackfill = useCallback(() => {
    if (loadingMore || !hasMore || oldestSeq === null) return;
    setLoadingMore(true);
    if (!connection.current?.requestHistory(oldestSeq)) setLoadingMore(false);
  }, [hasMore, loadingMore, oldestSeq]);

  const handleSend = useCallback(
    (body: string, confirmed: boolean) => {
      const sent = connection.current?.send(body, confirmed) ?? false;
      if (!sent)
        pushSystem(
          "warn",
          "Not connected, so that did not send. Try again shortly.",
        );
      return sent;
    },
    [pushSystem],
  );

  /* ---------------- render ---------------- */

  const roster = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a === pseudonym) return -1;
      if (b === pseudonym) return 1;
      return a.localeCompare(b);
    });
  }, [members, pseudonym]);

  const pill = (
    <>
      <span className={cn("mark", killed && "mark-dead")} />
      {online} online
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <i />V ROOMS <small>voss labs</small>
        </div>

        <nav className="tabs" aria-label="View">
          <Link to={`/room/${room.id}`} className="tab" aria-current="page">
            {room.name}
          </Link>
          {loaderData.isModerator ? (
            <Link to="/mod" className="tab">
              Moderation
            </Link>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-[9px]">
          <span
            className={cn(
              "tag [@media(max-width:1040px)]:hidden",
              killed ? "tag-dead" : "tag-live",
            )}
          >
            {pill}
          </span>
          <button
            type="button"
            className={cn(
              "tag hidden min-h-11 [@media(max-width:1040px)]:inline-flex",
              killed ? "tag-dead" : "tag-live",
            )}
            aria-haspopup="dialog"
            aria-label={`${online} online. Open the rooms and the member list.`}
            onClick={() => setSheetOpen(true)}
          >
            {pill}
          </button>
        </div>
      </header>

      <div className="room">
        <RoomRail
          pseudonym={pseudonym}
          blockCount={blocked.size}
          onClearBlocks={handleClearBlocks}
          active={room.id}
        />

        <main className="chat">
          <div className="chat-head">
            <span className="chat-title">#{room.id}</span>
            <span className="chat-sub">{room.subtitle}</span>
            <span className="chat-state" aria-live="polite">
              <ConnectionState state={status} killed={killed} />
            </span>
          </div>

          <MessageList
            entries={entries}
            self={pseudonym}
            blocked={blocked}
            deleted={deleted}
            reported={reported}
            hasMore={hasMore}
            loadingMore={loadingMore}
            joining={status === "connecting" || status === "reconnecting"}
            onBackfill={handleBackfill}
            onReport={handleReport}
            onBlock={handleBlock}
            room={room}
          />

          <Composer
            killed={killed}
            connected={status === "open"}
            onSend={handleSend}
            room={room}
          />
        </main>

        <MemberRail members={roster} self={pseudonym} />
      </div>

      <MemberSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        active={room.id}
        members={roster}
        self={pseudonym}
        blockCount={blocked.size}
        onClearBlocks={handleClearBlocks}
      />
    </div>
  );
}
