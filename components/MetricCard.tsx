import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { METRIC_DICTIONARY, canonicalMetricId } from "@/lib/metrics/dictionary";
import type { Metric } from "@/lib/metrics/types";
import { CONFIDENCE_LABEL, ModelledTag, MovementText, Panel, StateText } from "./ui";

/**
 * One canonical metric as a card: state first, direction second, the buyer
 * reading third, confidence last. Never a bare KPI tile — the conclusion
 * leads and the number stays in the basis.
 *
 * `hideInfo` is for grids where every card shows the SAME variable across
 * different subjects — there the explanation belongs once on the section
 * heading, not repeated on every card.
 */
export function MetricCard({ m, hideInfo = false }: { m: Metric; hideInfo?: boolean }) {
  return (
    <Panel className="flex min-w-0 flex-col gap-1.5 px-4 py-4">
      <div className="eyebrow flex items-center gap-2">
        {m.label}
        {!hideInfo && METRIC_DICTIONARY[canonicalMetricId(m.id)] ? (
          <InfoTip content={fromSemantics(METRIC_DICTIONARY[canonicalMetricId(m.id)]!)} />
        ) : null}
        {m.modelled ? <ModelledTag note={m.modelled} /> : null}
      </div>
      <StateText state={m.state} metricId={m.id} className="text-[1.02rem]" />
      <MovementText movement={m.movement} className="text-[0.78rem]" />
      {m.analysis ? (
        /* The analytical body replaces the templated headline: with a driver
           present, the headline only restated the state. */
        <div className="mt-1.5 flex flex-col gap-2">
          <p className="m-0 text-[0.8rem] leading-snug" style={{ color: "var(--fg)" }}>
            {m.analysis.driver}
          </p>
          <p className="m-0 text-[0.78rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--fg-dim)" }}>For the buyer: </span>
            {m.analysis.implication}
          </p>
          {m.analysis.limitation ? (
            <p className="m-0 text-[0.76rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
              <span style={{ color: "var(--fg-dim)" }}>Limitation: </span>
              {m.analysis.limitation}
            </p>
          ) : null}
          {m.analysis.test ? (
            <p
              className="m-0 rounded-[var(--radius-sm)] px-2.5 py-2 text-[0.76rem] leading-snug"
              style={{ background: "var(--bg-elev-2)", color: "var(--fg-muted)" }}
            >
              <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
                Worth testing
              </span>{" "}
              {m.analysis.test}
            </p>
          ) : null}
          <div className="code text-[0.68rem] leading-snug" style={{ color: "var(--fg-dim)" }}>
            {m.analysis.evidence}
            {m.analysis.distribution ? ` · ${m.analysis.distribution}` : ""}
          </div>
        </div>
      ) : m.headline ? (
        <p className="m-0 text-[0.8rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
          {m.headline}
        </p>
      ) : null}
      {m.confidence === "low" || m.confidence === "insufficient" ? (
        <div className="code mt-auto pt-1 text-[0.7rem]" style={{ color: "var(--fg-muted)" }}>
          {m.confidence === "insufficient" ? "Insufficient evidence" : "Directional — evidence is thin"}
        </div>
      ) : null}
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


/**
 * The executive strip as ONE editorial band (sprint: design review §5/§12) —
 * a single panel with hairline-divided readings instead of five KPI tiles.
 * Confidence steps down to a shared footnote; the states carry the row.
 *
 * Each reading carries ONE line on why it reads that way. The full analytical
 * body — implication, limitation, what to test — belongs to the Market page
 * cards, so the band stays scannable.
 */
/**
 * The lead sentence of a driver. The band carries the finding; the second
 * sentence (usually the contrasting series or the counter-trend vendors)
 * belongs to the fuller card on the Market page. Splits only on a full stop
 * that starts a new sentence, so "$7.1bn" and "19 May" stay intact.
 */
function leadSentence(text: string): string {
  const m = /^(.*?[.?!])\s+[A-Z]/.exec(text);
  return m ? m[1]! : text;
}

export function MarketStateBand({ metrics }: { metrics: Metric[] }) {
  return (
    <Panel className="px-0 py-0">
      <div className="grid grid-cols-2 lg:grid-cols-5">
        {metrics.map((m, i) => (
          <div
            key={m.id}
            className="flex min-w-0 flex-col gap-1 px-5 py-4"
            style={i > 0 ? { borderLeft: "1px solid var(--surface-line-soft)" } : undefined}
          >
            <div className="eyebrow flex items-center gap-2">
              {m.label}
              {METRIC_DICTIONARY[canonicalMetricId(m.id)] ? (
                <InfoTip content={fromSemantics(METRIC_DICTIONARY[canonicalMetricId(m.id)]!)} />
              ) : null}
              {m.modelled ? <ModelledTag note={m.modelled} /> : null}
            </div>
            <StateText state={m.state} metricId={m.id} className="text-[1.05rem]" />
            <MovementText movement={m.movement} className="text-[0.76rem]" />
            {/* The band is a summary: one line on WHY, never the full body.
                The Market page carries driver, implication, limitation and
                the investigation prompt for the same dimensions. */}
            {m.analysis ? (
              <p className="m-0 mt-1 text-[0.76rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
                {leadSentence(m.analysis.driver)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {/* §18: confidence governs what may be said and how strongly — it is not
          a dashboard. A run of five values "in reading order" made the reader
          map labels back onto tiles for no decision benefit. Name only the
          readings that are thin, because those change how the row should be
          read; say nothing when they all hold up. */}
      {(() => {
        const thin = metrics.filter((m) => m.confidence === "low" || m.confidence === "insufficient");
        if (thin.length === 0) return null;
        return (
          <div
            className="code px-5 py-2 text-[0.68rem]"
            style={{ color: "var(--fg-dim)", borderTop: "1px solid var(--surface-line-soft)" }}
          >
            {thin.length === metrics.length
              ? "Directional across all readings — evidence is thin; treat as a reason to investigate."
              : `Thinner evidence behind ${thin.map((m) => m.label.toLowerCase()).join(" and ")} — directional, not conclusive.`}
          </div>
        );
      })()}
    </Panel>
  );
}