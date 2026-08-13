import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EPHEMERAL_TTL_MS,
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
      confirmed: false,
    });
    // A client that says it was warned must say so explicitly; anything other
    // than true is not a confirmation (VRIP-09).
    expect(
      parseClientFrame('{"t":"send","body":"x","confirmed":true}'),
    ).toEqual({ t: "send", body: "x", confirmed: true });
    expect(
      parseClientFrame('{"t":"send","body":"x","confirmed":"yes"}'),
    ).toEqual({ t: "send", body: "x", confirmed: false });
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

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(`${ROOT}/${dir}`)) {
    const path = `${dir}/${name}`;
    if (statSync(`${ROOT}/${path}`).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("the ephemeral TTL (VRIP-10)", () => {
  it("is sixty seconds", () => {
    expect(EPHEMERAL_TTL_MS).toBe(60_000);
  });

  it("is written down once, in the module both sides import", () => {
    // The client counts down with it and the wire contract defines it, so a
    // second copy in a component is a copy that drifts. Scanned rather than
    // asserted on behaviour, because drift is a source property.
    const files = [...sources("app"), ...sources("workers")];
    expect(files.length).toBeGreaterThan(20);

    const declaring = files.filter((file) =>
      /EPHEMERAL_TTL_MS\s*=/.test(readFileSync(`${ROOT}/${file}`, "utf-8")),
    );
    expect(declaring).toEqual(["workers/protocol.ts"]);

    // The server side of the wire has other honest minutes in it — the rate
    // window, the auto-suspension window — so the literal scan is the client,
    // which is where the countdown actually runs and where a copy would drift.
    const client = sources("app").filter((file) =>
      /ephemeral/i.test(readFileSync(`${ROOT}/${file}`, "utf-8")),
    );
    expect(client.length).toBeGreaterThan(2);

    for (const file of client) {
      const source = readFileSync(`${ROOT}/${file}`, "utf-8");
      expect(/\b60_?000\b/.test(source), `${file} re-types the TTL`).toBe(
        false,
      );
    }

    // Both sides genuinely read the one constant rather than merely agreeing.
    const users = files.filter((file) =>
      /EPHEMERAL_TTL_MS/.test(readFileSync(`${ROOT}/${file}`, "utf-8")),
    );
    expect(users).toContain("app/routes/room.tsx");
    expect(users).toContain("workers/protocol.ts");
  });
});
