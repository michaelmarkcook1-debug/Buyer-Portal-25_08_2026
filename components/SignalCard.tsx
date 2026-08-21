import type { WatchSignal } from "@/lib/metrics/types";
import { OPPORTUNITY_LABELS } from "@/lib/metrics/types";
import { ClassChip, CONFIDENCE_LABEL, Panel } from "./ui";

/**
 * One "What Matters Today" signal (spec §10/§26): classification, vendor,
 * headline, buyer implication, opportunity type, change, confidence.
 * The interpretation is the product; the headline is only the anchor.
 */
export function SignalCard({ s }: { s: WatchSignal }) {
  return (
    <Panel className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <ClassChip cls={s.classification} />
        <span className="eyebrow" style={{ letterSpacing: "0.14em" }}>
          {s.vendors.join(" · ")}
        </span>
        {s.change ? (
          <span className="code ml-auto text-[0.68rem]" style={{ color: "var(--fg-dim)" }}>
            {s.change}
          </span>
        ) : null}
      </div>
      <div className="display mt-2 text-[1.12rem] leading-snug" style={{ color: "var(--fg)" }}>
        {s.headline}
      </div>
      <p className="mt-1.5 mb-0 max-w-[70ch] text-[0.88rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        {s.implication}
      </p>
      <div className="code mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.66rem]" style={{ color: "var(--fg-dim)" }}>
        {s.opportunityType ? <span>Opportunity: {OPPORTUNITY_LABELS[s.opportunityType]}</span> : null}
        <span>Confidence: {CONFIDENCE_LABEL[s.confidence]}</span>
        {s.sourceUrl ? (
          <a href={s.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--rail-ink)" }}>
            Source ↗
          </a>
        ) : null}
      </div>
    </Panel>
  );
}
