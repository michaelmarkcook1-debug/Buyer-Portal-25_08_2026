import { EFFECT_INK } from "@/components/ui";
import { displayState } from "@/lib/metrics/dictionary";
import type { MetricState, OpportunityLevel } from "@/lib/metrics/types";

/**
 * The three approved Phase 2 visualisations.
 *
 * Server-rendered SVG only — the portal ships no client JS, so nothing here
 * measures, animates or hydrates. Every chart is handed values that the
 * canonical resolved object already computed; none of them derives a figure of
 * its own, so a bar can never disagree with the table beside it.
 *
 * Accessibility is structural rather than bolted on: each chart carries a
 * title and description in the SVG, is marked up as an image with a label,
 * and is paired by its caller with the same numbers in text — colour is never
 * the only carrier of meaning, and every value is written out somewhere.
 */

const AXIS = "var(--surface-line)";
const GRID = "var(--surface-line-soft)";

function Figure({
  title,
  desc,
  children,
  interpretation,
  footnote,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  interpretation?: string;
  footnote?: string;
}) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      {children}
      {interpretation ? (
        <figcaption className="m-0 max-w-[76ch] text-[0.98rem] leading-relaxed" style={{ color: "var(--fg)" }}>
          {interpretation}
        </figcaption>
      ) : null}
      {footnote ? (
        <div className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
          {footnote}
        </div>
      ) : null}
      <span className="sr-only">{desc}</span>
      <span className="sr-only">{title}</span>
    </figure>
  );
}

/* ══════════════ 1. End-of-term value concentration ══════════════════════
   Buyer question: where is observed commercial value concentrated?
   Disclosed and inferred value are NEVER blended into one bar — a bar is
   drawn only from disclosed value, and inferred exposure is stated in words
   beside it. Withheld value produces no bar at all.                        */

export interface ExposureBar {
  name: string;
  /** Agreements reaching end-of-term in the window. */
  count: number;
  /** DISCLOSED value only. Null where nothing is disclosed. */
  disclosedUsd: number | null;
  /** True where this vendor's value is mostly estimated, not disclosed. */
  inferred: boolean;
}

export function ExposureConcentrationChart({
  bars,
  totalCount,
  valueLabel,
  interpretation,
  footnote,
  moneyFmt,
}: {
  bars: ExposureBar[];
  totalCount: number;
  valueLabel: string;
  /** Omitted where the surrounding card already carries the interpretation. */
  interpretation?: string;
  footnote?: string;
  moneyFmt: (n: number) => string;
}) {
  const withValue = bars.filter((b) => b.disclosedUsd != null && b.disclosedUsd > 0);
  const max = withValue.length ? Math.max(...withValue.map((b) => b.disclosedUsd!)) : 0;
  const rowH = 34;
  const labelW = 148;
  const h = Math.max(1, bars.length) * rowH + 8;

  return (
    <Figure
      title="Observed commercial value reaching end-of-term, by vendor"
      desc={`Disclosed value entering the 12-month end-of-term window across ${totalCount} agreements. ${bars
        .map((b) => `${b.name}: ${b.count} agreements${b.disclosedUsd ? `, ${moneyFmt(b.disclosedUsd)} disclosed` : ", no disclosed value"}`)
        .join(". ")}.`}
      interpretation={interpretation}
      footnote={footnote}
    >
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 640 ${h}`}
          width="100%"
          height={h}
          role="img"
          aria-label="Observed commercial value reaching end-of-term, by vendor"
          style={{ minWidth: 420, display: "block" }}
        >
          <line x1={labelW} y1={2} x2={labelW} y2={h - 6} stroke={AXIS} strokeWidth="1" />
          {bars.map((b, i) => {
            const y = i * rowH + 4;
            const w = max > 0 && b.disclosedUsd ? Math.max(2, (b.disclosedUsd / max) * (620 - labelW - 96)) : 0;
            return (
              <g key={b.name}>
                <text
                  x={labelW - 10}
                  y={y + rowH / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="14"
                  fill="var(--fg)"
                >
                  {b.name.length > 18 ? `${b.name.slice(0, 17)}…` : b.name}
                </text>
                {w > 0 ? (
                  <rect
                    x={labelW + 1}
                    y={y + 7}
                    width={w}
                    height={rowH - 18}
                    rx="1.5"
                    fill="var(--accent-fill)"
                    fillOpacity={b.inferred ? 0.34 : 0.82}
                    stroke={b.inferred ? "var(--accent-fill)" : "none"}
                    strokeWidth={b.inferred ? 1 : 0}
                    strokeDasharray={b.inferred ? "3 2" : undefined}
                  />
                ) : null}
                <text
                  x={labelW + 9 + w}
                  y={y + rowH / 2}
                  dominantBaseline="middle"
                  fontSize="13.5"
                  fill="var(--fg-muted)"
                >
                  {b.disclosedUsd ? moneyFmt(b.disclosedUsd) : "no disclosed value"}
                  {` · ${b.count}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
        {valueLabel}
      </div>
    </Figure>
  );
}

/* ══════════════ 2. Commercial signings — current vs prior ═══════════════
   Buyer question: which vendors are gaining or losing commercial momentum?
   A dot plot with a connecting rule per vendor. Direction is deliberately
   NOT coloured green-up / red-down: a provider winning more work reduces the
   buyer's room, so the visual stays neutral and the buyer reading is written
   underneath in words.                                                      */

export interface SigningsRow {
  name: string;
  prior: number;
  current: number;
}

export function SigningsSlopeChart({
  rows,
  windowLabel,
  interpretation,
  footnote,
}: {
  rows: SigningsRow[];
  windowLabel: string;
  interpretation?: string;
  footnote?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.prior, r.current]));
  const rowH = 36;
  const labelW = 148;
  const trackW = 620 - labelW - 108;
  const h = Math.max(1, rows.length) * rowH + 26;
  const x = (v: number) => labelW + 12 + (v / max) * trackW;

  return (
    <Figure
      title="Commercial signings, current window against prior"
      desc={`${windowLabel}. ${rows
        .map((r) => `${r.name}: ${r.prior} prior to ${r.current} current`)
        .join(". ")}.`}
      interpretation={interpretation}
      footnote={footnote}
    >
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 640 ${h}`}
          width="100%"
          height={h}
          role="img"
          aria-label="Commercial signings, current window against prior, by vendor"
          style={{ minWidth: 420, display: "block" }}
        >
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1={x(max * t)} y1={18} x2={x(max * t)} y2={h - 8} stroke={GRID} strokeWidth="1" />
          ))}
          <text x={x(0)} y={11} fontSize="12.5" fill="var(--fg-dim)" textAnchor="middle">0</text>
          <text x={x(max)} y={11} fontSize="12.5" fill="var(--fg-dim)" textAnchor="middle">{max}</text>
          {rows.map((r, i) => {
            const y = i * rowH + 30;
            const a = x(r.prior);
            const b = x(r.current);
            return (
              <g key={r.name}>
                <text x={labelW - 10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="14" fill="var(--fg)">
                  {r.name.length > 18 ? `${r.name.slice(0, 17)}…` : r.name}
                </text>
                <line x1={a} y1={y} x2={b} y2={y} stroke="var(--fg-dim)" strokeWidth="1.5" opacity="0.55" />
                {/* prior: hollow. current: solid. Shape carries direction, not hue. */}
                <circle cx={a} cy={y} r="4.5" fill="var(--bg-elev-1)" stroke="var(--fg-dim)" strokeWidth="1.5" />
                <circle cx={b} cy={y} r="5" fill="var(--fg)" />
                <text x={620 - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="13.5" fill="var(--fg-muted)">
                  {r.prior} → {r.current}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
        Hollow marker = prior window · solid marker = current window · {windowLabel}
      </div>
    </Figure>
  );
}

/* ══════════════ 3. Whole-market distribution ════════════════════════════
   Buyer question: what shape is the market across every covered vendor?
   Replaces hundreds of individual chips with the distribution they add up
   to. Segments reuse the SAME semantic inks the chips use, and each band is
   written out in text beneath so the colour is never doing the work alone. */

export interface DistributionBand {
  /** Canonical label from the metric dictionary — never invented here. */
  label: string;
  count: number;
  ink: string;
}

export function DistributionChart({
  rows,
  total,
  interpretation,
  footnote,
}: {
  rows: { dimension: string; bands: DistributionBand[] }[];
  total: number;
  interpretation?: string;
  footnote?: string;
}) {
  return (
    <Figure
      title="Distribution of readings across the covered market"
      desc={rows
        .map((r) => `${r.dimension}: ${r.bands.map((b) => `${b.label} ${b.count}`).join(", ")}`)
        .join(". ")}
      interpretation={interpretation}
      footnote={footnote}
    >
      <div className="flex flex-col gap-4">
        {rows.map((r) => {
          const sum = r.bands.reduce((a, b) => a + b.count, 0) || 1;
          return (
            <div key={r.dimension} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-[0.98rem] font-medium" style={{ color: "var(--fg)" }}>
                  {r.dimension}
                </span>
                <span className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
                  {total} vendors
                </span>
              </div>
              <div
                className="flex h-[18px] w-full overflow-hidden rounded-[2px]"
                role="img"
                aria-label={`${r.dimension}: ${r.bands.map((b) => `${b.label} ${b.count}`).join(", ")}`}
              >
                {r.bands
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <div
                      key={b.label}
                      style={{ width: `${(b.count / sum) * 100}%`, background: b.ink, opacity: 0.85 }}
                      title={`${b.label}: ${b.count}`}
                    />
                  ))}
              </div>
              {/* the same numbers in text — colour is never the sole carrier */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.92rem]" style={{ color: "var(--fg-muted)" }}>
                {r.bands
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <span key={b.label} className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="inline-block h-[9px] w-[9px] rounded-[1px]"
                        style={{ background: b.ink, opacity: 0.85 }}
                      />
                      {b.label} <span className="tabular" style={{ color: "var(--fg)" }}>{b.count}</span>
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}

/* ══════════════ 4. Observed deal flow — prior window against current ════
   Buyer question: how much new work is actually entering this market?

   Paired bars, one pair per series. Each series keeps its OWN scale and its
   OWN window: public procurement runs on 90 days and commercial signings on
   12 months, from separate evidence families. Putting them on one axis would
   assert a comparison the record does not support.

   Deliberately NEUTRAL — no green-up / red-down. Fewer awards is neither a
   loss nor a win; it is softer demand, and what that means for a buyer is
   written underneath in words rather than encoded in a hue. WEIGHT, not
   colour, separates the two windows, and every value is printed beside its
   own bar so the graphic is never the only carrier.                        */

export interface FlowSeries {
  /** Canonical name of the series — never abbreviated into a new term. */
  label: string;
  /** Count observed in the prior comparison window. */
  prior: number;
  /** Count observed in the current window. */
  current: number;
  /** Window labels, written out so the reader never has to infer them. */
  priorWindow: string;
  currentWindow: string;
  /** Evidence anchor the comparison is taken to. Null where none is held. */
  asOf: string | null;
  /** Plural noun for the counted thing, e.g. "awards" / "signings". */
  unit: string;
}

export function FlowComparisonChart({
  series,
  interpretation,
  footnote,
}: {
  series: FlowSeries[];
  /** Omitted where the surrounding unit already carries the interpretation. */
  interpretation?: string;
  footnote?: string;
}) {
  const describe = (s: FlowSeries) =>
    `${s.label}: ${s.prior} ${s.unit} in the ${s.priorWindow.toLowerCase()}, ` +
    `${s.current} in the ${s.currentWindow.toLowerCase()}${s.asOf ? `, to ${s.asOf}` : ""}`;

  return (
    <Figure
      title="Observed deal flow, current window against prior"
      desc={`${series.map(describe).join(". ")}.`}
      interpretation={interpretation}
      footnote={footnote}
    >
      <div className="flex flex-col gap-6">
        {series.map((s) => {
          /* Scale is PER SERIES: the two windows of one measure share an axis;
             two different measures never do. */
          const max = Math.max(1, s.prior, s.current);
          const rows = [
            { window: s.priorWindow, value: s.prior, weight: 0.3 },
            { window: s.currentWindow, value: s.current, weight: 0.85 },
          ];
          return (
            <div key={s.label} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[0.98rem] font-medium" style={{ color: "var(--fg)" }}>
                  {s.label}
                </span>
                {s.asOf ? (
                  <span className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
                    to {s.asOf}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5" role="img" aria-label={describe(s)}>
                {rows.map((r) => (
                  <div key={r.window} className="flex items-center gap-2 sm:gap-3">
                    <span
                      className="w-[6.6rem] shrink-0 text-[0.92rem] leading-tight sm:w-[8.5rem]"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {r.window}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        aria-hidden="true"
                        className="block h-[14px] rounded-[2px]"
                        style={{
                          width: `${Math.max(1.5, (r.value / max) * 100)}%`,
                          background: "var(--fg-muted)",
                          opacity: r.weight,
                        }}
                      />
                    </span>
                    <span
                      className="tabular w-[3.2rem] shrink-0 text-right text-[0.97rem] font-medium"
                      style={{ color: "var(--fg)" }}
                    >
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
        Lighter bar = prior window · solid bar = current window · each measure is scaled against
        itself, never against the other
      </div>
    </Figure>
  );
}

/** Semantic ink for an opportunity level, reusing the locked mapping. */
export function levelInk(level: OpportunityLevel): string {
  if (level === "insufficient") return "var(--fg-dim)";
  if (level === "very-high" || level === "high") return "var(--data-positive-ink)";
  return "var(--fg-muted)";
}

/** Semantic ink for a metric state, via the dictionary's buyer effect. */
export function stateInk(metricId: string, state: MetricState): string {
  return EFFECT_INK[displayState(metricId, state).effect];
}
