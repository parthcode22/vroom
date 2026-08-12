import { describe, it, expect, beforeAll } from "vitest";
import { decodeJwt } from "jose";

import { mintAppToken, verifyAppToken } from "~/lib/app-token.server";

beforeAll(() => {
  process.env.APP_JWT_SECRET = "test-app-jwt-secret-value-not-a-real-one";
});

describe("app token", () => {
  it("round-trips the pseudonym and room", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "campus-live" },
      900,
    );
    const result = await verifyAppToken(token, "campus-live");
    expect(result).toEqual({
      ok: true,
      claims: { pseudonym: "quiet-ibex", room: "campus-live" },
    });
  });

  it("carries the handle and room and nothing else", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "campus-live" },
      900,
    );
    const payload = decodeJwt(token);

    // VRIP-04 and VRIP-07: the email and the V Auth subject never enter the
    // token, and neither does a moderator claim.
    expect(Object.keys(payload).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "jti", "room", "sub"].sort(),
    );
    expect(payload.sub).toBe("quiet-ibex");
    expect(JSON.stringify(payload)).not.toMatch(/@/);
  });

  it("rejects a token minted for another room", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "other-room" },
      900,
    );
    expect(await verifyAppToken(token, "campus-live")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reports an expired token separately so the client can just reconnect", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "campus-live" },
      -10,
    );
    expect(await verifyAppToken(token, "campus-live")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a tampered signature", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "campus-live" },
      900,
    );
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"a".repeat(parts[2].length)}`;
    expect(await verifyAppToken(tampered, "campus-live")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintAppToken(
      { pseudonym: "quiet-ibex", room: "campus-live" },
      900,
    );
    process.env.APP_JWT_SECRET = "a-completely-different-secret-value";
    expect(await verifyAppToken(token, "campus-live")).toEqual({
      ok: false,
      reason: "invalid",
    });
    process.env.APP_JWT_SECRET = "test-app-jwt-secret-value-not-a-real-one";
  });

  it("rejects garbage", async () => {
    expect(await verifyAppToken("not-a-token", "campus-live")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
