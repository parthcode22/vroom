import { SignJWT, jwtVerify, errors } from "jose";

/**
 * The app token. The only module that touches APP_JWT_SECRET.
 *
 * It carries the pseudonym, the room, and nothing else — no moderator claim,
 * because moderation never travels over the socket, and no email or V Auth
 * subject, because the socket layer is structurally blind (VRIP-04, VRIP-07).
 *
 * The token authorises OPENING a socket. It is not re-checked for the life of
 * the connection; a socket that should no longer exist is closed by the Durable
 * Object instead.
 */

const ISSUER = "v-rooms";
const AUDIENCE = "v-rooms.socket";

export interface AppTokenClaims {
  pseudonym: string;
  room: string;
}

function secret(): Uint8Array {
  const value = process.env.APP_JWT_SECRET;
  if (!value) throw new Error("APP_JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function mintAppToken(
  claims: AppTokenClaims,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ room: claims.room })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.pseudonym)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setJti(crypto.randomUUID())
    .sign(secret());
}

export type VerifyResult =
  | { ok: true; claims: AppTokenClaims }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyAppToken(
  token: string,
  expectedRoom: string,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });

    const pseudonym = payload.sub;
    const room = payload.room;
    if (typeof pseudonym !== "string" || typeof room !== "string") {
      return { ok: false, reason: "invalid" };
    }
    if (room !== expectedRoom) return { ok: false, reason: "invalid" };

    return { ok: true, claims: { pseudonym, room } };
  } catch (error) {
    if (error instanceof errors.JWTExpired)
      return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
