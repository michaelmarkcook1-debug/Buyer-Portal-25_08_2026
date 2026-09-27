import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame, Field, FormError, SubmitButton } from "@/components/AuthFrame";
import { REFUSAL_MESSAGE } from "@/lib/auth/email-policy";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { authConfig, getCurrentUser, isSignupCode } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join — AnalystGenius", robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * The general sign-up link: /join?code=… — the same link for every pilot
 * buyer. Without the right code the page offers nothing to fill in, and it
 * never says whether a code was close or what the right one is.
 */
export default async function JoinPage({ searchParams }: { searchParams: SP }) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const code = one(sp.code) ?? "";
  const cfg = authConfig();
  const open = Boolean(cfg.secret && cfg.signupCode);
  const linkValid = open && isSignupCode(code);

  if (!linkValid) {
    return (
      <AuthFrame eyebrow="Join the pilot" title="This sign-up link isn't valid">
        <p className="m-0 text-body leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {open
            ? "Check you used the full link from your invitation. If it still doesn't work, ask the person who sent it for a fresh one."
            : "Sign-up isn't open on this server."}
        </p>
        <p className="mt-5 mb-0 text-label">
          <Link href="/login" className="underline underline-offset-4" style={{ color: "var(--rail-ink)" }}>
            Already registered? Sign in
          </Link>
        </p>
      </AuthFrame>
    );
  }

  const err = one(sp.error);
  const email = one(sp.email) ?? undefined;
  const message =
    err === "invalid" || err === "personal" || err === "provider"
      ? REFUSAL_MESSAGE[err]
      : err === "password"
        ? one(sp.why) ?? "Choose a stronger password."
        : err === "mismatch"
          ? "The two passwords don't match."
          : err === "exists"
            ? "An account already exists for this email. Sign in instead."
            : err === "unavailable"
              ? "Sign-up is briefly unavailable. Please try again."
              : null;

  return (
    <AuthFrame eyebrow="Join the pilot" title="Create your account">
      <p className="mt-0 mb-5 text-body leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Use your organisation's work email. Personal and service-provider addresses can't register.
      </p>
      <FormError message={message} />
      <form method="POST" action="/api/auth/signup" className="space-y-4">
        <input type="hidden" name="code" value={code} />
        <Field id="email" label="Work email" type="email" autoComplete="username" defaultValue={email} />
        <Field
          id="password"
          label="Choose a password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" />
        <SubmitButton>Create account</SubmitButton>
      </form>
      {err === "exists" ? (
        <p className="mt-5 mb-0 text-label">
          <Link href="/login" className="underline underline-offset-4" style={{ color: "var(--rail-ink)" }}>
            Sign in
          </Link>
        </p>
      ) : null}
    </AuthFrame>
  );
}
