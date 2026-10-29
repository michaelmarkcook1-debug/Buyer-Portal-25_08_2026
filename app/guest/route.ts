import { NextResponse } from "next/server";
import { authConfig, GUEST_SESSION_DAYS, guestSessionId, isGuestCode, safeNext } from "@/lib/auth/session";
import { SESSION_COOKIE, signSession } from "@/lib/auth/token";

export const dynamic = "force-dynamic";

/**
 * GET /guest?code=… — the guest link. Skips sign-in for anyone holding the
 * current GUEST_ACCESS_CODE and drops them on the portal as a view-only guest.
 * A wrong or missing code goes to the normal sign-in page and says nothing
 * about why.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const { secret } = authConfig();
  const uid = guestSessionId();
  if (!secret || !uid || !isGuestCode(url.searchParams.get("code"))) {
    return NextResponse.redirect(new URL("/login", url.origin), 303);
  }
  const res = NextResponse.redirect(new URL(next, url.origin), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(uid, secret, Date.now(), GUEST_SESSION_DAYS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_DAYS * 86_400,
  });
  return res;
}
