import { describe, it, expect } from "vitest";

import {
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  clampLimit,
  isSocketAttachment,
  parseClientFrame,
} from "../../workers/protocol";

describe("client frames", () => {
  it("accepts the two documented frames", () => {
    expect(parseClientFrame('{"t":"send","body":"hello"}')).toEqual({
      t: "send",
      body: "hello",
    });
    expect(parseClientFrame('{"t":"history","before":40,"limit":25}')).toEqual({
      t: "history",
      before: 40,
      limit: 25,
    });
  });

  it("rejects anything else rather than half-parsing it", () => {
    expect(parseClientFrame("not json")).toBeNull();
    expect(parseClientFrame("null")).toBeNull();
    expect(parseClientFrame("[]")).toBeNull();
    expect(parseClientFrame('{"t":"send"}')).toBeNull();
    expect(parseClientFrame('{"t":"send","body":42}')).toBeNull();
    expect(parseClientFrame('{"t":"history"}')).toBeNull();
    expect(parseClientFrame('{"t":"delete","id":"x"}')).toBeNull();
  });
});

describe("page limits", () => {
  it("defaults and caps", () => {
    expect(clampLimit(undefined)).toBe(PAGE_SIZE);
    expect(clampLimit(0)).toBe(PAGE_SIZE);
    expect(clampLimit(-5)).toBe(PAGE_SIZE);
    expect(clampLimit(NaN)).toBe(PAGE_SIZE);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(1000)).toBe(MAX_PAGE_SIZE);
  });
});

describe("socket attachment", () => {
  it("recognises only the versioned shape", () => {
    expect(isSocketAttachment({ v: 1, p: "quiet-ibex", j: 1 })).toBe(true);
    expect(isSocketAttachment({ v: 2, p: "quiet-ibex", j: 1 })).toBe(false);
    expect(isSocketAttachment({ p: "quiet-ibex" })).toBe(false);
    expect(isSocketAttachment(null)).toBe(false);
    expect(isSocketAttachment("quiet-ibex")).toBe(false);
  });
});
