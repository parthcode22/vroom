import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { isSignInRequest, isVAuthSignInOpen } from "~/lib/sign-in.server";

const handler = vi.fn(async () => new Response("from better-auth"));

vi.mock("~/lib/auth.server", () => ({
  auth: { handler: (...a: unknown[]) => handler(...(a as [])) },
}));

const { loader, action } = await import("~/routes/api.auth.$");

const url = (path: string) => `https://vroom.vosslabs.org${path}`;

describe("isVAuthSignInOpen", () => {
  it("is open by default and for any value other than off", () => {
    expect(isVAuthSignInOpen(undefined)).toBe(true);
    expect(isVAuthSignInOpen("on")).toBe(true);
    expect(isVAuthSignInOpen("")).toBe(true);
    expect(isVAuthSignInOpen("of")).toBe(true);
  });

  it("is closed for off, ignoring case and whitespace", () => {
    expect(isVAuthSignInOpen("off")).toBe(false);
    expect(isVAuthSignInOpen(" OFF ")).toBe(false);
  });
});

describe("isSignInRequest", () => {
  it("matches the paths that start or finish a sign-in", () => {
    expect(isSignInRequest(new Request(url("/api/auth/sign-in/oauth2")))).toBe(
      true,
    );
    expect(
      isSignInRequest(new Request(url("/api/auth/oauth2/callback/voss"))),
    ).toBe(true);
  });

  it("leaves session reads and sign-out alone", () => {
    expect(isSignInRequest(new Request(url("/api/auth/get-session")))).toBe(
      false,
    );
    expect(isSignInRequest(new Request(url("/api/auth/sign-out")))).toBe(false);
  });
});

describe("api/auth/* while sign-in is paused", () => {
  const original = process.env.VAUTH_SIGN_IN;

  beforeEach(() => {
    handler.mockClear();
    process.env.VAUTH_SIGN_IN = "off";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.VAUTH_SIGN_IN;
    else process.env.VAUTH_SIGN_IN = original;
  });

  it("refuses a new sign-in without reaching better-auth", async () => {
    const request = new Request(url("/api/auth/sign-in/oauth2"), {
      method: "POST",
    });
    const res = await action({ request } as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "sign_in_paused" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses the OAuth callback", async () => {
    const request = new Request(url("/api/auth/oauth2/callback/voss"));
    const res = await loader({ request } as never);
    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still serves the session and sign-out", async () => {
    await loader({
      request: new Request(url("/api/auth/get-session")),
    } as never);
    await action({
      request: new Request(url("/api/auth/sign-out"), { method: "POST" }),
    } as never);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("passes sign-in through once reopened", async () => {
    process.env.VAUTH_SIGN_IN = "on";
    const request = new Request(url("/api/auth/sign-in/oauth2"), {
      method: "POST",
    });
    await action({ request } as never);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
