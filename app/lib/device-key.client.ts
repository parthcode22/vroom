/**
 * The browser half of device-key sign-in (VRIP-13).
 *
 * The key pair is generated once per browser with the private key marked
 * non-extractable, then kept in IndexedDB as a CryptoKey. Script on this origin
 * can ask it to sign but can never read it out, and the server only ever sees
 * the public key. Clearing this site's data loses the key, and with it the
 * handle, and there is no recovery: the server has nothing to recover from.
 */

const DB_NAME = "v-rooms";
const STORE = "device";
const KEY_ID = "identity";
const SIGNING_PREFIX = "v-rooms.device-session.v1:";

export class DeviceKeyUnavailable extends Error {
  constructor(cause?: unknown) {
    super("This browser cannot hold a device key.");
    this.name = "DeviceKeyUnavailable";
    this.cause = cause;
  }
}

export class SignInRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SignInRefused";
  }
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function read(db: IDBDatabase): Promise<CryptoKeyPair | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKeyPair);
    request.onerror = () => reject(request.error);
  });
}

function write(db: IDBDatabase, pair: CryptoKeyPair): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(pair, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deviceKey(): Promise<CryptoKeyPair> {
  if (typeof indexedDB === "undefined" || !crypto?.subtle)
    throw new DeviceKeyUnavailable();
  try {
    const db = await openStore();
    try {
      const existing = await read(db);
      if (existing?.privateKey && existing.publicKey) return existing;
      const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      await write(db, pair);
      return pair;
    } finally {
      db.close();
    }
  } catch (error) {
    // Private windows in some browsers refuse IndexedDB or CryptoKey storage.
    throw new DeviceKeyUnavailable(error);
  }
}

function toBase64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  } | null;
  if (!response.ok) {
    throw new SignInRefused(
      payload?.error?.code ?? `http_${response.status}`,
      payload?.error?.message ?? "Could not sign in. Try again.",
    );
  }
  return payload?.data ?? {};
}

/** Signs a fresh challenge with this browser's key and opens a session cookie. */
export async function enterWithDeviceKey(): Promise<void> {
  const pair = await deviceKey();
  const { challenge } = await postJson("/api/device/challenge");
  if (typeof challenge !== "string")
    throw new SignInRefused("bad_challenge", "Could not start sign-in.");

  const [spki, signature] = await Promise.all([
    crypto.subtle.exportKey("spki", pair.publicKey),
    crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(SIGNING_PREFIX + challenge),
    ),
  ]);

  await postJson("/api/device/session", {
    publicKey: toBase64url(spki),
    challenge,
    signature: toBase64url(signature),
  });
}
