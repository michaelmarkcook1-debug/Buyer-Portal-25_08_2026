import type { Confidence, Movement } from "./types";

/**
 * Pure metric rules — extracted so the truth-critical behaviours are unit-testable
 * (spec §18): freshness caps, procurement handling, AI Enterprise status gating,
 * and financial headroom banding. No I/O in this module.
 */

/* ── movement from a now-vs-before ratio ── */
export const ratioMove = (now: number, before: number): Movement => {
  if (before === 0 && now === 0) return "insufficient";
  if (before === 0) return now > 0 ? "improving" : "stable";
  const r = now / before;
  if (r >= 1.5) return "materially-improving";
  if (r >= 1.15) return "improving";
  if (r <= 0.5) return "materially-deteriorating";
  if (r <= 0.85) return "deteriorating";
  return "stable";
};

export const invertMove = (m: Movement): Movement =>
  m === "improving" ? "deteriorating"
  : m === "deteriorating" ? "improving"
  : m === "materially-improving" ? "materially-deteriorating"
  : m === "materially-deteriorating" ? "materially-improving"
  : m;

/* ── freshness: stale evidence must not keep high confidence silently (§18) ── */
const CONF_ORDER: Confidence[] = ["insufficient", "low", "medium", "high"];

export function capConfidenceByAge(
  confidence: Confidence,
  asOf: string | null,
  opts: { maxFreshDays: number; today?: string },
): Confidence {
  if (confidence === "insufficient" || !asOf) return confidence;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.floor((Date.parse(today) - Date.parse(asOf)) / 86_400_000);
  if (!Number.isFinite(ageDays) || ageDays <= opts.maxFreshDays) return confidence;
  const idx = CONF_ORDER.indexOf(confidence);
  return CONF_ORDER[Math.max(1, idx - 1)];
}

/* ── procurement: market evidence, NEVER enterprise pricing (§10/§18) ── */
export const PRICING_EVIDENCE_SOURCES = new Set(["curated-spine"]);

/** Guard used by every pricing-facing basis builder. Public procurement is flow/context only. */
export function isAllowedPricingSource(source: string): boolean {
  return PRICING_EVIDENCE_SOURCES.has(source);
}

/** Deal-market state from fresh procurement flow. Cooling favours the buyer. */
export function procurementHeatState(t90: number, prior90: number): {
  usable: boolean;
  state: "favourable" | "stable" | "unfavourable";
  movement: Movement;
} {
  if (t90 + prior90 < 3) return { usable: false, state: "stable", movement: "insufficient" };
  const movement = ratioMove(t90, prior90);
  const state = movement.includes("deteriorating")
    ? ("favourable" as const)
    : movement.includes("improving")
      ? ("unfavourable" as const)
      : ("stable" as const);
  return { usable: true, state, movement };
}

/* ── AI Enterprise: seed/stale intelligence never enters portal metrics (§18) ── */
export function allowedAiEnterprisePillar(input: {
  dataStatusHint: string | null;
  evidenceGrade: string | null;
  confidence: number | null;
}): boolean {
  const hint = (input.dataStatusHint ?? "").toLowerCase();
  if (hint === "seed" || hint === "stale" || hint === "unknown" || hint === "") return false;
  const gradeRank = Number((input.evidenceGrade ?? "E0").replace(/\D/g, ""));
  if (!Number.isFinite(gradeRank) || gradeRank < 2) return false;
  if (input.confidence == null || input.confidence < 50) return false;
  return true;
}

/* ── financial headroom: corporate flexibility, listed subset only (§11/§12 sprint) ── */
export function headroomState(input: {
  operatingMarginPct: number | null;
  cashUsd: number | null;
  longTermDebtUsd: number | null;
}): { state: "favourable" | "stable" | "unfavourable" | "insufficient"; reading: string | null } {
  const { operatingMarginPct: m, cashUsd: cash, longTermDebtUsd: debt } = input;
  if (m == null && cash == null && debt == null) return { state: "insufficient", reading: null };
  if (m != null && cash != null && debt != null) {
    if (m >= 10 && cash >= debt * 0.6) {
      return { state: "favourable", reading: "Margin and balance-sheet position leave clear room to absorb commercial pressure or fund buyer investment." };
    }
    if (m < 3 || debt > cash * 3) {
      return { state: "unfavourable", reading: "Thin margin or leveraged balance sheet — limited observed room to fund concessions or investment." };
    }
    return { state: "stable", reading: "Moderate observed flexibility to absorb commercial pressure." };
  }
  if (m != null) {
    if (m >= 10) return { state: "favourable", reading: "Operating margin leaves observed room for commercial flexibility." };
    if (m < 3) return { state: "unfavourable", reading: "Thin operating margin — limited observed commercial flexibility." };
    return { state: "stable", reading: "Moderate operating margin." };
  }
  return { state: "insufficient", reading: null };
}

/* ── AI capability change (Sprint 2 §7): states from materiality-gated events ── */

export type AiChangeState = "materially-increased" | "increased" | "stable" | "decreased" | "insufficient";

export interface MaterialEventSummary {
  /** Count of materiality>=3 events in the trailing 12 months. */
  materialT12: number;
  /** Count of materiality=5 events in the trailing 12 months. */
  highT12: number;
}

/**
 * Vendor AI/automation capability change over 12 months. A generic
 * announcement (low materiality) NEVER moves this — only gated events and the
 * observed readiness series do (§6/§29).
 */
export function aiCapabilityChange(ev: MaterialEventSummary, readinessDelta: number | null): AiChangeState {
  if (ev.highT12 >= 2 || (ev.highT12 >= 1 && ev.materialT12 >= 3)) return "materially-increased";
  if (ev.materialT12 >= 2 || ev.highT12 >= 1) return "increased";
  if (readinessDelta != null && readinessDelta <= -3) return "decreased";
  if (ev.materialT12 === 1 || (readinessDelta != null && Math.abs(readinessDelta) <= 3)) return "stable";
  return "insufficient";
}

/** Automation-opportunity state gate: capability + labour base + REAL events. */
export function automationState(input: {
  aiReadiness: number | null;
  labourHeavy: boolean;
  materialEventsT12: number;
}): "favourable" | "stable" | "mixed" | "insufficient" {
  const { aiReadiness: ai, labourHeavy, materialEventsT12: ev } = input;
  if (ai == null && ev === 0) return "insufficient";
  if ((ai != null && ai >= 70 && labourHeavy) || (ai != null && ai >= 60 && ev >= 2)) return "favourable";
  if (ai != null && ai >= 60) return "stable";
  return "mixed";
}

/* ── commercial-model completeness guard (Sprint 2 §10) ── */

export type CoverageQuality = "strong" | "partial" | "weak";

export interface MixCoverage {
  observedCount: number;
  classifiedCount: number;
  coverageQuality: CoverageQuality;
}

/**
 * Dataset-completeness banding for the commercial-model mix. Thresholds
 * (internal, documented): classification of the observed set must be broad
 * enough that "0 observed" is a meaningful statement about the DATASET —
 * it is never a statement about the whole market (§10 wording rules).
 */
export function mixCoverage(observedCount: number, classifiedCount: number): MixCoverage {
  const ratio = observedCount > 0 ? classifiedCount / observedCount : 0;
  const coverageQuality: CoverageQuality =
    observedCount >= 100 && ratio >= 0.8 ? "strong" : observedCount >= 30 && ratio >= 0.5 ? "partial" : "weak";
  return { observedCount, classifiedCount, coverageQuality };
}

/* ── delivery-cost economics (Sprint 2 §15) — macro-grounded, never fabricated ── */

export interface MacroReading {
  /** Year-over-year percent change; null = series not held or too stale. */
  usWageYoY: number | null;
  usCpiYoY: number | null;
  indiaCpiYoY: number | null;
  /** Positive = INR weakened vs USD (offshore delivery cheaper in USD terms). */
  inrPerUsdYoY: number | null;
}

export function deliveryCostState(m: MacroReading): {
  state: "favourable" | "stable" | "unfavourable" | "mixed" | "insufficient";
  reading: string | null;
  signals: number;
} {
  const votes: Array<"buyer" | "supplier"> = [];
  if (m.usWageYoY != null) votes.push(m.usWageYoY >= 4 ? "supplier" : "buyer");
  if (m.indiaCpiYoY != null) votes.push(m.indiaCpiYoY >= 6 ? "supplier" : "buyer");
  if (m.inrPerUsdYoY != null) votes.push(m.inrPerUsdYoY >= 2 ? "buyer" : m.inrPerUsdYoY <= -2 ? "supplier" : "buyer");
  if (m.usCpiYoY != null) votes.push(m.usCpiYoY >= 4 ? "supplier" : "buyer");
  const signals = votes.length;
  if (signals < 2) return { state: "insufficient", reading: null, signals };
  const buyer = votes.filter((v) => v === "buyer").length;
  const supplier = signals - buyer;
  if (buyer >= supplier + 2) return { state: "favourable", reading: "Underlying delivery economics lean buyer-favourable on the observed wage, inflation and FX series.", signals };
  if (supplier >= buyer + 2) return { state: "unfavourable", reading: "Underlying delivery economics lean supplier-favourable — input costs are rising faster than currency relief.", signals };
  if (buyer !== supplier) return { state: "mixed", reading: "Delivery-economics signals point in different directions across wages, inflation and FX.", signals };
  return { state: "stable", reading: "Observed wage, inflation and FX series are broadly offsetting.", signals };
}

/* ── historical modes: reconstructed history may never claim snapshot status (§18) ── */
export type HistoricalMode = "reconstructed" | "observed_snapshot";

export function historyModeLabel(mode: HistoricalMode): string {
  return mode === "observed_snapshot"
    ? "observed snapshots"
    : "reconstructed from dated observations";
}

/** A series builder must declare its mode; observed requires system-calculated points. */
export function assertHistoryMode(mode: HistoricalMode, systemCalculatedAt: boolean): HistoricalMode {
  if (mode === "observed_snapshot" && !systemCalculatedAt) {
    throw new Error(
      "History integrity: a series without system-recorded calculation timestamps cannot be presented as observed snapshots.",
    );
  }
  return mode;
}
