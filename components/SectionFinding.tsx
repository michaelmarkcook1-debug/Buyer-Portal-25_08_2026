import type { SectionFinding as Finding } from "@/lib/metrics/section-findings";

/**
 * The finding a section opens with, above the rows that support it. Absent
 * where the rows cannot support one — a section with nothing to conclude says
 * nothing rather than filling the slot.
 */
export function SectionFinding({ f, className = "" }: { f: Finding | null; className?: string }) {
  if (!f) return null;
  return (
    <div className={`max-w-[72ch] ${className}`}>
      <p className="display m-0 text-[1.18rem] leading-snug" style={{ color: "var(--fg)" }}>
        {f.finding}
      </p>
      {f.action ? (
        <p className="mt-2 mb-0 text-[1rem] leading-relaxed" style={{ color: "var(--fg)" }}>
          <span className="font-semibold" style={{ color: "var(--accent-ink)" }}>Worth testing: </span>
          {f.action}
        </p>
      ) : null}
    </div>
  );
}
