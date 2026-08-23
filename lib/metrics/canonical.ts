/**
 * Canonical metric registry — the semantic contract for the Buyer Portal.
 *
 * One concept has ONE definition. Where two calculations answer genuinely
 * different questions they get different IDs, different names and different
 * labels; they may never render in the same visual language as if comparable.
 *
 * This module holds the DEFINITIONS. The values themselves are produced by
 * `lib/data/facts.ts` and resolved in `lib/metrics/resolve.ts` — but every
 * surface must read a single resolved value, never recompute its own.
 *
 * Background: a cross-surface audit (23 Aug 2026) found "commercial deal
 * flow" computed three ways — anchored on ingestion date, on today, and on
 * partial calendar quarters — producing 56 vs 59 on one tab and 66 vs 51 on
 * another from the same rows. Opposite conclusions from one dataset.
 */

/** Which evidence anchor a metric family is measured against. */
export type EvidenceAnchor =
  /** Latest evidence date genuinely present in the commercial contract
   *  dataset (NOT ingestion time, NOT today). Windows close here. */
  | "commercial_contract_data_as_of"
  /** Signal/event families that genuinely extend to the present. */
  | "today"
  /** The metric carries its own per-series as-of. */
  | "series_specific";

export type ComparisonPeriod =
  | "rolling_12m_vs_prior_12m"
  | "trailing_90d_vs_prior_90d"
  | "latest_reading_vs_baseline"
  | "point_in_time";

export interface MetricDefinition {
  /** Stable ID. Referenced by tests and by the Analyst Insight context. */
  id: string;
  /** What a buyer should understand this to mean. */
  meaning: string;
  /** Always the user's selected vendors unless stated. */
  scope: "selected_market" | "single_vendor" | "whole_universe";
  evidenceFamilies: string[];
  anchor: EvidenceAnchor;
  comparison: ComparisonPeriod;
  unit: "count" | "usd" | "percent" | "state" | "level" | "ratio";
  /** How the figure must be formatted wherever it appears. */
  formatter: "money" | "count" | "signed" | "state" | "level" | "percent";
}

/** Registry helpers — state/level metrics share a shape; only the inputs differ. */
function state(id: string, meaning: string, evidenceFamilies: string[], anchor: EvidenceAnchor): MetricDefinition {
  return { id, meaning, scope: "selected_market", evidenceFamilies, anchor, comparison: "latest_reading_vs_baseline", unit: "state", formatter: "state" };
}
function level(id: string, meaning: string, evidenceFamilies: string[]): MetricDefinition {
  return { id, meaning, scope: "selected_market", evidenceFamilies, anchor: "series_specific", comparison: "latest_reading_vs_baseline", unit: "level", formatter: "level" };
}

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  /* ── the metric the audit found contradicting itself ── */
  commercialDealFlow: {
    id: "commercialDealFlow",
    meaning:
      "How commercial deal activity across the selected vendors has changed over the most recent comparable 12-month period. Counts observed signings by signing date.",
    scope: "selected_market",
    evidenceFamilies: ["contract_tracker", "contract_tracker_store"],
    anchor: "commercial_contract_data_as_of",
    comparison: "rolling_12m_vs_prior_12m",
    unit: "count",
    formatter: "count",
  },
  /* Deliberately DIFFERENT from commercialDealFlow: public procurement is
     flow/context evidence on a shorter window, never enterprise pricing. It
     must never be labelled "deal flow" or compared against it. */
  procurementAwardFlow: {
    id: "procurementAwardFlow",
    meaning:
      "Public procurement award activity to the selected vendors over the trailing 90 days versus the prior 90. Separate question from commercial deal flow, on a separate evidence family and a shorter window.",
    scope: "selected_market",
    evidenceFamilies: ["procurement_contract_*"],
    anchor: "today",
    comparison: "trailing_90d_vs_prior_90d",
    unit: "count",
    formatter: "count",
  },
  endOfTermConcentration: {
    id: "endOfTermConcentration",
    meaning:
      "Observed agreements reaching end-of-term within 12 and 24 months, with their disclosed value. Market evidence — never the reader's own contracts.",
    scope: "selected_market",
    evidenceFamilies: ["contract_tracker", "contract_tracker_store"],
    anchor: "today",
    comparison: "point_in_time",
    unit: "count",
    formatter: "count",
  },
  aiCapabilityEvents: {
    id: "aiCapabilityEvents",
    meaning: "Material AI capability changes at the selected vendors in the trailing 12 months. Routine announcements are excluded.",
    scope: "selected_market",
    evidenceFamilies: ["signal:ai_shift"],
    anchor: "today",
    comparison: "rolling_12m_vs_prior_12m",
    unit: "count",
    formatter: "count",
  },
  /* ── vendor/market state metrics ──────────────────────────────────────
     These already have ONE valid implementation in resolve.ts. They are
     mapped here, not reimplemented: the registry records the contract so a
     second implementation can never appear without failing a test. */
  buyerLeverage: state("buyerLeverage", "Whether observed commercial conditions favour the buyer across the selected market.", ["contract_tracker", "contract_tracker_store"], "commercial_contract_data_as_of"),
  pricingPressure: state("pricingPressure", "Direction of observed pricing conditions for the selected vendors.", ["contract_tracker", "contract_tracker_store"], "commercial_contract_data_as_of"),
  commercialOpportunity: level("commercialOpportunity", "Overall commercial opportunity — the portal-wide ranking key.", ["contract_tracker", "contract_tracker_store", "signal:ai_shift", "edgar", "fred"]),
  savingsOpportunity: level("savingsOpportunity", "Where commercial value may exist. Directional — never a guaranteed monetary saving.", ["contract_tracker", "contract_tracker_store", "fred"]),
  automationOpportunity: level("automationOpportunity", "Automation capability set against a labour-heavy delivery base.", ["signal:ai_shift", "vendor_catalog"]),
  aiProductivityOpportunity: level("aiProductivityOpportunity", "Whether AI delivery capability has moved enough to challenge productivity assumptions.", ["signal:ai_shift", "vendor_catalog"]),
  gainShareOpportunity: level("gainShareOpportunity", "Whether productivity gains are outpacing commercial terms.", ["signal:ai_shift", "talent", "contract_tracker"]),
  marketTestOpportunity: level("marketTestOpportunity", "Strength of the case for testing alternative suppliers or competitive tension.", ["contract_tracker", "procurement_contract_*"]),
  financialResilience: state("financialResilience", "The vendor's own financial condition — held separate from buyer leverage.", ["edgar"], "series_specific"),
  financialHeadroom: state("financialHeadroom", "Observed room to absorb commercial pressure or fund buyer investment.", ["edgar"], "series_specific"),
  providerMomentum: state("providerMomentum", "Direction of the vendor's commercial momentum.", ["edgar", "contract_tracker", "procurement_contract_*"], "series_specific"),
  talentPressure: state("talentPressure", "Delivery-workforce direction — a capacity question on multi-year commitments.", ["talent"], "today"),
  deliveryCostPressure: state("deliveryCostPressure", "Macro delivery-cost direction. Never enterprise pricing.", ["fred"], "series_specific"),
  dealMarketHeat: state("dealMarketHeat", "Demand pressure implied by observed win pace.", ["procurement_contract_*", "contract_tracker"], "today"),
  operationalRisk: state("operationalRisk", "Observed operational risk to the buyer.", ["edgar", "reputation"], "series_specific"),
  reputationMovement: state("reputationMovement", "Movement in the AG reputation tracker series.", ["reputation"], "series_specific"),
  twelveMonthChange: {
    id: "twelveMonthChange",
    meaning: "The retrospective dimension set. Each dimension inherits the anchor and window of ITS OWN evidence family — they are not one measure and are never summed.",
    scope: "selected_market",
    evidenceFamilies: ["mixed"],
    anchor: "series_specific",
    comparison: "rolling_12m_vs_prior_12m",
    unit: "state",
    formatter: "state",
  },
} as const;

/**
 * Scope qualifier carried at the point of use. A vendor figure and a market
 * figure of similar magnitude ($7.1bn vs $7.2bn) must never render without
 * saying which is which.
 */
export function scopeLabel(scope: "vendor" | "market", opts: { vendorName?: string; vendorCount?: number }): string {
  if (scope === "vendor") return opts.vendorName ?? "This vendor";
  const n = opts.vendorCount ?? 0;
  return n > 0 ? `Selected market · ${n} vendor${n === 1 ? "" : "s"}` : "Selected market";
}

/**
 * Canonical window label for the commercial-contract family. Every surface
 * using that family inherits this exact string, so a reader never sees three
 * different "as of" dates for one measure.
 */
export function commercialWindowLabel(dataAsOf: string | null, shortDate: (d: string) => string): string {
  return dataAsOf ? `rolling 12 months to ${shortDate(dataAsOf)}` : "rolling 12 months";
}
