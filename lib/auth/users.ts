import "server-only";
import { randomUUID } from "node:crypto";
import { q } from "@/lib/db";

/**
 * Pilot users — a portal-owned table in the Neon spine (the approved
 * read/write environment), beside portal_refresh_run. It holds identity, a
 * password hash and the buyer's saved vendor selection. Nothing canonical is
 * written here, and no buyer-owned commercial data is held: the saved scope is
 * a list of market vendors, exactly what the scope cookie already carries.
 */

/** "guest" is a view-only visitor (the guest link, or anyone while PUBLIC_ACCESS=on); never stored. */
export type Role = "buyer" | "admin" | "guest";

export interface PortalUser {
  id: string;
  email: string;
  role: Role;
  passwordHash: string;
  scope: string | null;
  disabled: boolean;
  failedLogins: number;
  lockedUntil: string | null;
}

/** Consecutive failed sign-ins before an account is locked, and for how long. */
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;

let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS portal_user (
      id             text PRIMARY KEY,
      email          text NOT NULL UNIQUE,
      email_domain   text NOT NULL,
      role           text NOT NULL DEFAULT 'buyer',
      password_hash  text NOT NULL,
      scope          text,
      disabled       boolean NOT NULL DEFAULT false,
      failed_logins  integer NOT NULL DEFAULT 0,
      locked_until   timestamptz,
      created_at     timestamptz NOT NULL DEFAULT now(),
      last_login_at  timestamptz
    )
  `);
  ensured = true;
}

function toUser(r: Record<string, unknown>): PortalUser {
  return {
    id: String(r.id),
    email: String(r.email),
    role: r.role === "admin" ? "admin" : "buyer",
    passwordHash: String(r.password_hash),
    scope: r.scope == null ? null : String(r.scope),
    disabled: r.disabled === true,
    failedLogins: Number(r.failed_logins ?? 0),
    lockedUntil: r.locked_until == null ? null : new Date(String(r.locked_until)).toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<PortalUser | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(`SELECT * FROM portal_user WHERE email = $1`, [email]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<PortalUser | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(`SELECT * FROM portal_user WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Creates the account, or returns null when the email is already registered. */
export async function createUser(email: string, domain: string, passwordHash: string, role: Role): Promise<PortalUser | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(
    `INSERT INTO portal_user (id, email, email_domain, role, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING
     RETURNING *`,
    [randomUUID(), email, domain, role, passwordHash],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function recordLoginSuccess(id: string, role: Role): Promise<void> {
  /* Role follows the admin list on every sign-in, so removing someone from
     ADMIN_EMAILS takes effect at their next sign-in. */
  await q(
    `UPDATE portal_user SET failed_logins = 0, locked_until = NULL, last_login_at = now(), role = $2 WHERE id = $1`,
    [id, role],
  );
}

/** An expired lock starts a fresh count, so one typo after it does not relock the account. */
export async function recordLoginFailure(id: string): Promise<void> {
  await q(
    `UPDATE portal_user
        SET failed_logins = CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1 ELSE failed_logins + 1 END,
            locked_until = CASE
              WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL
              WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
              ELSE locked_until END
      WHERE id = $1`,
    [id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
  );
}

export async function saveUserScope(id: string, scope: string): Promise<void> {
  await q(`UPDATE portal_user SET scope = $2 WHERE id = $1`, [id, scope]);
}

/** Every covered provider's website domain, from the latest AG catalog snapshot. */
export async function providerDomains(): Promise<string[]> {
  const rows = await q<{ domain: string }>(
    `SELECT DISTINCT ON (ticker) domain
       FROM stg_analystgenius_provider
      WHERE domain IS NOT NULL AND domain <> ''
      ORDER BY ticker, ingested_at DESC`,
  );
  return rows.map((r) => r.domain);
}
