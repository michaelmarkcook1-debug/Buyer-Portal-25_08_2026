/**
 * SESSION TOKEN — an HMAC-SHA256-signed cookie value.
 *
 * Web Crypto only, so the same code verifies in middleware and on the server.
 * The token carries the user id and an expiry; the server still loads the user
 * on every request, so a disabled account is refused even with a valid token.
 */

export const SESSION_COOKIE = "bp_session";
export const SESSION_DAYS = 30;
/** A signing secret shorter than this is treated as absent: sign-in fails closed. */
export const MIN_SECRET_LENGTH = 32;

export interface SessionPayload {
  uid: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
  v: 1;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function usableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

export async function signSession(uid: string, secret: string, now = Date.now()): Promise<string> {
  const payload: SessionPayload = { uid, exp: Math.floor(now / 1000) + SESSION_DAYS * 86_400, v: 1 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The payload if the token is authentic and unexpired; null otherwise. Never throws. */
export async function verifySession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token || !usableSecret(secret)) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const sigBytes = fromB64url(sig);
  if (!sigBytes) return null;
  /* crypto.subtle.verify compares in constant time. */
  const ok = await crypto.subtle.verify("HMAC", await key(secret), sigBytes, enc.encode(body));
  if (!ok) return null;
  const raw = fromB64url(body);
  if (!raw) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(raw)) as Partial<SessionPayload>;
    if (p.v !== 1 || typeof p.uid !== "string" || typeof p.exp !== "number") return null;
    if (p.exp * 1000 <= now) return null;
    return p as SessionPayload;
  } catch {
    return null;
  }
}
