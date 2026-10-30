import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

/**
 * Every page and API route requires a signed-in session, except sign-in,
 * sign-up and static assets. This is the cheap check — an authentic,
 * unexpired token. The authoritative one runs on the server for each page,
 * which also refuses a disabled account and gates the Backoffice to admins.
 * With no AUTH_SECRET configured nothing verifies, so everything is closed.
 */
export async function middleware(req: NextRequest) {
  /* Public access is on: let every request through. Route handlers and pages
     still enforce their own rules, so the admin Backoffice stays locked. */
  if (process.env.PUBLIC_ACCESS === "on") return NextResponse.next();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET);
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const to = req.nextUrl.clone();
  to.pathname = "/login";
  to.search = "";
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") to.searchParams.set("next", next);
  return NextResponse.redirect(to);
}

export const config = {
  matcher: [
    /* Everything except: sign-in and sign-up pages, their API, Next's own
       assets, the guest link (which checks its own code), brand images and
       icons. */
    "/((?!login|join|api/auth|_next/static|_next/image|guest|brand|favicon.ico|icon|apple-icon|robots.txt).*)",
  ],
};
