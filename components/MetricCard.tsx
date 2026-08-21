import type { Metric } from "@/lib/metrics/types";
import { CONFIDENCE_LABEL, ModelledTag, MovementText, Panel, StateText } from "./ui";

/**
 * One canonical metric as a card: state first, direction second, the buyer
 * reading third, confidence last. Never a bare KPI tile — the conclusion
 * leads and the number stays in the basis.
 */
export function MetricCard({ m }: { m: Metric }) {
  return (
    <Panel className="flex min-w-0 flex-col gap-1.5 px-4 py-4">
      <div className="eyebrow flex items-center gap-2">
        {m.label}
        {m.modelled ? <ModelledTag note={m.modelled} /> : null}
      </div>
      <StateText state={m.state} className="text-[1.02rem]" />
      <MovementText movement={m.movement} className="text-[0.78rem]" />
      {m.headline ? (
        <p className="m-0 text-[0.8rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
          {m.headline}
        </p>
      ) : null}
      <div className="code mt-auto pt-1 text-[0.64rem]" style={{ color: "var(--fg-dim)" }}>
        Confidence: {CONFIDENCE_LABEL[m.confidence]}
      </div>
    </Panel>
  );
}

/** A row of canonical metric cards — the executive strip. */
export function IntelligenceStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map((m) => (
        <MetricCard key={m.id} m={m} />
      ))}
    </div>
  );
}
