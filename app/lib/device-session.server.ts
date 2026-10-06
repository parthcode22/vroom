import { SignJWT, base64url, errors, jwtVerify } from "jose";

/**
 * Student sign-in by device key (VRIP-13).
 *
 * The browser holds a non-extractable ECDSA P-256 private key. To enter, it
 * signs a short-lived challenge; the server verifies the signature against the
 * public key the browser presents and identifies the student by the sha256 of
 * that key. Nothing else about the student is learned or stored.
 *
 * A verified proof is exchanged for an HttpOnly session cookie carrying only the
 * member id, so the room loader, the token mint and the report endpoint resolve
 * a student the same way they resolve a moderator's better-auth session.
 */

const ISSUER = "v-rooms";
const CHALLENGE_AUDIENCE = "v-rooms.device-challenge";
const SESSION_AUDIENCE = "v-rooms.device-session";
const CHALLENGE_TTL_SECONDS = 60;
export const DEVICE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const DEVICE_COOKIE = "vr_device";

/** Prefixed so a signature over a challenge cannot be replayed as anything else. */
export const SIGNING_PREFIX = "v-rooms.device-session.v1:";

/** A P-256 SPKI is 91 bytes; anything far outside that is not one. */
const MAX_SPKI_BYTES = 200;
/** IEEE P1363 r||s for P-256, which is what WebCrypto produces. */
const SIGNATURE_BYTES = 64;

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

function secret(): Uint8Array {
  const value = process.env.DEVICE_SESSION_SECRET;
  if (!value) throw new Error("DEVICE_SESSION_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function mintChallenge(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + CHALLENGE_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(secret());
}

export type ProofResult =
  | { ok: true; keyHash: string }
  | {
      ok: false;
      reason:
        "challenge_expired" | "bad_challenge" | "bad_key" | "bad_signature";
    };

export interface DeviceProof {
  publicKey: unknown;
  challenge: unknown;
  signature: unknown;
}

function decode(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new Uint8Array(base64url.decode(value));
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifyDeviceProof(
  proof: DeviceProof,
): Promise<ProofResult> {
  if (typeof proof.challenge !== "string")
    return { ok: false, reason: "bad_challenge" };
  try {
    await jwtVerify(proof.challenge, secret(), {
      issuer: ISSUER,
      audience: CHALLENGE_AUDIENCE,
      algorithms: ["HS256"],
    });
  } catch (error) {
    if (error instanceof errors.JWTExpired)
      return { ok: false, reason: "challenge_expired" };
    return { ok: false, reason: "bad_challenge" };
  }

  const spki = decode(proof.publicKey);
  if (!spki || spki.length > MAX_SPKI_BYTES)
    return { ok: false, reason: "bad_key" };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", spki, ECDSA, false, ["verify"]);
  } catch {
    return { ok: false, reason: "bad_key" };
  }

  const signature = decode(proof.signature);
  if (!signature || signature.length !== SIGNATURE_BYTES)
    return { ok: false, reason: "bad_signature" };

  const signed = new TextEncoder().encode(SIGNING_PREFIX + proof.challenge);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      signed,
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  return { ok: true, keyHash: await sha256Hex(spki) };
}

export async function mintDeviceSession(memberId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + DEVICE_SESSION_TTL_SECONDS)
    .sign(secret());
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return null;
}

/** The member id behind a valid device cookie, or null. Never throws. */
export async function readDeviceSession(
  request: Request,
): Promise<string | null> {
  const token = cookieValue(request, DEVICE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function secureFlag(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function deviceSessionCookie(request: Request, token: string): string {
  return `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_SESSION_TTL_SECONDS}${secureFlag(request)}`;
}

export function clearDeviceSessionCookie(request: Request): string {
  return `${DEVICE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(request)}`;
}
