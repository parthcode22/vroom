import { describe, it, expect } from "vitest";

import {
  HANDLE_PATTERN,
  WORDLIST_SIZES,
  handleCandidate,
  isValidHandle,
  randomHandle,
  randomHandleWithSuffix,
} from "~/lib/pseudonym";

describe("pseudonym generation", () => {
  it("keeps the curated wordlist sizes from voss-ask", () => {
    // The lists are the only thing keeping output inside [a-z-]; a changed count
    // means someone edited them, which is exactly when this should fail.
    expect(WORDLIST_SIZES.adjectives).toBe(80);
    expect(WORDLIST_SIZES.animals).toBe(71);
  });

  it("produces lowercase hyphenated handles", () => {
    for (let i = 0; i < 500; i++) {
      const handle = randomHandle();
      expect(handle).toMatch(/^[a-z]+-[a-z]+$/);
      expect(HANDLE_PATTERN.test(handle)).toBe(true);
    }
  });

  it("zero-pads the numeric suffix to four digits", () => {
    for (let i = 0; i < 500; i++) {
      const handle = randomHandleWithSuffix();
      expect(handle).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    }
  });

  it("spreads across the wordlists rather than returning one value", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(randomHandle());
    expect(seen.size).toBeGreaterThan(200);
  });

  it("switches to the numeric suffix on the third consecutive collision", () => {
    expect(handleCandidate(0)).toMatch(/^[a-z]+-[a-z]+$/);
    expect(handleCandidate(1)).toMatch(/^[a-z]+-[a-z]+$/);
    expect(handleCandidate(2)).toMatch(/^[a-z]+-[a-z]+$/);
    expect(handleCandidate(3)).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(handleCandidate(7)).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
  });

  it("rejects anything outside the charset", () => {
    expect(isValidHandle("quiet-ibex")).toBe(true);
    expect(isValidHandle("quiet-ibex-0042")).toBe(true);
    expect(isValidHandle("Quiet-Ibex")).toBe(false);
    expect(isValidHandle("quiet_ibex")).toBe(false);
    expect(isValidHandle("quiet ibex")).toBe(false);
    expect(isValidHandle("quietibex")).toBe(false);
    expect(isValidHandle("")).toBe(false);
    expect(isValidHandle("a".repeat(80) + "-ibex")).toBe(false);
  });
});
