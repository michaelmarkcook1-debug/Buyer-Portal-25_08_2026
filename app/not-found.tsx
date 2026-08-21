import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          Not found
        </div>
        <h1 className="display mt-3 text-[1.8rem]" style={{ color: "var(--fg)" }}>
          This page is not part of the portal.
        </h1>
        <p className="mt-3" style={{ color: "var(--fg-muted)" }}>
          <Link href="/" style={{ color: "var(--rail-ink)" }}>
            Return to your briefing
          </Link>
        </p>
      </div>
    </div>
  );
}
