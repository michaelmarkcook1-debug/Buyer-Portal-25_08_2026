import { NextResponse } from "next/server";
import { normaliseEmail } from "@/lib/auth/email-policy";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { authConfig, roleFor, safeNext, sessionCookieFor } from "@/lib/auth/session";
import { findUserByEmail, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/users";
import { SCOPE_COOKIE } from "@/lib/market-scope";

export const dynamic = "force-dynamic";

/* Verified against when the email is unknown, so a miss costs the same time as
   a wrong password and response timing does not reveal who has an account. */
let decoyHash: Promise<string> | null = null;

/* No email address goes into the redirect URL, where it would sit in logs
   and browser history. A locked account reads exactly like a wrong password,
   so the reply never confirms that an address has an account. */
function back(url: URL, error: string, next: string): NextResponse {
  const to = new URL("/login", url.origin);
  to.searchParams.set("error", error);
  if (next !== "/") to.searchParams.set("next", next);
  return NextResponse.redirect(to, 303);
}

/** POST /api/auth/login — email + password form target. */
export async function POST(req: Request) {
  /* A database hiccup must read as "try again", not a raw server error page. */
  try {
    return await handle(req);
  } catch {
    const url = new URL(req.url);
    return back(url, "unavailable", "/");
  }
}

async function handle(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const form = await req.formData();
  const next = safeNext(String(form.get("next") ?? "/"));
  const email = normaliseEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");

  if (!authConfig().secret) return back(url, "not-configured", next);
  if (!email || !password) return back(url, "missing", next);

  const user = await findUserByEmail(email);
  if (!user) {
    decoyHash ??= hashPassword("decoy-password-for-timing-only");
    await verifyPassword(password, await decoyHash);
    return back(url, "invalid", next);
  }
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) return back(url, "invalid", next);
  if (user.disabled) return back(url, "invalid", next);

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordLoginFailure(user.id);
    return back(url, "invalid", next);
  }

  const role = roleFor(user.email, user.role);
  await recordLoginSuccess(user.id, role);
  const res = NextResponse.redirect(new URL(next, url.origin), 303);
  const c = await sessionCookieFor({ ...user, role });
  res.cookies.set(c.name, c.value, c.options);
  /* The buyer's saved vendor selection follows them to any browser. */
  if (user.scope) {
    res.cookies.set(SCOPE_COOKIE, user.scope, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
