import { describe, it, expect, vi, beforeEach } from "vitest";

import type { MemberRecord } from "~/db/queries/members";

const findMemberById = vi.fn();
const setSuspended = vi.fn();
const findReport = vi.fn();
const setReportStatus = vi.fn();
const writeAudit = vi.fn();
const resolveIdentity = vi.fn();
const getRoom = vi.fn();

vi.mock("~/db/queries/members", () => ({
  findMemberById: (...a: unknown[]) => findMemberById(...a),
  setSuspended: (...a: unknown[]) => setSuspended(...a),
  claimPseudonym: vi.fn(),
}));
vi.mock("~/db/queries/reports", () => ({
  findReport: (...a: unknown[]) => findReport(...a),
  setReportStatus: (...a: unknown[]) => setReportStatus(...a),
}));
vi.mock("~/db/queries/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
}));
vi.mock("~/lib/identity.server", () => ({
  resolveIdentity: (...a: unknown[]) => resolveIdentity(...a),
}));
vi.mock("~/lib/room.server", () => ({
  getRoom: () => getRoom(),
  RoomUnreachable: class RoomUnreachable extends Error {},
}));

const { performModeration, MOD_INTENTS, isModIntent } =
  await import("~/lib/moderation.server");
const { ModerationError } = await import("~/lib/require-role.server");

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: "m1",
    userId: "u1",
    pseudonym: "quiet-ibex",
    isModerator: true,
    suspendedAt: null,
    suspendedReason: null,
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Records the order calls arrive in, which is the property VRIP-08 fixes. */
let order: string[];

function room() {
  return {
    deleteMessage: vi.fn(async () => {
      order.push("do");
      return { ok: true };
    }),
    suspend: vi.fn(async () => {
      order.push("do");
    }),
    restore: vi.fn(async () => {
      order.push("do");
    }),
    setKilled: vi.fn(async () => {
      order.push("do");
      return { killed: true, at: 1 };
    }),
  };
}

beforeEach(() => {
  order = [];
  vi.clearAllMocks();
  getRoom.mockResolvedValue(room());
  findReport.mockResolvedValue({
    id: "r1",
    messageId: "msg1",
    snapshot: "text",
    reason: null,
    handle: "grumpy-heron",
    reportedMemberId: "m2",
    status: "open",
    createdAt: new Date(),
  });
  findMemberById.mockResolvedValue(
    member({ id: "m2", pseudonym: "grumpy-heron" }),
  );
  setReportStatus.mockImplementation(async () => {
    order.push("neon");
    return true;
  });
  setSuspended.mockImplementation(async () => {
    order.push("neon");
    return null;
  });
  writeAudit.mockImplementation(async () => {
    order.push("audit");
    return { id: "a1" };
  });
  resolveIdentity.mockResolvedValue({
    email: "x@vit.edu.in",
    name: "X",
    auditId: "a1",
  });
});

const FIELDS = { reportId: "r1", memberId: "m2", killed: true };

describe("role enforcement", () => {
  it("refuses every action for a non-moderator", async () => {
    const student = member({ isModerator: false });
    for (const intent of MOD_INTENTS) {
      await expect(
        performModeration({ member: student, kind: "console" }, intent, FIELDS),
      ).rejects.toMatchObject({ code: "not_moderator" });
    }
    // Nothing reached enforcement or the record.
    expect(order).toEqual([]);
  });

  it("refuses a tombstoned moderator", async () => {
    const gone = member({ deletedAt: new Date() });
    await expect(
      performModeration({ member: gone, kind: "console" }, "suspend", FIELDS),
    ).rejects.toMatchObject({ code: "not_moderator" });
  });

  it("refuses every action for a suspended moderator", async () => {
    // Suspension is the product's only remedy against a moderator. A guard that
    // reads deletedAt but not suspendedAt leaves the suspended account the kill
    // switch, restore on itself, and reveal — which returns an email address.
    const suspended = member({ suspendedAt: new Date() });
    for (const intent of MOD_INTENTS) {
      await expect(
        performModeration(
          { member: suspended, kind: "console" },
          intent,
          FIELDS,
        ),
      ).rejects.toMatchObject({ code: "not_moderator" });
    }
    expect(order).toEqual([]);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("refuses a suspended moderator at the script door too", async () => {
    const suspended = member({ suspendedAt: new Date() });
    await expect(
      performModeration({ member: suspended, kind: "script" }, "restore", {
        memberId: "m1",
      }),
    ).rejects.toMatchObject({ code: "not_moderator" });
  });

  it("applies the same check to the script front door", async () => {
    const student = member({ isModerator: false });
    await expect(
      performModeration(
        { member: student, kind: "script" },
        "set_room_state",
        FIELDS,
      ),
    ).rejects.toBeInstanceOf(ModerationError);
  });

  it("recognises exactly the six documented intents", () => {
    expect([...MOD_INTENTS].sort()).toEqual(
      [
        "delete_message",
        "dismiss_report",
        "restore",
        "reveal",
        "set_room_state",
        "suspend",
      ].sort(),
    );
    expect(isModIntent("suspend")).toBe(true);
    expect(isModIntent("drop_database")).toBe(false);
  });
});

describe("ordering: enforcement first, record second", () => {
  it("suspends in the object before writing Neon and the audit row", async () => {
    await performModeration({ member: member(), kind: "console" }, "suspend", {
      memberId: "m2",
    });
    expect(order).toEqual(["do", "neon", "audit"]);
  });

  it("also resolves the report when the suspension came from one", async () => {
    await performModeration(
      { member: member(), kind: "console" },
      "suspend",
      FIELDS,
    );
    expect(order).toEqual(["do", "neon", "neon", "audit"]);
  });

  it("deletes in the object before resolving the report", async () => {
    await performModeration(
      { member: member(), kind: "console" },
      "delete_message",
      FIELDS,
    );
    expect(order).toEqual(["do", "neon", "audit"]);
  });

  it("closes the room in the object before recording it", async () => {
    await performModeration(
      { member: member(), kind: "console" },
      "set_room_state",
      FIELDS,
    );
    expect(order).toEqual(["do", "audit"]);
  });

  it("writes nothing to Neon when the object is unreachable", async () => {
    getRoom.mockRejectedValue(new Error("no binding"));
    await expect(
      performModeration(
        { member: member(), kind: "console" },
        "suspend",
        FIELDS,
      ),
    ).rejects.toMatchObject({ code: "room_unreachable" });
    expect(order).toEqual([]);
    expect(setSuspended).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("reveal", () => {
  it("is the exception: it goes through the audited resolver, bound to a report", async () => {
    const result = await performModeration(
      { member: member(), kind: "console" },
      "reveal",
      FIELDS,
    );
    expect(resolveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: "r1",
        memberId: "m2",
        actorKind: "console",
      }),
    );
    expect(result).toEqual({
      intent: "reveal",
      email: "x@vit.edu.in",
      name: "X",
    });
  });

  it("cannot be performed without a report", async () => {
    await expect(
      performModeration({ member: member(), kind: "console" }, "reveal", {
        reportId: null,
      }),
    ).rejects.toMatchObject({ code: "report_not_found" });
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("refuses an unknown report rather than falling through to a bare lookup", async () => {
    findReport.mockResolvedValue(null);
    await expect(
      performModeration({ member: member(), kind: "console" }, "reveal", {
        reportId: "nope",
      }),
    ).rejects.toMatchObject({ code: "report_not_found" });
    expect(resolveIdentity).not.toHaveBeenCalled();
  });
});

describe("error paths", () => {
  it("reports a missing member", async () => {
    findMemberById.mockResolvedValue(null);
    await expect(
      performModeration(
        { member: member(), kind: "console" },
        "suspend",
        FIELDS,
      ),
    ).rejects.toMatchObject({ code: "member_not_found" });
  });

  it("refuses to suspend an account with no handle, since the object keys on it", async () => {
    findMemberById.mockResolvedValue(member({ id: "m2", pseudonym: null }));
    await expect(
      performModeration(
        { member: member(), kind: "console" },
        "suspend",
        FIELDS,
      ),
    ).rejects.toMatchObject({ code: "member_not_found" });
  });

  it("reports an already-closed report on dismiss", async () => {
    setReportStatus.mockResolvedValue(false);
    await expect(
      performModeration(
        { member: member(), kind: "console" },
        "dismiss_report",
        FIELDS,
      ),
    ).rejects.toMatchObject({ code: "already_resolved" });
  });

  it("dismiss has no object leg, because nothing a student can do changes", async () => {
    await performModeration(
      { member: member(), kind: "console" },
      "dismiss_report",
      FIELDS,
    );
    expect(order).toEqual(["neon", "audit"]);
  });
});
