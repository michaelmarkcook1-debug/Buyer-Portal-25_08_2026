import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame, Field, FormError, SubmitButton } from "@/components/AuthFrame";
import { authConfig, getCurrentUser, safeNext } from "@/lib/auth/session";
import { LOCK_MINUTES } from "@/lib/auth/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — AnalystGenius", robots: { index: false, follow: false } };

const MESSAGES: Record<string, string> = {
  missing: "Enter your email and password.",
  invalid: "That email and password don't match an account.",
  locked: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`,
  "not-configured": "Sign-in isn't configured on this server yet.",
  unavailable: "Sign-in is briefly unavailable. Please try again.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(one(sp.next));
  if (await getCurrentUser()) redirect(next);

  const configured = Boolean(authConfig().secret);
  const error = configured ? MESSAGES[one(sp.error) ?? ""] ?? null : MESSAGES["not-configured"]!;
  const signedOut = one(sp.signedOut) === "1";

  return (
    <AuthFrame eyebrow="Sign in" title="Welcome back">
      {signedOut && !error ? (
        <p className="mb-4 mt-0 text-label" style={{ color: "var(--fg-muted)" }}>You're signed out.</p>
      ) : null}
      <FormError message={error} />
      <form method="POST" action="/api/auth/login" className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field id="email" label="Work email" type="email" autoComplete="username" defaultValue={one(sp.email) ?? undefined} />
        <Field id="password" label="Password" type="password" autoComplete="current-password" />
        <SubmitButton>Sign in</SubmitButton>
      </form>
      <p className="mt-5 mb-0 text-label" style={{ color: "var(--fg-dim)" }}>
        New here? Use the sign-up link you were sent.
      </p>
    </AuthFrame>
  );
}
