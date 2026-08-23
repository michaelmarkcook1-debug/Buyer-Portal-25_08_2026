/**
 * Canonical buyer metric layer — portal-owned, buyer-specific (spec §17–§19).
 *
 * One metric, one resolver, every tab: pages never compute their own version
 * of a state, so common metrics cannot contradict each other across tabs.
 *
 * States use the spec's semantic language. No decorative pseudo-precision:
 * a metric is a state + movement + confidence + the real facts behind it.
 * The rules that band a state are internal constants (lib/metrics/resolve.ts)
 * and are never displayed — the UI shows result, direction, confidence,
 * freshness and interpretation only.
 */

export type MetricState = "favourable" | "stable" | "unfavourable" | "mixed" | "insufficient";

export type Movement =
  | "materially-improving"
  | "improving"
  | "stable"
  | "deteriorating"
  | "materially-deteriorating"
  | "insufficient";

export type Confidence = "high" | "medium" | "low" | "insufficient";

export type OpportunityLevel = "very-high" | "high" | "medium" | "low" | "insufficient";

/** LOCKED taxonomy (spec §13). Exactly five. Do not extend without approval. */
export const OPPORTUNITY_TYPES = [
  "pricing",
  "automation",
  "gain-sharing",
  "commercial-leverage",
  "market-test",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_LABELS: Record<OpportunityType, string> = {
  pricing: "Pricing",
  automation: "Automation",
  "gain-sharing": "Gain sharing",
  "commercial-leverage": "Commercial leverage",
  "market-test": "Market test",
};

/**
 * Evidence ownership — the load-bearing distinction (correction pass 2026-08-21).
 *
 * "market": public/third-party/AG-derived observation — contracts between the
 *           vendors and OTHER organisations, filings, signals. The portal holds
 *           NOTHING the buyer owns today, so every contract-level fact is market.
 * "buyer":  reserved for a future authoritative buyer-owned integration
 *           (e.g. Contract Tracker). Nothing produces it yet.
 *
 * Market facts must never be rendered or narrated as the buyer's own contracts,
 * renewals, spend, rates or commitments. Enforced in lib/insight/validate.ts.
 */
export type EvidenceOwnership = "market" | "buyer";

/** A real fact supporting a state — text with figures straight from the record. */
export interface Basis {
  text: string;
  source: string;
  ownership: EvidenceOwnership;
  asOf?: string | null;
}

export interface Metric {
  id: string;
  label: string;
  state: MetricState;
  movement: Movement;
  confidence: Confidence;
  /** One-line buyer reading, deterministically templated from real figures. */
  headline: string | null;
  basis: Basis[];
  asOf: string | null;
  /** Present when a scenario adjusted this metric — modelled, not evidence. */
  modelled?: string;
}

export interface Opportunity {
  type: OpportunityType;
  level: OpportunityLevel;
  movement: Movement;
  confidence: Confidence;
  /** Why it exists — real facts. */
  why: Basis[];
  /** What to investigate or challenge — framing prompts, never contract claims. */
  investigate: string[];
  /** Plain-language explanation of the level (sprint 4 §10) — drivers, no weights. */
  reason?: string;
  /** Set when the level holds but the evidence behind a comparative position
   * is materially thinner than peers. Governs ranking confidence and a
   * restrained buyer-facing qualifier — never a confidence score. */
  evidenceQualifier?: "directional";
  modelled?: string;
}

/** The canonical per-vendor metric set (spec §17). */
export interface VendorMetrics {
  buyerLeverage: Metric;
  pricingPressure: Metric;
  savingsOpportunity: Metric;
  automationOpportunity: Metric;
  aiProductivityOpportunity: Metric;
  gainShareOpportunity: Metric;
  marketTestOpportunity: Metric;
  financialResilience: Metric;
  financialHeadroom: Metric;
  providerMomentum: Metric;
  talentPressure: Metric;
  deliveryCostPressure: Metric;
  dealMarketHeat: Metric;
  operationalRisk: Metric;
  reputationMovement: Metric;
  /** Evidence-floor banding for the gain-sharing opportunity (sprint 3 fix 4). */
  gainShareLevelBand?: "very-high" | "high" | "medium" | "low" | "insufficient";
}

/** Sprint 4 §11/§12 — why this vendor should be managed differently. */
export interface VendorDifferentiation {
  strongest: string;
  weakest: string | null;
  keyChange: string | null;
  relatives: string[];
  risk: string | null;
  discuss: string | null;
}

export interface VendorIntel {
  ticker: string;
  name: string;
  coverage: {
    contracts: number;
    inPlay12: number;
    inPlay24: number;
    hasSignals: boolean;
    hasSec: boolean;
  };
  metrics: VendorMetrics;
  opportunities: Record<OpportunityType, Opportunity>;
  /** Overall commercial opportunity — the ranking key across the portal. */
  overall: Opportunity;
  /** AG claims-vs-delivery read, surfaced as interpretation (never recomputed). */
  differentiation?: VendorDifferentiation;
  claimsVsDelivery: {
    direction: string | null;
    headline: string | null;
    asOf: string | null;
  } | null;
  lastUpdated: string | null;
}

export interface TwelveMonthDimension {
  dimension: string;
  state: MetricState;
  movement: Movement;
  detail: string;
  confidence: Confidence;
  source: string;
}

export type WatchClass = "ACT" | "WATCH" | "KNOW";

export interface WatchSignal {
  classification: WatchClass;
  tickers: string[];
  vendors: string[];
  headline: string;
  implication: string;
  opportunityType: OpportunityType | null;
  change: string | null;
  confidence: Confidence;
  date: string | null;
  sourceUrl: string | null;
}

export interface MarketIntel {
  /** Scope echo — vendor names in selection order. */
  scope: { mode: "selected_vendors" | "whole_market"; tickers: string[]; names: string[] };
  baselineStart: string;
  /** Latest ingest across sources — the global freshness line. */
  updatedAt: string | null;
  /**
   * Spine freshness carries BOTH truths: ingest provenance and the newest
   * observation date the commercial evidence itself contains (data-as-of).
   * Freshness is never inferred from ingestion timestamps alone.
   */
  spine: { lastIngest: string; daysStale: number; dataAsOf: string | null; dataAgeDays: number | null };
  strip: {
    buyerLeverage: Metric;
    pricingPressure: Metric;
    automationOpportunity: Metric;
    commercialOpportunities: Metric;
    marketHeat: Metric;
    servicesDemand: Metric;
    competitiveIntensity: Metric;
    aiProductivityPressure: Metric;
  };
  buyerEconomics: {
    state: MetricState;
    movement: Movement;
    dimensions: Metric[];
  };
  vendors: VendorIntel[];
  changes: TwelveMonthDimension[];
  watch: WatchSignal[];
  /** Tracking window for AG signal deltas (first snapshot date). */
  signalTrackingSince: string | null;
}

/* ── shared banding helpers (used by resolve + scenarios) ── */

export const LEVEL_ORDER: OpportunityLevel[] = ["insufficient", "low", "medium", "high", "very-high"];

export function shiftLevel(level: OpportunityLevel, by: number): OpportunityLevel {
  if (level === "insufficient") return level;
  const i = LEVEL_ORDER.indexOf(level);
  const next = Math.min(Math.max(i + by, 1), LEVEL_ORDER.length - 1);
  return LEVEL_ORDER[next];
}

export function levelScore(level: OpportunityLevel): number {
  return Math.max(0, LEVEL_ORDER.indexOf(level));
}
