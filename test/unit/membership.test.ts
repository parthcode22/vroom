import { describe, it, expect, vi, beforeEach } from "vitest";

const claimPseudonym = vi.fn();
const findMemberById = vi.fn();

vi.mock("~/db/queries/members", () => ({
  claimPseudonym: (...args: unknown[]) => claimPseudonym(...args),
  findMemberById: (...args: unknown[]) => findMemberById(...args),
}));

const { ensurePseudonym, PseudonymExhausted, isSuspended } =
  await import("~/lib/membership.server");
import type { MemberRecord } from "~/db/queries/members";

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: "m1",
    userId: "u1",
    pseudonym: null,
    isModerator: false,
    suspendedAt: null,
    suspendedReason: null,
    deletedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  claimPseudonym.mockReset();
  findMemberById.mockReset();
});

describe("pseudonym claim", () => {
  it("returns an existing handle untouched", async () => {
    const existing = member({ pseudonym: "quiet-ibex" });
    expect(await ensurePseudonym(existing)).toBe(existing);
    expect(claimPseudonym).not.toHaveBeenCalled();
  });

  it("claims on the first attempt when there is no collision", async () => {
    claimPseudonym.mockResolvedValueOnce(true);
    const result = await ensurePseudonym(member());
    expect(claimPseudonym).toHaveBeenCalledTimes(1);
    expect(result.pseudonym).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("retries on collision and escalates to the numeric suffix at the fourth try", async () => {
    // A collision is a successful call returning false, never an error.
    claimPseudonym
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    findMemberById.mockResolvedValue(member());

    const result = await ensurePseudonym(member());

    expect(claimPseudonym).toHaveBeenCalledTimes(4);
    const fourthCandidate = claimPseudonym.mock.calls[3][1] as string;
    expect(fourthCandidate).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(result.pseudonym).toBe(fourthCandidate);
  });

  it("never proposes the same candidate twice in a run", async () => {
    claimPseudonym.mockResolvedValue(false);
    findMemberById.mockResolvedValue(member());
    await expect(ensurePseudonym(member())).rejects.toBeInstanceOf(
      PseudonymExhausted,
    );

    const proposed = claimPseudonym.mock.calls.map((c) => c[1] as string);
    expect(new Set(proposed).size).toBe(proposed.length);
  });

  it("yields to a concurrent claim on the same member rather than looping", async () => {
    // The second tab won. The re-read tells that apart from a handle collision.
    claimPseudonym.mockResolvedValueOnce(false);
    findMemberById.mockResolvedValueOnce(member({ pseudonym: "swift-heron" }));

    const result = await ensurePseudonym(member());

    expect(result.pseudonym).toBe("swift-heron");
    expect(claimPseudonym).toHaveBeenCalledTimes(1);
  });

  it("gives up loudly rather than spinning forever", async () => {
    claimPseudonym.mockResolvedValue(false);
    findMemberById.mockResolvedValue(member());
    await expect(ensurePseudonym(member())).rejects.toBeInstanceOf(
      PseudonymExhausted,
    );
    expect(claimPseudonym).toHaveBeenCalledTimes(8);
  });

  it("propagates a database failure instead of treating it as a collision", async () => {
    claimPseudonym.mockRejectedValueOnce(new Error("neon unreachable"));
    await expect(ensurePseudonym(member())).rejects.toThrow("neon unreachable");
  });
});

describe("suspension", () => {
  it("treats a suspended or tombstoned member as suspended", () => {
    expect(isSuspended(member())).toBe(false);
    expect(isSuspended(member({ suspendedAt: new Date() }))).toBe(true);
    expect(isSuspended(member({ deletedAt: new Date() }))).toBe(true);
  });
});
