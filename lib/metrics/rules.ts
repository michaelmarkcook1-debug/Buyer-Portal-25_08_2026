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
