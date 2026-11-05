import { NextResponse } from "next/server";
import { SCOPE_COOKIE } from "@/lib/market-scope";
import { SESSION_COOKIE } from "@/lib/auth/token";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — ends the session. The saved vendor selection stays
 * on the account and returns at the next sign-in; the browser copy is cleared
 * so the next person at this machine does not inherit it. A cross-site POST
 * (an Origin that is not this site) is refused.
 */
export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const from = req.headers.get("origin");
  if (from && from !== origin) return new NextResponse("Forbidden", { status: 403 });
  const res = NextResponse.redirect(new URL("/login?signedOut=1", origin), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(SCOPE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
