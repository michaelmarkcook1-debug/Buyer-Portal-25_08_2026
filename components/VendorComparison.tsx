import Link from "next/link";
import type { VendorIntel } from "@/lib/metrics/types";
import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { METRIC_DICTIONARY } from "@/lib/metrics/dictionary";
import { LevelText, ModelledTag, Panel, StateText } from "./ui";

/**
 * The ranked vendor comparison — greatest buyer opportunity first (spec §12).
 * A table at desktop widths; rows become stacked cards below 768px rather
 * than forcing the table onto a phone (spec §27).
 */

type Variant = "opportunity" | "position";

/* Each column names the metric it displays so the header can carry ONE info
   affordance and the cells inherit that variable's vocabulary. The opportunity
   columns use magnitude (Very High…Low); leverage, momentum and risk use their
   own scales, which is deliberate rather than inconsistent — the header
   explains why. */
const COLUMNS: Record<Variant, Array<{ key: string; label: string; metricId?: string }>> = {
  opportunity: [
    { key: "overall", label: "Overall opportunity", metricId: "commercialOpportunity" },
    { key: "pricing", label: "Pricing opportunity", metricId: "pricingOpportunity" },
    { key: "automation", label: "Automation opportunity", metricId: "automationOpportunity" },
    { key: "gain-sharing", label: "Gain-sharing opportunity", metricId: "gainShareOpportunity" },
    { key: "leverage", label: "Buyer leverage", metricId: "buyerLeverage" },
  ],
  position: [
    { key: "overall", label: "Commercial opportunity", metricId: "commercialOpportunity" },
    { key: "leverage", label: "Buyer leverage", metricId: "buyerLeverage" },
    { key: "pricingState", label: "Pricing conditions", metricId: "pricingPressure" },
    { key: "ai", label: "AI productivity", metricId: "aiProductivityOpportunity" },
    { key: "momentum", label: "Provider momentum", metricId: "providerMomentum" },
    { key: "risk", label: "Operational risk", metricId: "operationalRisk" },
  ],
};

function Cell({ v, col }: { v: VendorIntel; col: string }) {
  switch (col) {
    case "overall":
      return (
        <span className="inline-flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5">
            <LevelText level={v.overall.level} />
            {/* Restrained qualifier, not a confidence index: the level stands,
                but the comparative position rests on thinner evidence. */}
            {v.overall.evidenceQualifier === "directional" ? (
              <span className="eyebrow" style={{ color: "var(--fg-dim)", letterSpacing: "0.12em" }}>
                Evidence limited
              </span>
            ) : null}
            {v.overall.modelled ? <ModelledTag note={v.overall.modelled} /> : null}
          </span>
          {v.overall.reason ? (
            <span className="max-w-[38ch] text-[0.82rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
              {v.overall.reason}
            </span>
          ) : null}
        </span>
      );
    case "pricing":
      return <LevelText level={v.opportunities.pricing.level} />;
    case "automation":
      return <LevelText level={v.opportunities.automation.level} />;
    case "gain-sharing":
      return <LevelText level={v.opportunities["gain-sharing"].level} />;
    case "leverage":
      return <StateText state={v.metrics.buyerLeverage.state} metricId="buyerLeverage" />;
    case "pricingState":
      return <StateText state={v.metrics.pricingPressure.state} metricId="pricingPressure" />;
    case "ai":
      return <StateText state={v.metrics.aiProductivityOpportunity.state} metricId="aiProductivityOpportunity" />;
    case "momentum":
      return <StateText state={v.metrics.providerMomentum.state} metricId="providerMomentum" />;
    case "risk":
      return <StateText state={v.metrics.operationalRisk.state} metricId="operationalRisk" />;
    default:
      return null;
  }
}

export function VendorComparison({ vendors, variant }: { vendors: VendorIntel[]; variant: Variant }) {
  const cols = COLUMNS[variant];
  return (
    <Panel className="overflow-hidden">
      {/* Desktop: the table, scrolling inside its own container if it must. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[0.96rem]">
          <thead>
            <tr>
              <th className="eyebrow px-5 py-2.5 text-left font-semibold">Vendor</th>
              {cols.map((c) => (
                <th key={c.key} className="eyebrow px-4 py-3 text-left font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {c.label}
                    {c.metricId && METRIC_DICTIONARY[c.metricId] ? (
                      <InfoTip content={fromSemantics(METRIC_DICTIONARY[c.metricId]!)} />
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendors.map((v, i) => (
              <tr key={v.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                <td className="px-5 py-3">
                  <Link href={`/vendors/${v.ticker.toLowerCase()}`} className="tap-link group inline-flex items-baseline gap-2.5">
                    <span className="code tabular w-5 text-right text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                      {i + 1}
                    </span>
                    <span
                      className="font-medium underline-offset-4 group-hover:underline"
                      style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                    >
                      {v.name}
                    </span>
                  </Link>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="tabular px-4 py-3">
                    <Cell v={v} col={c.key} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked cards, hierarchy preserved. */}
      <ul className="m-0 list-none divide-y p-0 md:hidden" style={{ borderColor: "var(--surface-line-soft)" }}>
        {vendors.map((v, i) => (
          <li key={v.ticker} className="px-5 py-4" style={{ borderColor: "var(--surface-line-soft)" }}>
            <Link href={`/vendors/${v.ticker.toLowerCase()}`} className="tap-link flex items-baseline justify-between gap-3">
              <span className="font-medium" style={{ color: "var(--fg)" }}>
                <span className="code tabular mr-2 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                  {i + 1}
                </span>
                {v.name}
              </span>
              <Cell v={v} col="overall" />
            </Link>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.9rem]">
              {cols.slice(1, 5).map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-2">
                  <span className="eyebrow text-[0.7rem]">{c.label}</span>
                  <Cell v={v} col={c.key} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
