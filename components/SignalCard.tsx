import type { WatchSignal } from "@/lib/metrics/types";
import { OPPORTUNITY_LABELS } from "@/lib/metrics/types";
import { ClassChip, Panel } from "./ui";

/**
 * One "What Matters Today" signal (spec §10/§26), in the product's order:
 * judgement → why it matters → what to test → the evidence it rests on.
 *
 * The event headline used to lead in display type with the meaning beneath
 * it, so the reader met the raw development first and had to assemble the
 * conclusion themselves. The event is now the evidence line at the foot —
 * still dated and citable, no longer the finding.
 */
export function SignalCard({ s }: { s: WatchSignal }) {
  return (
    <Panel className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <ClassChip cls={s.classification} />
        <span className="eyebrow" style={{ letterSpacing: "0.14em" }}>
          {s.vendors.join(" · ")}
        </span>
        {s.opportunityType ? (
          <span className="code ml-auto text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
            {OPPORTUNITY_LABELS[s.opportunityType]}
          </span>
        ) : null}
      </div>
      <div className="display mt-2 text-[1.2rem] leading-snug" style={{ color: "var(--fg)" }}>
        {s.judgement}
      </div>
      <p className="mt-1.5 mb-0 max-w-[70ch] text-[1rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        {s.implication}
      </p>
      <p className="mt-2.5 mb-0 max-w-[70ch] text-[1rem] leading-relaxed" style={{ color: "var(--fg)" }}>
        <span className="font-semibold" style={{ color: "var(--accent-ink)" }}>Worth testing: </span>
        {s.action}
      </p>
      <SignalEvidence s={s} className="mt-3" />
    </Panel>
  );
}

/** The development itself, its date and its source — supporting evidence. */
export function SignalEvidence({ s, className = "" }: { s: WatchSignal; className?: string }) {
  return (
    <div
      className={`code flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.87rem] ${className}`}
      style={{ color: "var(--fg-dim)", borderTop: "1px solid var(--surface-line-soft)", paddingTop: "0.6rem" }}
    >
      <span>
        Evidence: {s.headline}
        {s.change ? ` · ${s.change}` : ""}
      </span>
      {s.confidence === "low" || s.confidence === "insufficient" ? <span>Directional — evidence is thin</span> : null}
      {s.sourceUrl ? (
        <a href={s.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--rail-ink)" }}>
          Source ↗
        </a>
      ) : null}
    </div>
  );
}
