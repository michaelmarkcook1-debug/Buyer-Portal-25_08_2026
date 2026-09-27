import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/token";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — ends the session. The saved vendor selection stays on the account. */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login?signedOut=1", new URL(req.url).origin), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
