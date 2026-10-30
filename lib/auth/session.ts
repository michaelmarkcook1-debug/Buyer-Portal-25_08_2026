import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, signSession, usableSecret, verifySession } from "./token";
import { findUserById, type PortalUser, type Role } from "./users";

/**
 * Who is signed in. Fails closed: with no usable AUTH_SECRET nobody is signed
 * in, and every page sends the visitor to /login, which says sign-in is not
 * configured rather than letting anyone through.
 */

export interface AuthConfig {
  secret: string | null;
  /** The code carried by the general sign-up link. Unset means sign-up is closed. */
  signupCode: string | null;
  /** The code carried by the guest link. Unset means guest access is off. */
  guestCode: string | null;
  adminEmails: Set<string>;
}

export function authConfig(): AuthConfig {
  const secret = process.env.AUTH_SECRET;
  const code = process.env.PILOT_SIGNUP_CODE?.trim();
  const guest = process.env.GUEST_ACCESS_CODE?.trim();
  return {
    secret: usableSecret(secret) ? secret : null,
    signupCode: code && code.length >= 12 ? code : null,
    guestCode: guest && guest.length >= 12 ? guest : null,
    adminEmails: new Set(
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function roleFor(email: string): Role {
  return authConfig().adminEmails.has(email) ? "admin" : "buyer";
}

export async function getCurrentUser(): Promise<PortalUser | null> {
  const signedIn = await sessionUser();
  if (signedIn) return signedIn;
  /* Public access: anyone without a session reads the portal as a guest.
     Admin-only surfaces still refuse them, because a guest is never admin. */
  return publicAccess() ? publicGuest() : null;
}

async function sessionUser(): Promise<PortalUser | null> {
  const { secret } = authConfig();
  if (!secret) return null;
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value, secret);
  if (!payload) return null;
  if (payload.uid.startsWith(GUEST_PREFIX)) return guestFromUid(payload.uid);
  const user = await findUserById(payload.uid);
  if (!user || user.disabled) return null;
  return user;
}

/* ── Public access ────────────────────────────────────────────────────────
   PUBLIC_ACCESS=on turns sign-in off for the buyer pages (owner's call,
   30 Oct 2026: "I don't want any logins right now"). Everyone reads as a
   guest. Accounts, the sign-up link and the admin Backoffice are untouched:
   the Backoffice and its refresh endpoint still need a signed-in admin.
   Remove the setting and redeploy to require sign-in again. */
export function publicAccess(): boolean {
  return process.env.PUBLIC_ACCESS === "on";
}

function publicGuest(): PortalUser {
  return {
    id: "public",
    email: "guest",
    role: "guest",
    passwordHash: "",
    scope: null,
    disabled: false,
    failedLogins: 0,
    lockedUntil: null,
  };
}

/** For pages: the signed-in user, or a redirect to sign in. */
export async function requireUser(next = "/"): Promise<PortalUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** For operator pages: an admin, or a redirect. Buyers never see the Backoffice. */
export async function requireAdmin(): Promise<PortalUser> {
  const user = await requireUser("/backoffice");
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function sessionCookieFor(user: PortalUser): Promise<{
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number };
}> {
  const { secret } = authConfig();
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  return {
    name: SESSION_COOKIE,
    value: await signSession(user.id, secret),
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    },
  };
}

/** Same-origin relative paths only — never an open redirect. */
export function safeNext(raw: string | null | undefined): string {
  const n = raw ?? "/";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

/** Does this code open sign-up? Constant-time, and false whenever sign-up is closed. */
export function isSignupCode(code: string | null | undefined): boolean {
  const expected = authConfig().signupCode;
  if (!expected || !code) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── Guest link ───────────────────────────────────────────────────────────
   A view-only way in that skips sign-in: /guest?code=<GUEST_ACCESS_CODE>.
   There is no account behind it. The guest's session id carries a short
   fingerprint of the code it was issued under, so changing or removing
   GUEST_ACCESS_CODE ends every guest session at once — no list to revoke.
   Guests read every buyer page; they never reach the Backoffice, and their
   vendor selection stays in their own browser. */

const GUEST_PREFIX = "guest:";
/** Guest sessions are shorter than buyer sessions. */
export const GUEST_SESSION_DAYS = 7;

function guestFingerprint(code: string): string {
  return createHash("sha256").update(`guest-link:${code}`).digest("hex").slice(0, 16);
}

export function guestSessionId(): string | null {
  const code = authConfig().guestCode;
  return code ? GUEST_PREFIX + guestFingerprint(code) : null;
}

/** A guest session is valid only while it matches the guest code now configured. */
function guestFromUid(uid: string): PortalUser | null {
  const current = guestSessionId();
  if (!current || uid !== current) return null;
  return {
    id: uid,
    email: "guest",
    role: "guest",
    passwordHash: "",
    scope: null,
    disabled: false,
    failedLogins: 0,
    lockedUntil: null,
  };
}

/** Does this code open the guest link? Constant-time, and false whenever guest access is off. */
export function isGuestCode(code: string | null | undefined): boolean {
  const expected = authConfig().guestCode;
  if (!expected || !code) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
