"use client";

/**
 * The calm state for a page that could not be assembled — usually a brief
 * database interruption. Without it one failed query showed the platform's
 * bare 500 page (the 26 Oct 2026 outage). Nothing is estimated in its place.
 */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-5 py-16 sm:px-8">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        AnalystGenius · Buyer Portal
      </div>
      <h1 className="display mt-3 text-section" style={{ color: "var(--fg)" }}>
        This page could not be assembled just now.
      </h1>
      <p className="mt-3 max-w-[56ch] text-body leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Part of the evidence it reads did not arrive. The portal shows nothing rather than a partial or
        estimated picture. This is usually brief.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="tap cursor-pointer rounded-md px-5 py-2 text-body font-semibold"
          style={{ background: "var(--accent-fill)", color: "#07142a", border: "none" }}
        >
          Try again
        </button>
        <a href="/" className="tap text-body" style={{ color: "var(--rail-ink)" }}>
          Go to Home
        </a>
      </div>
    </main>
  );
}
