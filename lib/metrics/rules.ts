import type { Basis, Confidence, Movement, OpportunityLevel } from "./types";

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

/* ── band-aware delivery-cost economics (sprint 3 P4) ────────────────────────
   The macro series that matter depend on where the vendor actually delivers
   from. Bands come from evidence (lib/metrics/exposure.ts); this function
   only selects and reads the relevant published series. */

export interface MacroSeriesSet extends MacroReading {
  /** USD per EUR, YoY % — positive = euro stronger = European delivery dearer in USD. */
  eurPerUsdYoY: number | null;
  /** USD per GBP, YoY % — same direction. */
  gbpPerUsdYoY: number | null;
}

export type DeliveryBand = "india-heavy" | "india-material" | "europe-heavy" | "us-heavy" | "mixed-global";

export function deliveryCostForBand(m: MacroSeriesSet, band: DeliveryBand): {
  state: "favourable" | "stable" | "unfavourable" | "mixed" | "insufficient";
  reading: string | null;
  signals: number;
  seriesUsed: string[];
} {
  const votes: Array<{ s: "buyer" | "supplier"; series: string }> = [];
  // FX: only a move beyond ±2% YoY is a vote; the neutral band votes nothing.
  const fx = (yoy: number | null, series: string, positiveIsBuyer: boolean) => {
    if (yoy == null || Math.abs(yoy) < 2) return;
    votes.push({ s: yoy > 0 === positiveIsBuyer ? "buyer" : "supplier", series });
  };
  const lvl = (yoy: number | null, series: string, supplierAt: number) => {
    if (yoy == null) return;
    votes.push({ s: yoy >= supplierAt ? "supplier" : "buyer", series });
  };
  switch (band) {
    case "india-heavy":
      fx(m.inrPerUsdYoY, "DEXINUS", true);
      lvl(m.indiaCpiYoY, "INDCPIALLMINMEI", 6);
      lvl(m.usCpiYoY, "CPIAUCSL", 4); // common contractual escalator reference
      break;
    case "india-material":
      lvl(m.usWageYoY, "ECIWAG", 4);
      lvl(m.usCpiYoY, "CPIAUCSL", 4);
      fx(m.inrPerUsdYoY, "DEXINUS", true);
      lvl(m.indiaCpiYoY, "INDCPIALLMINMEI", 6);
      break;
    case "europe-heavy":
      fx(m.eurPerUsdYoY, "DEXUSEU", false);
      fx(m.gbpPerUsdYoY, "DEXUSUK", false);
      break;
    case "us-heavy":
      lvl(m.usWageYoY, "ECIWAG", 4);
      lvl(m.usCpiYoY, "CPIAUCSL", 4);
      break;
    case "mixed-global":
      lvl(m.usWageYoY, "ECIWAG", 4);
      lvl(m.usCpiYoY, "CPIAUCSL", 4);
      lvl(m.indiaCpiYoY, "INDCPIALLMINMEI", 6);
      fx(m.inrPerUsdYoY, "DEXINUS", true);
      fx(m.eurPerUsdYoY, "DEXUSEU", false);
      break;
  }
  const signals = votes.length;
  const seriesUsed = votes.map((v) => v.series);
  if (signals < 2) return { state: "insufficient", reading: null, signals, seriesUsed };
  const buyer = votes.filter((v) => v.s === "buyer").length;
  const supplier = signals - buyer;
  const label = band.replace(/-/g, " ");
  if (buyer >= supplier + 2)
    return { state: "favourable", reading: `For a ${label} delivery base, the relevant published cost series currently lean buyer-favourable.`, signals, seriesUsed };
  if (supplier >= buyer + 2)
    return { state: "unfavourable", reading: `For a ${label} delivery base, the relevant published cost series lean supplier-favourable — input costs are rising faster than currency relief.`, signals, seriesUsed };
  if (buyer !== supplier)
    return { state: "mixed", reading: `For a ${label} delivery base, the relevant published cost series point in different directions.`, signals, seriesUsed };
  return { state: "stable", reading: `For a ${label} delivery base, the relevant published cost series are broadly offsetting.`, signals, seriesUsed };
}

/* ── pricing discrimination (sprint 3 fix 3) ─────────────────────────────────
   State is driven by VENDOR-SPECIFIC evidence only. A market-wide macro
   tailwind is context: it can colour the basis and never the state, so one
   broad signal cannot collapse the whole universe into "favourable". */

export interface PricingInputs {
  /** Vendor's own deal-market heat read is usable (enough of their own flow). */
  heatUsable: boolean;
  /** Vendor's own award flow is cooling (buyer-favourable heat state). */
  cooling: boolean;
  /** Vendor's own flow fell by half or more across the windows. */
  stronglyCooling: boolean;
  /** Scoped alternatives active in the vendor's top service line. */
  alternatives: number;
  /** Vendor's own filed margin leaves observed room to concede. */
  marginRoom: boolean;
  /** Market-wide macro delivery-cost read is buyer-favourable (context only). */
  macroFavourable: boolean;
}

export function pricingRead(p: PricingInputs): {
  state: "favourable" | "mixed" | "stable";
  vendorFamilies: number;
  marketContextOnly: boolean;
} {
  const cooling = p.heatUsable && p.cooling;
  const vendorFamilies = [cooling, p.alternatives >= 1, p.marginRoom].filter(Boolean).length;
  // Favourable is earned by the vendor's own record: their flow must be
  // cooling AND corroborated — strongly, or by breadth plus margin room.
  const favourable =
    (p.heatUsable && p.stronglyCooling && p.alternatives >= 1) ||
    (cooling && p.alternatives >= 1 && p.marginRoom);
  if (favourable) return { state: "favourable", vendorFamilies, marketContextOnly: false };
  if (vendorFamilies >= 2 || cooling) return { state: "mixed", vendorFamilies, marketContextOnly: false };
  // A lone structural signal (alternatives exist / margin room) or a purely
  // market-wide tailwind reads stable — direction is not asserted.
  return { state: "stable", vendorFamilies, marketContextOnly: vendorFamilies === 0 && p.macroFavourable };
}

/* ── gain-sharing evidence floor (sprint 3 fix 4) ────────────────────────────
   Levels are earned by commercially meaningful CHANGE evidence, not by the
   mere existence of baseline inputs. */

export type GainShareLevel = "very-high" | "high" | "medium" | "low" | "insufficient";

export interface GainShareEvidence {
  aiReadiness: number | null;
  materialEventsT12: number;
  highEventsT12: number;
  /** A gated pricing-model / productivity / AI-revenue disclosure exists. */
  commercialModelEvent: boolean;
  /** Net talent flow is negative (labour dependency observably falling). */
  labourDown: boolean;
  /** Talent reading exists at all. */
  talentKnown: boolean;
  /** Filed margin indicates capacity to fund gain-share structures. */
  marginRoom: boolean;
}

export function gainShareLevel(e: GainShareEvidence): GainShareLevel {
  const capabilityUp = e.aiReadiness != null && e.aiReadiness >= 60;
  const eventsUp = e.materialEventsT12 >= 1;
  // CHANGE families: things that materially challenge existing commercial
  // assumptions. Margin room supports a case; it never creates one.
  const changeFamilies = [capabilityUp, eventsUp, e.labourDown, e.commercialModelEvent].filter(Boolean).length;
  if (e.aiReadiness == null && e.materialEventsT12 === 0 && !e.talentKnown) return "insufficient";
  if (changeFamilies === 0) return "low";
  if (changeFamilies === 1 && !e.commercialModelEvent) return "medium";
  if (e.commercialModelEvent && (capabilityUp || e.labourDown) && (e.highEventsT12 >= 1 || e.marginRoom)) return "very-high";
  if (changeFamilies >= 3 && e.highEventsT12 >= 1) return "very-high";
  return "high";
}

/* ── signal quality gates (sprint 4 §7/§8) ──────────────────────────────────── */

/**
 * Leverage signals earn ACT only when the evidence is confident and the
 * concentration is real; stale/thin evidence demotes to WATCH — an ACT must
 * represent a credible commercial action, not a template.
 */
export function leverageSignalClass(confidence: Confidence, inPlay12: number): "ACT" | "WATCH" {
  return confidence !== "low" && inPlay12 >= 2 ? "ACT" : "WATCH";
}

export interface DedupableSignal {
  classification: "ACT" | "WATCH" | "KNOW";
  tickers: string[];
  date: string | null;
  headline: string;
}

/**
 * One underlying development must not surface repeatedly (§8): signals for
 * the same vendor within a 1-day window are treated as the same development —
 * the highest classification (ACT > WATCH > KNOW) survives; ties keep the
 * first (already-ranked) entry.
 */
export function dedupeSignals<T extends DedupableSignal>(signals: T[]): T[] {
  const rank = { ACT: 0, WATCH: 1, KNOW: 2 } as const;
  const kept: T[] = [];
  for (const s of signals) {
    const dup = kept.findIndex((k) => {
      if (k.tickers[0] !== s.tickers[0]) return false;
      if (!k.date || !s.date) return false;
      const gap = Math.abs(Date.parse(k.date) - Date.parse(s.date));
      return gap <= 86_400_000;
    });
    if (dup === -1) {
      kept.push(s);
    } else if (rank[s.classification] < rank[kept[dup]!.classification]) {
      kept[dup] = s;
    }
  }
  return kept;
}

/* ── freshness semantics (sprint 3 fix 5): asOf = newest reliable evidence ── */

export function newestOf(...dates: Array<string | null | undefined>): string | null {
  const clean = dates.filter((d): d is string => Boolean(d));
  return clean.length ? clean.sort().at(-1)! : null;
}

/* ── historical modes: reconstructed history may never claim snapshot status (§18) ── */
export type HistoricalMode = "reconstructed" | "observed_snapshot";

/**
 * Buyer-facing wording for a history mode. The distinction still matters —
 * a rebuilt series may never claim snapshot status — but executives read
 * "reconstructed from dated observations" as engineering noise, so the same
 * truth is carried in plain language. The precise mode remains available
 * internally via `mode` and in the integrity assertion below.
 */
export function historyModeLabel(mode: HistoricalMode): string {
  return mode === "observed_snapshot"
    ? "tracked from the date each reading was taken"
    : "12-month historical view, built from dated evidence";
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

/* §10/§15: plain-language driver derivation from the basis SOURCES actually
   present — interpretation without exposing weights. */
const DRIVER_LABELS: Array<[RegExp, string]> = [
  [/AI capability events/i, "material AI capability change"],
  [/vendor catalog/i, "AI capability readings"],
  [/talent signals/i, "workforce movement"],
  [/EDGAR/i, "filed financial position"],
  [/FRED/i, "delivery-cost economics"],
  [/procurement/i, "public award flow"],
  [/contract (?:tracker|spine)/i, "observed contract-market movement"],
  [/reputation/i, "reputation movement"],
];

export function driversOf(basis: Basis[]): string[] {
  const out: string[] = [];
  for (const b of basis) {
    for (const [re, label] of DRIVER_LABELS) {
      if (re.test(b.source) && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

export const LEVEL_WORD: Record<OpportunityLevel, string> = {
  "very-high": "Very high", high: "High", medium: "Medium", low: "Low", insufficient: "Insufficient evidence",
};

/** §10/§20: level explained by drivers; low confidence changes the meaning. */
export function opportunityReason(level: OpportunityLevel, confidence: Confidence, basis: Basis[], spineStale: boolean): string {
  if (level === "insufficient") return "Insufficient evidence to assess this opportunity.";
  const d = driversOf(basis);
  let r = `${LEVEL_WORD[level]} — primarily driven by ${d.slice(0, 2).join(" and ") || "the canonical readings"}.`;
  if ((level === "high" || level === "very-high") && confidence === "low") {
    r += spineStale && d.includes("observed contract-market movement")
      ? " The commercial direction appears favourable, but the underlying contract evidence remains stale — treat this as a reason to investigate rather than a negotiating conclusion."
      : " Confidence is low — treat this as a reason to investigate rather than a conclusion.";
  } else if (confidence === "low") {
    r += " Confidence is low — directional, not conclusive.";
  }
  return r;
}

/**
 * §18: whether a reading's confidence is worth telling the buyer about.
 * High and medium readings carry no caveat — stating it on every tile turned
 * the product into a confidence dashboard. Thin readings still say so,
 * because that genuinely changes how the reading should be used.
 */
export function showsConfidenceCaveat(confidence: Confidence): boolean {
  return confidence === "low" || confidence === "insufficient";
}
