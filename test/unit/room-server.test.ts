import { describe, it, expect } from "vitest";

import { mergeRoomReads, type RoomRead } from "~/lib/room.server";

/**
 * The console reads every room and shows one set of numbers. The merge must
 * not invent a number a room did not report, and must not count a student
 * twice (VRIP-12).
 */

function read(
  stats: Partial<RoomRead["stats"]> = {},
  state: Partial<RoomRead["state"]> = {},
  counts: Record<string, number> = {},
): RoomRead {
  return {
    stats: {
      total: 0,
      since: null,
      peakToday: 0,
      online: 0,
      members: [],
      ...stats,
    },
    state: { killed: false, killedAt: null, killedBy: null, ...state },
    counts,
  };
}

describe("mergeRoomReads", () => {
  it("is null when any room could not be read, rather than a partial sum", () => {
    expect(mergeRoomReads([read(), null, read()])).toBeNull();
  });

  it("counts a student in two rooms once, and sums what is per room", () => {
    const view = mergeRoomReads([
      read(
        { total: 10, since: 200, peakToday: 3, online: 2, members: ["a", "b"] },
        {},
        { a: 4, b: 6 },
      ),
      read(
        { total: 5, since: 100, peakToday: 2, online: 2, members: ["b", "c"] },
        {},
        { b: 1, c: 4 },
      ),
    ]);
    expect(view?.stats).toEqual({
      total: 15,
      since: 100,
      peakToday: 5,
      online: 3,
      members: ["a", "b", "c"],
    });
    expect(view?.counts).toEqual({ a: 4, b: 7, c: 4 });
  });

  it("reports the switch as off unless every room is closed", () => {
    const mixed = mergeRoomReads([
      read({}, { killed: true, killedAt: 5, killedBy: "mod" }),
      read({}, { killed: false }),
    ]);
    expect(mixed?.roomState.killed).toBe(false);

    const all = mergeRoomReads([
      read({}, { killed: true, killedAt: 5, killedBy: "mod" }),
      read({}, { killed: true, killedAt: 9, killedBy: "mod" }),
    ]);
    expect(all?.roomState).toEqual({
      killed: true,
      killedAt: 9,
      killedBy: "mod",
    });
  });

  it("keeps since null when no room has a message yet", () => {
    expect(mergeRoomReads([read(), read()])?.stats.since).toBeNull();
  });
});
