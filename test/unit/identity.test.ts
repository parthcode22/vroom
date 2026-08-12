import { describe, it, expect, vi, beforeEach } from "vitest";

const writeAudit = vi.fn();
const selectChain = vi.fn();

vi.mock("~/db/queries/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
}));

vi.mock("~/db", () => ({
  db: {
    select: (...a: unknown[]) => selectChain(...a),
  },
}));

const { resolveIdentity } = await import("~/lib/identity.server");

function rows(value: Array<{ email: string; name: string }>) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: async () => value,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeAudit.mockResolvedValue({ id: "audit-1" });
  selectChain.mockReturnValue(
    rows([{ email: "rohan@vit.edu.in", name: "Rohan" }]),
  );
});

const INPUT = {
  memberId: "m2",
  actorMemberId: "m1",
  actorKind: "console" as const,
  reportId: "r1",
  messageId: "msg1",
};

describe("identity resolution", () => {
  it("writes the audit row before reading the account", async () => {
    const seen: string[] = [];
    writeAudit.mockImplementation(async () => {
      seen.push("audit");
      return { id: "audit-1" };
    });
    selectChain.mockImplementation(() => {
      seen.push("read");
      return rows([{ email: "rohan@vit.edu.in", name: "Rohan" }]);
    });

    const result = await resolveIdentity(INPUT);

    expect(seen).toEqual(["audit", "read"]);
    expect(result.email).toBe("rohan@vit.edu.in");
    expect(result.auditId).toBe("audit-1");
  });

  it("records a reveal bound to the report that justified it", async () => {
    await resolveIdentity(INPUT);
    expect(writeAudit).toHaveBeenCalledWith({
      action: "reveal",
      actorMemberId: "m1",
      actorKind: "console",
      targetType: "member",
      targetId: "m2",
      reportId: "r1",
      details: { messageId: "msg1" },
    });
  });

  it("refuses a bare lookup with no report", async () => {
    await expect(resolveIdentity({ ...INPUT, reportId: "" })).rejects.toThrow(
      /reportId is required/,
    );
    expect(writeAudit).not.toHaveBeenCalled();
    expect(selectChain).not.toHaveBeenCalled();
  });

  it("does not read the account when the audit write fails", async () => {
    // This is what the database CHECK produces for an unbound reveal.
    writeAudit.mockRejectedValue(
      new Error('violates check constraint "reveal_must_be_bound"'),
    );
    await expect(resolveIdentity(INPUT)).rejects.toThrow(
      /reveal_must_be_bound/,
    );
    expect(selectChain).not.toHaveBeenCalled();
  });

  it("fails loudly when there is no account behind the member", async () => {
    selectChain.mockReturnValue(rows([]));
    await expect(resolveIdentity(INPUT)).rejects.toThrow(
      /no account behind member/,
    );
  });
});
