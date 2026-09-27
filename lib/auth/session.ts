import "server-only";
import { timingSafeEqual } from "node:crypto";
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
  adminEmails: Set<string>;
}

export function authConfig(): AuthConfig {
  const secret = process.env.AUTH_SECRET;
  const code = process.env.PILOT_SIGNUP_CODE?.trim();
  return {
    secret: usableSecret(secret) ? secret : null,
    signupCode: code && code.length >= 12 ? code : null,
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
  const { secret } = authConfig();
  if (!secret) return null;
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value, secret);
  if (!payload) return null;
  const user = await findUserById(payload.uid);
  if (!user || user.disabled) return null;
  return user;
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
