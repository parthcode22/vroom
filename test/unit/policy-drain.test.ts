import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { FlagRow } from "../../workers/policy-store";

/**
 * The bridge between the identity-blind room object and Neon.
 *
 * Two properties are worth more than the rest of this file: a flag never
 * becomes two reports, and the Durable Object never gains the ability to
 * resolve a pseudonym to a person. The first is a behaviour, the second is a
 * structural claim about the module graph, so they are tested differently.
 */

const drainFlags = vi.fn();
const ackFlags = vi.fn();
const findMemberByPseudonym = vi.fn();
const setSuspended = vi.fn();
const createAutoFlagReport = vi.fn();
const writeAudit = vi.fn();

vi.mock("~/lib/room.server", () => ({
  RoomUnreachable: class RoomUnreachable extends Error {},
  getRoom: async () => ({ drainFlags, ackFlags }),
  // Faithful to the real helper, which swallows an unreachable object and
  // returns null rather than throwing. The degrading test below depends on it.
  // Only campus-live holds flags here; the other rooms drain empty.
  tryRoom: async (id: string, fn: (stub: unknown) => unknown) => {
    if (id !== "campus-live") return [];
    try {
      return await fn({ drainFlags, ackFlags });
    } catch {
      return null;
    }
  },
}));
vi.mock("~/db/queries/members", () => ({
  findMemberByPseudonym: (...a: unknown[]) => findMemberByPseudonym(...a),
  setSuspended: (...a: unknown[]) => setSuspended(...a),
}));
vi.mock("~/db/queries/reports", () => ({
  createAutoFlagReport: (...a: unknown[]) => createAutoFlagReport(...a),
}));
vi.mock("~/db/queries/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
}));

const { drainPolicyFlags } = await import("~/lib/policy.server");

function flag(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    id: 7,
    pseudonym: "quiet-ibex",
    tier: "block",
    matches: "abuse, a handle",
    snippet: "bc swift-heron is at it again",
    targeted: true,
    confirmed: false,
    autoSuspended: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Stands in for the partial unique index: one flag id, one report, ever. */
function neonWithUniqueIndex() {
  const seen = new Set<string>();
  createAutoFlagReport.mockImplementation(
    async (input: { roomId: string; flagId: number }) => {
      const key = `${input.roomId}:${input.flagId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { id: `report-${input.flagId}` };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findMemberByPseudonym.mockResolvedValue({ id: "member-1" });
  setSuspended.mockResolvedValue(null);
  writeAudit.mockResolvedValue({ id: "audit-1" });
  neonWithUniqueIndex();
});

describe("materialising flags as reports", () => {
  it("files the snippet against the member behind the handle", async () => {
    drainFlags.mockResolvedValue([flag()]);

    const result = await drainPolicyFlags();

    expect(result).toMatchObject({ drained: 1, created: 1, suspended: 0 });
    expect(createAutoFlagReport).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "campus-live",
        flagId: 7,
        reportedMemberId: "member-1",
        snippet: "bc swift-heron is at it again",
      }),
    );
    // The cursor moves only once the flag is genuinely dealt with.
    expect(ackFlags).toHaveBeenCalledWith(7);
  });

  it("never turns one flag into two reports across two drains", async () => {
    // The object's cursor advances on ack, not on read, so a console that dies
    // mid-write sees the same flags again. This is the layer that makes seeing
    // them twice harmless.
    drainFlags.mockResolvedValue([flag({ id: 11 })]);

    const first = await drainPolicyFlags();
    const second = await drainPolicyFlags();

    expect(first.created).toBe(1);
    expect(second.drained).toBe(1);
    expect(second.created).toBe(0);
    expect(createAutoFlagReport).toHaveBeenCalledTimes(2);
  });

  it("does not re-suspend on a repeat drain", async () => {
    drainFlags.mockResolvedValue([flag({ id: 12, autoSuspended: true })]);

    await drainPolicyFlags();
    await drainPolicyFlags();

    expect(setSuspended).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});

describe("what reaches Neon (VRIP-10)", () => {
  it("strips a value out of the snippet before it becomes a report", async () => {
    // Redacted at the boundary rather than trusted from the object. Neon is
    // permanent and joined to identity, and the queue can still hold flags
    // written before VRIP-10 — this is the last gate in front of both.
    drainFlags.mockResolvedValue([
      flag({ id: 40, snippet: "bc quiet-ibex ring 9876543210 tonight" }),
    ]);

    await drainPolicyFlags();

    const written = createAutoFlagReport.mock.calls[0][0] as {
      snippet: string;
      reason: string;
    };
    expect(written.snippet).not.toContain("9876543210");
    expect(written.snippet).not.toMatch(/\d/);
    // The incident itself still arrives. Redaction is not deletion.
    expect(written.snippet).toContain("quiet-ibex");
    expect(written.snippet).toContain("a phone number");
    // The reason is built from labels, so it can never carry a value either.
    expect(written.reason).not.toMatch(/\d/);
  });

  it("files a personal-data flag as the fact and not a copy", async () => {
    drainFlags.mockResolvedValue([
      flag({
        id: 41,
        tier: "confirm",
        matches: "a phone number",
        snippet:
          "a phone number shared. Not stored, and the value is not recorded.",
        targeted: false,
      }),
    ]);

    await drainPolicyFlags();

    const written = createAutoFlagReport.mock.calls[0][0] as {
      snippet: string;
    };
    expect(written.snippet).not.toMatch(/\d/);
    expect(written.snippet).toContain("a phone number");
  });
});

describe("mirroring an auto-suspension", () => {
  it("writes the Neon suspension and an audit row with no human actor", async () => {
    drainFlags.mockResolvedValue([flag({ id: 20, autoSuspended: true })]);

    const result = await drainPolicyFlags();

    expect(result.suspended).toBe(1);
    expect(setSuspended).toHaveBeenCalledWith(
      "member-1",
      true,
      expect.any(String),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auto_suspend",
        // Nobody decided this. An audit row naming a moderator would be a lie.
        actorMemberId: null,
        targetType: "member",
        targetId: "member-1",
        reportId: "report-20",
      }),
    );
  });

  it("leaves a plain block alone", async () => {
    drainFlags.mockResolvedValue([flag({ id: 21 })]);
    await drainPolicyFlags();
    expect(setSuspended).not.toHaveBeenCalled();
  });
});

describe("degrading", () => {
  it("acknowledges and drops a handle with no member behind it", async () => {
    // Retrying forever would wedge the drain on one unusable row and every
    // later flag behind it.
    findMemberByPseudonym.mockResolvedValue(null);
    drainFlags.mockResolvedValue([flag({ id: 30 })]);

    const result = await drainPolicyFlags();

    expect(result.created).toBe(0);
    expect(createAutoFlagReport).not.toHaveBeenCalled();
    expect(ackFlags).toHaveBeenCalledWith(30);
  });

  it("reports an unreachable room rather than taking the queue down", async () => {
    // The queue is the only surface a moderator has. A sleeping room object
    // must not be what stops them reading it.
    drainFlags.mockRejectedValue(new Error("no object"));

    const result = await drainPolicyFlags();

    expect(result.unreachable).toBe(true);
    expect(result.created).toBe(0);
    expect(createAutoFlagReport).not.toHaveBeenCalled();
  });

  it("does nothing at all when there is nothing to drain", async () => {
    drainFlags.mockResolvedValue([]);
    const result = await drainPolicyFlags();
    expect(result).toEqual({
      drained: 0,
      created: 0,
      suspended: 0,
      unreachable: false,
    });
    expect(ackFlags).not.toHaveBeenCalled();
  });
});

const WORKERS = fileURLToPath(new URL("../../workers", import.meta.url));

/** Every module the Durable Object pulls in, transitively, keyed by filename. */
function graphFrom(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const source = readFileSync(`${WORKERS}/${file}`, "utf-8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
      (m) => m[1],
    );
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      if (specifier.startsWith("./")) queue.push(`${specifier.slice(2)}.ts`);
    }
  }
  return seen;
}

describe("the room object's module graph", () => {
  it("imports nothing that could resolve a pseudonym to a person", () => {
    // VRIP-04's containment property is structural, not a convention. Anything
    // reaching Neon from in here could answer "who is this handle", and the
    // whole identity model rests on the object being unable to. The graph is
    // walked from room-do.ts rather than over the directory, because app.ts is
    // the Worker entry and is allowed everything the object is not.
    const graph = graphFrom("room-do.ts");

    // The walk must actually have traversed, or this passes by finding nothing.
    expect([...graph.keys()]).toEqual(
      expect.arrayContaining([
        "room-do.ts",
        "room-frames.ts",
        "room-sql.ts",
        "policy-store.ts",
        "policy.ts",
        "policy-patterns.ts",
        "policy-words.ts",
        "handles.ts",
      ]),
    );

    // A leaf like env.ts legitimately imports nothing, so vacuity is ruled out
    // by the graph's total edge count rather than per file.
    const edges = [...graph.values()].flat();
    expect(edges.length).toBeGreaterThan(10);

    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        const local = specifier.startsWith("./") && !specifier.includes("..");
        expect(
          local || specifier === "cloudflare:workers",
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });
});
