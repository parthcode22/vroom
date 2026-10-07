import { describe, expect, it, vi } from "vitest";

import { checkNewHandle, type HandleLimiter } from "~/lib/handle-brake.server";

/**
 * VRIP-13's edge brake on new handles. The address is the counter's key and
 * nothing else, and the brake fails open: it slows scripts, it is not allowed
 * to lock students out when the counter is unavailable.
 */

function request(ip?: string) {
  return new Request("https://vroom.vosslabs.org/api/device/session", {
    method: "POST",
    headers: ip ? { "cf-connecting-ip": ip } : {},
  });
}

function limiter(success: boolean): HandleLimiter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      return { success };
    },
  };
}

describe("checkNewHandle", () => {
  it("allows a new handle under the limit, keyed by the connecting address", async () => {
    const counter = limiter(true);
    expect(await checkNewHandle(counter, request("203.0.113.7"))).toBe(true);
    expect(counter.calls).toEqual(["203.0.113.7"]);
  });

  it("refuses a new handle over the limit", async () => {
    expect(await checkNewHandle(limiter(false), request("203.0.113.7"))).toBe(
      false,
    );
  });

  it("fails open without a binding or without an address", async () => {
    expect(await checkNewHandle(undefined, request("203.0.113.7"))).toBe(true);
    const counter = limiter(false);
    expect(await checkNewHandle(counter, request())).toBe(true);
    expect(counter.calls).toEqual([]);
  });

  it("fails open when the limiter throws, and never logs the address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: HandleLimiter = {
      limit: () => Promise.reject(new Error("limiter down")),
    };
    expect(await checkNewHandle(broken, request("203.0.113.7"))).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("203.0.113.7");
    log.mockRestore();
  });
});
