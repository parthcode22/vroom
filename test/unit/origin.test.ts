import { describe, it, expect } from "vitest";

import { isBrowserCrossOrigin, isSameOrigin } from "~/lib/origin.server";

/**
 * The primitive behind the CSRF check on every state-changing route. It is
 * asserted directly because the console action is one header away from being a
 * cross-site kill switch, and the only thing standing there before was a
 * dependency's default cookie setting.
 */

function post(headers: Record<string, string>): Request {
  return new Request("https://v-rooms.test/mod", { method: "POST", headers });
}

describe("isSameOrigin, for the cookie-authenticated doors", () => {
  it("accepts a same-origin fetch and a user-initiated navigation", () => {
    expect(isSameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(post({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("refuses cross-site, and refuses a sibling subdomain too", () => {
    expect(isSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(post({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("falls back to Origin when fetch metadata is absent", () => {
    expect(isSameOrigin(post({ origin: "https://v-rooms.test" }))).toBe(true);
    expect(isSameOrigin(post({ origin: "https://attacker.example" }))).toBe(
      false,
    );
    // Same host, different scheme or port is a different origin.
    expect(isSameOrigin(post({ origin: "http://v-rooms.test" }))).toBe(false);
  });

  it("refuses a request that proves nothing, rather than assuming the best", () => {
    expect(isSameOrigin(post({}))).toBe(false);
  });

  it("does not let a forged Origin override honest fetch metadata", () => {
    const request = post({
      "sec-fetch-site": "cross-site",
      origin: "https://v-rooms.test",
    });
    expect(isSameOrigin(request)).toBe(false);
  });
});

describe("isBrowserCrossOrigin, for the token-authenticated door", () => {
  it("admits a caller with no browser headers, which is what the script is", () => {
    expect(isBrowserCrossOrigin(post({}))).toBe(false);
  });

  it("rejects a browser that says it is cross-site", () => {
    expect(isBrowserCrossOrigin(post({ "sec-fetch-site": "cross-site" }))).toBe(
      true,
    );
    expect(
      isBrowserCrossOrigin(post({ origin: "https://attacker.example" })),
    ).toBe(true);
  });

  it("admits the app's own origin", () => {
    expect(
      isBrowserCrossOrigin(post({ "sec-fetch-site": "same-origin" })),
    ).toBe(false);
    expect(isBrowserCrossOrigin(post({ origin: "https://v-rooms.test" }))).toBe(
      false,
    );
  });
});
