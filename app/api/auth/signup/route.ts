import { NextResponse } from "next/server";
import { checkBuyerEmail, normaliseEmail } from "@/lib/auth/email-policy";
import { hashPassword, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT, passwordProblem } from "@/lib/auth/password";
import { authConfig, isAdminEmail, isSignupCode, roleFor, sessionCookieFor } from "@/lib/auth/session";
import { createUser, providerDomains } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

function back(url: URL, code: string, error: string, extra: Record<string, string> = {}): NextResponse {
  const to = new URL("/join", url.origin);
  to.searchParams.set("code", code);
  to.searchParams.set("error", error);
  for (const [k, v] of Object.entries(extra)) to.searchParams.set(k, v);
  return NextResponse.redirect(to, 303);
}

/**
 * POST /api/auth/signup — the general pilot sign-up link's form target.
 *
 * The link carries a shared code (PILOT_SIGNUP_CODE) so only people it was
 * sent to can register. The email must be a work address — not a personal
 * mailbox and not a covered provider's domain — and the buyer sets their own
 * password. The form only ever creates buyers: an ADMIN_EMAILS address is
 * refused here and its account is made out of band (scripts/create-admin.ts).
 * No email address is put in a redirect URL, where it would sit in logs and
 * browser history.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  /* A database hiccup must read as "try again", not a raw server error page. */
  try {
    return await handle(url, form, code);
  } catch {
    return back(url, code, "unavailable");
  }
}

async function handle(url: URL, form: FormData, code: string): Promise<NextResponse> {
  const email = normaliseEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const cfg = authConfig();
  if (!cfg.secret || !cfg.signupCode) return back(url, code, "closed");
  if (!isSignupCode(code)) return back(url, code, "link");

  const verdict = checkBuyerEmail(email, await providerDomains());
  if (!verdict.ok) return back(url, code, verdict.reason);
  if (isAdminEmail(verdict.email)) return back(url, code, "reserved");

  const problem = passwordProblem(password, verdict.email);
  if (problem) return back(url, code, "password", { why: problem === PASSWORD_TOO_SHORT ? "short" : problem === PASSWORD_TOO_LONG ? "long" : "name" });
  if (password !== confirm) return back(url, code, "mismatch");

  const user = await createUser(verdict.email, verdict.domain, await hashPassword(password), roleFor(verdict.email));
  if (!user) return back(url, code, "exists");

  const res = NextResponse.redirect(new URL("/", url.origin), 303);
  const c = await sessionCookieFor(user);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
