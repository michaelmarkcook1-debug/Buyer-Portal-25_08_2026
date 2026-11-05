import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/**
 * Password hashing — scrypt with a per-user random salt. Stored as
 * "scrypt$N$r$p$salt$hash" so the parameters can be raised later without
 * invalidating existing passwords.
 */

export const MIN_PASSWORD_LENGTH = 12;
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const PASSWORD_TOO_SHORT = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
export const PASSWORD_TOO_LONG = "That password is too long.";
export const PASSWORD_HAS_NAME = "Choose a password that doesn't contain your email name.";

/** Why a proposed password is refused, or null if it is acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT;
  if (password.length > 256) return PASSWORD_TOO_LONG;
  const name = email.split("@")[0]!.toLowerCase();
  if (name.length >= 4 && password.toLowerCase().includes(name)) {
    return PASSWORD_HAS_NAME;
  }
  return null;
}
