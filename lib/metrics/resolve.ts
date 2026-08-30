import "server-only";
import { commercialWindowLabel } from "@/lib/metrics/canonical";
import { cache } from "react";
import {
  getAiEvents,
  getCatalog,
  getFreshness,
  getMacroReadings,
  getProcurementFlow,
  getScopeAggregates,
  getSecSummaries,
  getSignalDeltas,
  getSpineAnchor,
  getUniverse,
  getVendorDealFacts,
  getVendorPrimitives,
  getVendorSignals,
  type CatalogFacts,
  type MacroSeriesReading,
  type ProcurementFlow,
  type SecSummary,
  type SignalDelta,
  type VendorAiEvents,
  type VendorDealFacts,
  type VendorPrimitive,
  type VendorSignals,
} from "@/lib/data/facts";
import {
  getPricingModelMixByYear,
  getProcurementMonthlyFlow,
  getReputationSeries,
  type HistorySeries,
} from "@/lib/data/history";
import {
  aiCapabilityChange,
  automationState,
  capConfidenceByAge,
  deliveryCostForBand,
  deliveryCostState,
  gainShareLevel,
  headroomState,
  historyModeLabel,
  invertMove,
  newestOf,
  opportunityReason,
  pricingRead,
  procurementHeatState,
  ratioMove,
  type MacroSeriesSet,
} from "./rules";
import { BAND_LABEL, deliveryExposure } from "./exposure";
import { scopedTickers, type MarketScope } from "@/lib/market-scope";
import { formatValueMix, inferredDominates, money, count, signed, shortDate } from "@/lib/format";
import {
  type Basis,
  type Confidence,
  type FlowWindow,
  type MarketIntel,
  type Metric,
  type MetricAnalysis,
  type MetricState,
  type Movement,
  type Opportunity,
  type OpportunityLevel,
  type OpportunityType,
  type TwelveMonthDimension,
  type VendorIntel,
  type VendorMetrics,
  levelScore,
} from "./types";
import {
  AUTOMATION_COPY, BUYER_LEVERAGE_COPY, COMMERCIAL_COPY, HEAT_COPY,
  aiPressureAnalysis, demandAnalysis, deliveryCostAnalysis, exposureAnalysis,
  headroomAnalysis, intensityAnalysis, pricingAnalysis, productivityTermsAnalysis,
  readingsFrom, riskAnalysis, rollupAnalysis,
} from "./market-analysis";
import { buildWatchSignals } from "./watch";

/**
 * The canonical resolver. ONE entry point computes every buyer metric for the
 * scope; every page reads from this, so a metric cannot disagree with itself
 * across tabs. Rules are deterministic bands over real facts — no model output
 * enters this layer, and no figure is invented. Where substrate is missing the
 * state is `insufficient`, which downstream surfaces render as first-class.
 *
 * The banding constants below are internal. They are never rendered; the UI
 * shows state, movement, confidence and the underlying facts only (spec §23).
 */

const insufficientMetric = (id: string, label: string, note: string): Metric => ({
  id,
  label,
  state: "insufficient",
  movement: "insufficient",
  confidence: "insufficient",
  headline: note,
  basis: [],
  asOf: null,
});

function metric(
  id: string,
  label: string,
  state: MetricState,
  movement: Movement,
  confidence: Confidence,
  headline: string | null,
  basis: Basis[],
  asOf: string | null,
): Metric {
  return { id, label, state, movement, confidence, headline, basis, asOf };
}

/* ratioMove / invertMove now live in ./rules (pure, unit-tested). */

/* ───────────────────── per-vendor metric rules ───────────────────── */

interface VendorInputs {
  ticker: string;
  name: string;
  deals: VendorDealFacts | undefined;
  signals: VendorSignals | undefined;
  catalog: CatalogFacts | undefined;
  sec: SecSummary | undefined;
  delta: SignalDelta | undefined;
  /** Fresh public-procurement flow (market evidence; flow/context, never pricing). */
  proc: ProcurementFlow | undefined;
  /** Canonical vendor primitives (claims) — incl. EDGAR financials where listed. */
  prims: Map<string, VendorPrimitive> | undefined;
  /** AG reputation tracker's own trailing series, when present. */
  repSeries: HistorySeries | undefined;
  /** Distinct scoped vendors winning public work in the last 180 days. */
  procWinners180: number;
  /** Materiality-gated AI capability events (canonical ai_shift signals). */
  aiEvents: VendorAiEvents | undefined;
  /** Market-level macro readings (already freshness-filtered) — same for every vendor. */
  macro: MacroSeriesSet;
  /** Pre-built basis lines for the macro series that passed the freshness gate. */
  macroBasis: Basis[];
  /** Per-series basis lines, so band-aware reads cite only the series they used. */
  macroBasisBySeries: Record<string, Basis>;
  macroAsOf: string | null;
  /** Other scoped vendors active in this vendor's top service line. */
  alternativesInTopLine: number;
  scopeVendorCount: number;
  spineLastIngest: string;
  spineDataAsOf: string | null;
}

function resolveVendorMetrics(v: VendorInputs): VendorMetrics {
  const d = v.deals;
  const sig = v.signals ?? {};
  const cat = v.catalog;
  const spineNote = `award windows anchored at the contract spine's last refresh (${shortDate(v.spineLastIngest)})`;

  /* Shared inputs hoisted: EDGAR primitives, AI readiness, materiality-gated
     capability events (§6/§7), and the macro delivery-cost read (§15) feed
     several metrics below. */
  const marginPrim = v.prims?.get("operating_margin_pct");
  const cashPrim = v.prims?.get("cash_usd");
  const debtPrim = v.prims?.get("long_term_debt_usd");
  const edgarRevPrim = v.prims?.get("edgar_revenue_annual");

  const ai = cat?.aiReadinessScore ?? null;
  const aiDelta = v.delta?.aiReadinessDelta ?? null;
  const aiMove: Movement =
    aiDelta == null ? "insufficient" : aiDelta > 2 ? "improving" : aiDelta < -2 ? "deteriorating" : "stable";

  const ev = v.aiEvents;
  const materialT12 = ev?.materialT12 ?? 0;
  const highT12 = ev?.highT12 ?? 0;
  const aiChange = aiCapabilityChange({ materialT12, highT12 }, aiDelta);
  /* Events carry 12-month movement where the readiness delta alone cannot. */
  const eventMove: Movement =
    aiChange === "materially-increased" ? "materially-improving"
    : aiChange === "increased" ? "improving"
    : aiChange === "decreased" ? "deteriorating"
    : aiChange === "stable" ? "stable"
    : aiMove;
  const eventCountBasis: Basis | null =
    ev && materialT12 > 0
      ? {
          text: `${count(materialT12)} material AI capability change${materialT12 === 1 ? "" : "s"} at this vendor in the trailing 12 months${highT12 > 0 ? ` (${count(highT12)} major)` : ""}; latest ${shortDate(ev.latestDate)}. Routine announcements are excluded.`,
          source: "Material AI capability changes", ownership: "market", asOf: ev.latestDate,
        }
      : null;
  const eventBasis: Basis[] = (ev?.events ?? [])
    .filter((e) => e.materiality >= 3)
    .slice(0, 2)
    .map((e) => ({
      text: `${shortDate(e.date)}: ${e.headline}.`,
      source: "Material AI capability changes", ownership: "market" as const, asOf: e.date,
    }));
  const COMMERCIAL_MODEL_EVENTS = new Set(["pricing_model_change", "productivity_disclosure", "ai_revenue_or_bookings"]);
  const commercialModelEvent = (ev?.events ?? []).find((e) => e.materiality >= 3 && COMMERCIAL_MODEL_EVENTS.has(e.eventType)) ?? null;

  const dcRead = deliveryCostState(v.macro);

  /* Buyer leverage — observed end-of-term concentration is buyer-relevant context.
     Never framed as the reader's own negotiating window: their contract dates are unknown. */
  let buyerLeverage: Metric;
  if (!d || d.contracts === 0) {
    buyerLeverage = insufficientMetric(
      "buyerLeverage",
      "Buyer Leverage",
      "No contracts on record for this vendor — leverage cannot be assessed from the spine.",
    );
  } else {
    const basis: Basis[] = [
      {
        text: `${count(d.inPlay12)} observed agreement${d.inPlay12 === 1 ? "" : "s"} on the market record reach end-of-term within 12 months (${formatValueMix({ disclosedUsd: d.inPlay12Tcv, inferredLowUsd: d.inPlay12Inf.low, inferredMidUsd: d.inPlay12Inf.mid, inferredHighUsd: d.inPlay12Inf.high })}); ${count(d.inPlay24)} within 24 months (${formatValueMix({ disclosedUsd: d.inPlay24Tcv, inferredLowUsd: d.inPlay24Inf.low, inferredMidUsd: d.inPlay24Inf.mid, inferredHighUsd: d.inPlay24Inf.high })}).`,
        source: "Curated contract tracker (market record)", ownership: "market",
      },
    ];
    if (d.nearestEnd) {
      basis.push({
        text: `Nearest observed end-of-term: ${shortDate(d.nearestEnd)}.`,
        source: "Curated contract tracker (market record)", ownership: "market",
      });
    }
    if (v.alternativesInTopLine > 0 && d.topLines[0]) {
      basis.push({
        text: `${v.alternativesInTopLine} other selected vendor${v.alternativesInTopLine === 1 ? "" : "s"} hold observed contracts in ${d.topLines[0].line}.`,
        source: "Curated contract tracker (market record)", ownership: "market",
      });
    }
    if (v.proc && v.proc.inPlayNext12 > 0) {
      basis.push({
        text: `${count(v.proc.inPlayNext12)} observed public-sector agreements also reach end-of-term within 12 months (fresh market record).`,
        source: "Public procurement record", ownership: "market",
        asOf: v.proc.lastAwardDate,
      });
    }
    const state: MetricState =
      d.inPlay12 >= 2 || (d.inPlay12 >= 1 && v.alternativesInTopLine >= 1)
        ? "favourable"
        : d.inPlay24 >= 1
          ? "stable"
          : "unfavourable";
    const movement = ratioMove(d.inPlay12, d.expiredPast12);
    // Volume earns confidence; the spine's own data age then caps it — stale
    // contract evidence must not read confident (freeze directive §3).
    let confidence: Confidence = capConfidenceByAge(
      d.contracts >= 10 ? "high" : d.contracts >= 3 ? "medium" : "low",
      v.spineDataAsOf,
      { maxFreshDays: 120 },
    );
    // Value-provenance rule (2026-08-23): a window whose money is dominated by
    // INFERRED value cannot keep disclosed-grade confidence.
    if (inferredDominates({ disclosedUsd: d.inPlay12Tcv, inferredLowUsd: d.inPlay12Inf.low, inferredMidUsd: d.inPlay12Inf.mid, inferredHighUsd: d.inPlay12Inf.high })) {
      confidence = confidence === "high" ? "medium" : confidence === "medium" ? "low" : confidence;
    }
    buyerLeverage = metric(
      "buyerLeverage",
      "Buyer Leverage",
      state,
      movement,
      confidence,
      state === "favourable"
        ? "Observed end-of-term activity is concentrating — a favourable commercial backdrop for buyers with comparable agreements."
        : state === "stable"
          ? "Observed decision points inside 24 months — prepare rather than press."
          : "Nothing of theirs reaches a decision point soon.",
      basis,
      // Freshness = newest reliable evidence behind the read (fix 5): the
      // spine's own data-as-of plus any fresh procurement end-of-terms used.
      newestOf(v.spineDataAsOf, v.proc && v.proc.inPlayNext12 > 0 ? v.proc.lastAwardDate : null) ?? v.spineLastIngest,
    );
  }

  /* Deal market heat — fresh public-procurement flow leads when it can carry the
     read (official, refreshed within days); the curated spine remains context,
     anchored to its own data-as-of. The two corpora are never summed. */
  let dealMarketHeat: Metric;
  const procHeat = v.proc ? procurementHeatState(v.proc.awardsT90, v.proc.awardsPrior90) : { usable: false as const, state: "stable" as const, movement: "insufficient" as Movement };
  if (v.proc && procHeat.usable) {
    const basis: Basis[] = [
      {
        text: `${count(v.proc.awardsT90)} public-procurement awards in the trailing 90 days vs ${count(v.proc.awardsPrior90)} in the prior 90 (latest ${shortDate(v.proc.lastAwardDate)}). Flow evidence only — public awards never price enterprise agreements.`,
        source: "Public procurement record", ownership: "market",
        asOf: v.proc.lastAwardDate,
      },
    ];
    if (d && d.contracts >= 3) {
      basis.push({
        text: `Context from the curated spine: ${count(d.awardsT12)} observed commercial signings (${money(d.awardsT12Tcv)}) in the 12 months to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}, vs ${count(d.awardsPrior12)} (${money(d.awardsPrior12Tcv)}) prior.`,
        source: "Curated contract tracker (market record)", ownership: "market",
      });
    }
    dealMarketHeat = metric(
      "dealMarketHeat",
      "Deal Market Heat",
      procHeat.state,
      procHeat.movement,
      "medium", // official award data, fresh — but one evidence family
      procHeat.state === "favourable"
        ? "Public award flow has cooled — demand pressure is with the buyer."
        : procHeat.state === "unfavourable"
          ? "Public award flow is accelerating — capacity may be absorbed elsewhere."
          : "Public award flow broadly steady across the two windows.",
      basis,
      v.proc.lastAwardDate,
    );
  } else if (!d || d.contracts < 3) {
    dealMarketHeat = insufficientMetric(
      "dealMarketHeat",
      "Deal Market Heat",
      "Too few observed contracts or signings to read commercial deal flow for this vendor.",
    );
  } else {
    const move = ratioMove(d.awardsT12, d.awardsPrior12);
    const state: MetricState =
      move === "deteriorating" || move === "materially-deteriorating"
        ? "favourable" // cooling demand favours the buyer
        : move === "improving" || move === "materially-improving"
          ? "unfavourable"
          : "stable";
    dealMarketHeat = metric(
      "dealMarketHeat",
      "Deal Market Heat",
      state,
      move,
      "low", // spine-only read, anchored to its own data-as-of
      state === "favourable"
        ? "Their observed signing pace has slowed — demand pressure is with the buyer."
        : state === "unfavourable"
          ? "Their observed signing pace has risen — capacity may be absorbed elsewhere."
          : "Observed signing pace broadly steady across the two windows.",
      [
        {
          text: `${count(d.awardsT12)} observed signings (${money(d.awardsT12Tcv)}) in the 12 months to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}, vs ${count(d.awardsPrior12)} (${money(d.awardsPrior12Tcv)}) in the prior 12; ${spineNote}.`,
          source: "Curated contract tracker (market record)", ownership: "market",
        },
      ],
      v.spineDataAsOf ?? v.spineLastIngest,
    );
  }

  /* Pricing pressure — direction of commercial conditions a buyer can push on. */
  let pricingPressure: Metric;
  if (!d || d.contracts < 3) {
    pricingPressure = insufficientMetric(
      "pricingPressure",
      "Pricing Pressure",
      "Insufficient contract evidence to read pricing conditions for this vendor.",
    );
  } else {
    /* §14 + sprint 3 fix 3: pricing direction is INFERRED from the vendor's
       OWN evidence — their deal-market heat, competitive breadth in their
       line, and their filed margin room. The market-wide macro read is
       context only: it colours the basis, never the state, so one broad
       tailwind cannot mark the whole universe favourable. No rate, price
       point or savings figure is ever produced here. */
    const alternatives = v.alternativesInTopLine;
    const marginRoom = marginPrim != null && marginPrim.value >= 12;
    const read = pricingRead({
      heatUsable: dealMarketHeat.state !== "insufficient",
      cooling: dealMarketHeat.state === "favourable",
      stronglyCooling: dealMarketHeat.state === "favourable" && dealMarketHeat.movement === "materially-deteriorating",
      alternatives,
      marginRoom,
      macroFavourable: dcRead.state === "favourable",
    });
    const basis: Basis[] = [
      {
        text: `Commercial signing flow ${count(d.awardsT12)} vs ${count(d.awardsPrior12)} across the two 12-month windows; ${count(alternatives)} scoped alternative${alternatives === 1 ? "" : "s"} in ${d.topLines[0]?.line ?? "their top line"}.`,
        source: "Curated contract tracker (market record)", ownership: "market", asOf: v.spineDataAsOf,
      },
    ];
    if (dcRead.state !== "insufficient") {
      basis.push({
        text: `Market-wide context: underlying delivery-cost economics read ${dcRead.state === "favourable" ? "buyer-favourable" : dcRead.state === "unfavourable" ? "supplier-favourable" : dcRead.state} on the published wage, inflation and FX series — a market condition, not vendor-specific pricing evidence.`,
        source: "FRED macro series", ownership: "market", asOf: v.macroAsOf,
      });
    }
    if (marginPrim) {
      basis.push({
        text: `Operating margin ${marginPrim.value.toFixed(1)}% (SEC 10-K, period ending ${shortDate(marginPrim.asOf)})${marginRoom ? " — observed room to absorb commercial pressure" : ""}.`,
        source: "SEC EDGAR companyfacts", ownership: "market", asOf: marginPrim.asOf,
      });
    }
    // Confidence: two vendor-specific families earn medium — then the spine's
    // own data age caps it (stale tracker evidence must not read confident).
    const confidence = capConfidenceByAge(
      read.vendorFamilies >= 2 ? "medium" : "low",
      v.spineDataAsOf,
      { maxFreshDays: 120 },
    );
    pricingPressure = metric(
      "pricingPressure",
      "Pricing Pressure",
      read.state,
      dealMarketHeat.movement === "insufficient" ? "insufficient" : invertMove(dealMarketHeat.movement),
      confidence,
      read.state === "favourable"
        ? "This vendor's own record leans toward the buyer on price."
        : read.state === "mixed"
          ? "Some vendor-specific pricing conditions favour the buyer; evidence is partial."
          : read.marketContextOnly
            ? "Market-wide cost conditions favour buyers, but this vendor's own record shows no clear pricing pressure."
            : "No clear pricing pressure either way from the record.",
      basis,
      newestOf(v.spineDataAsOf, dcRead.state !== "insufficient" ? v.macroAsOf : null, marginPrim?.asOf) ?? v.spineLastIngest,
    );
  }

  /* Financial resilience — EDGAR-backed where listed (E4 regulatory facts),
     AG catalog otherwise. */
  let financialResilience: Metric;
  if (!cat || (cat.revenueUsd == null && cat.revenueGrowthYoy == null && !marginPrim)) {
    financialResilience = insufficientMetric(
      "financialResilience",
      "Financial Resilience",
      "No financial reading is held for this vendor.",
    );
  } else {
    const g = cat?.revenueGrowthYoy ?? null;
    let state: MetricState = g == null ? "mixed" : g >= 5 ? "favourable" : g >= 0 ? "stable" : "unfavourable";
    // A thin regulatory-filed margin overrides an optimistic growth read.
    if (marginPrim && marginPrim.value < 3) state = "unfavourable";
    const basis: Basis[] = [];
    if (cat?.revenueUsd != null) {
      basis.push({
        text: `Revenue ${money(cat.revenueUsd)}${g != null ? `, growth ${g.toFixed(1)}% YoY` : ""}.`,
        source: "AnalystGenius vendor catalog", ownership: "market",
        asOf: cat.sourcedAt,
      });
    } else if (g != null) {
      basis.push({ text: `Revenue growth ${g.toFixed(1)}% YoY.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
    }
    if (marginPrim) {
      basis.push({
        text: `Operating margin ${marginPrim.value.toFixed(1)}% for the period ending ${shortDate(marginPrim.asOf)} (SEC 10-K, XBRL).`,
        source: "SEC EDGAR companyfacts", ownership: "market", asOf: marginPrim.asOf,
      });
    }
    if (v.sec?.byItem["2.02"]) {
      basis.push({
        text: `${v.sec.byItem["2.02"]} results-of-operations filings (8-K item 2.02) in the last 12 months.`,
        source: "SEC 8-K",
        ownership: "market",
      });
    }
    financialResilience = metric(
      "financialResilience",
      "Financial Resilience",
      state,
      "insufficient", // a single filed period asserts no direction
      capConfidenceByAge(marginPrim ? "high" : "medium", marginPrim?.asOf ?? cat?.sourcedAt ?? null, { maxFreshDays: 400 }),
      state === "favourable"
        ? "Financially expanding on the latest reading."
        : state === "unfavourable"
          ? "Financially strained on the latest reading."
          : "Financial position broadly steady on the latest reading.",
      basis,
      marginPrim?.asOf ?? cat?.sourcedAt ?? null,
    );
  }

  /* Financial headroom — observed corporate flexibility, US-listed (EDGAR) subset.
     Never account-level profitability; absent filings stay honestly insufficient. */
  let financialHeadroom: Metric;
  {
    const h = headroomState({
      operatingMarginPct: marginPrim?.value ?? null,
      cashUsd: cashPrim?.value ?? null,
      longTermDebtUsd: debtPrim?.value ?? null,
    });
    if (h.state === "insufficient") {
      financialHeadroom = insufficientMetric(
        "financialHeadroom",
        "Financial Headroom",
        "No regulatory-filed margin or balance-sheet data is held for this vendor (coverage: US-listed subset via SEC EDGAR).",
      );
    } else {
      const basis: Basis[] = [];
      if (marginPrim)
        basis.push({ text: `Operating margin ${marginPrim.value.toFixed(1)}% (period ending ${shortDate(marginPrim.asOf)}).`, source: "SEC EDGAR companyfacts", ownership: "market", asOf: marginPrim.asOf });
      if (cashPrim)
        basis.push({ text: `Cash and equivalents ${money(cashPrim.value)} at ${shortDate(cashPrim.asOf)}.`, source: "SEC EDGAR companyfacts", ownership: "market", asOf: cashPrim.asOf });
      if (debtPrim)
        basis.push({ text: `Long-term debt ${money(debtPrim.value)} at ${shortDate(debtPrim.asOf)}.`, source: "SEC EDGAR companyfacts", ownership: "market", asOf: debtPrim.asOf });
      if (edgarRevPrim)
        basis.push({ text: `Annual revenue ${money(edgarRevPrim.value)} (period ending ${shortDate(edgarRevPrim.asOf)}).`, source: "SEC EDGAR companyfacts", ownership: "market", asOf: edgarRevPrim.asOf });
      financialHeadroom = metric(
        "financialHeadroom",
        "Financial Headroom",
        h.state,
        "insufficient", // single filed period — direction not asserted
        capConfidenceByAge("high", marginPrim?.asOf ?? cashPrim?.asOf ?? null, { maxFreshDays: 400 }),
        h.reading,
        basis,
        marginPrim?.asOf ?? cashPrim?.asOf ?? null,
      );
    }
  }

  /* Provider momentum — growth plus signing pace. Vendor-strength axis. */
  let providerMomentum: Metric;
  if (!cat && (!d || d.contracts < 3)) {
    providerMomentum = insufficientMetric(
      "providerMomentum",
      "Provider Momentum",
      "Insufficient evidence to read momentum for this vendor.",
    );
  } else {
    const g = cat?.revenueGrowthYoy ?? null;
    // Movement: fresh procurement flow when it can carry the read; spine windows otherwise.
    const movement: Movement =
      v.proc && procHeat.usable
        ? procHeat.movement
        : d && d.contracts >= 3
          ? ratioMove(d.awardsT12, d.awardsPrior12)
          : "insufficient";
    const state: MetricState =
      g != null && g >= 8 ? "favourable" : g != null && g < 0 ? "unfavourable" : g != null ? "stable" : "mixed";
    const basis: Basis[] = [];
    if (g != null) basis.push({ text: `Revenue growth ${g.toFixed(1)}% YoY.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
    if (v.proc && procHeat.usable)
      basis.push({
        text: `Public award flow ${count(v.proc.awardsT90)} vs ${count(v.proc.awardsPrior90)} across the trailing 90-day windows (latest ${shortDate(v.proc.lastAwardDate)}).`,
        source: "Public procurement record", ownership: "market", asOf: v.proc.lastAwardDate,
      });
    if (d && d.contracts >= 3)
      basis.push({ text: `Observed commercial signings ${count(d.awardsT12)} vs ${count(d.awardsPrior12)} across the two commercial-evidence windows (to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}).`, source: "Curated contract tracker (market record)", ownership: "market" });
    if (eventCountBasis) basis.push(eventCountBasis);
    const rpoPrim = v.prims?.get("rpo_backlog_usd");
    if (rpoPrim) {
      basis.push({
        text: `Contracted backlog (remaining performance obligations) ${money(rpoPrim.value)} at ${shortDate(rpoPrim.asOf)} — the provider's own disclosure definition; definitions vary and are not compared across providers.`,
        source: "SEC EDGAR companyfacts", ownership: "market", asOf: rpoPrim.asOf,
      });
    }
    providerMomentum = metric(
      "providerMomentum",
      "Provider Momentum",
      state,
      movement,
      (v.proc && procHeat.usable) || (g != null && d && d.contracts >= 3) ? "medium" : "low",
      null,
      basis,
      // Fix 5: asOf = NEWEST reliable evidence behind the read. An ancient
      // last-award date must never masquerade as the metric's freshness.
      newestOf(
        v.proc && procHeat.usable ? v.proc.lastAwardDate : null,
        cat?.sourcedAt,
        d && d.contracts >= 3 ? v.spineDataAsOf : null,
        ev?.latestDate,
      ) ?? v.spineLastIngest,
    );
  }

  /* Talent pressure — delivery-capacity strain. The sleeper signal. */
  let talentPressure: Metric;
  const talent = sig.talent;
  if (!talent || (talent.netFlow == null && talent.headcountTrend == null)) {
    talentPressure = insufficientMetric(
      "talentPressure",
      "Talent Pressure",
      "No talent reading is held for this vendor.",
    );
  } else {
    const declining = talent.headcountTrend === "declining" || (talent.netFlow != null && talent.netFlow <= -1000);
    const growing = talent.headcountTrend === "growing" || (talent.netFlow != null && talent.netFlow > 500);
    const state: MetricState = declining ? "unfavourable" : growing ? "favourable" : "stable";
    const basis: Basis[] = [
      {
        text: `Net talent flow ${signed(talent.netFlow)}; headcount ${talent.totalHeadcount != null ? count(talent.totalHeadcount) : "—"} (${talent.headcountTrend ?? "trend not stated"}).`,
        source: "AnalystGenius talent signals", ownership: "market",
        asOf: talent.sourcedAt,
      },
    ];
    if (talent.avgTenureYears != null) {
      basis.push({
        text: `Average tenure ${talent.avgTenureYears.toFixed(1)} years${talent.avgTenureSource ? ` (${talent.avgTenureSource})` : ""}.`,
        source: "AnalystGenius talent signals", ownership: "market",
        asOf: talent.sourcedAt,
      });
    }
    /* Movement from GENUINE observed snapshots (canonical claim versions). */
    let talentMove: Movement = "insufficient";
    const flowSeries = v.prims?.get("talent_net_flow")?.series;
    if (flowSeries && flowSeries.length >= 2) {
      const delta = flowSeries[flowSeries.length - 1].value - flowSeries[0].value;
      talentMove =
        delta <= -1500 ? "materially-deteriorating"
        : delta <= -250 ? "deteriorating"
        : delta >= 1500 ? "materially-improving"
        : delta >= 250 ? "improving"
        : "stable";
      basis.push({
        text: `Net-flow moved ${signed(Math.round(delta))} across ${flowSeries.length} observed snapshots since ${shortDate(flowSeries[0].calculatedAt)} (observed snapshots).`,
        source: "Canonical vendor snapshots", ownership: "market",
      });
    }
    talentPressure = metric(
      "talentPressure",
      "Talent Pressure",
      state,
      talentMove,
      "medium",
      declining
        ? "Delivery workforce is contracting — a capacity question for multi-year commitments."
        : growing
          ? "Delivery workforce is growing."
          : "Delivery workforce broadly stable.",
      basis,
      talent.sourcedAt,
    );
  }

  /* Delivery-cost economics — CALCULATED from published macro series, never a
     fabricated blended rate (§15). Sprint 3 P4: the read is BAND-AWARE — the
     vendor's evidenced delivery-location exposure selects which series apply.
     Unknown exposure falls back to the market-level read at LOW confidence
     with the fallback stated: no fake vendor precision. */
  let deliveryCostPressure: Metric;
  {
    const expo = deliveryExposure(v.ticker, cat?.hq ?? null, talent?.totalHeadcount ?? cat?.employeeCount ?? null);
    const bandKnown = expo.band !== "insufficient";
    const read = deliveryCostForBand(v.macro, expo.band === "insufficient" ? "mixed-global" : expo.band);
    if (read.state === "insufficient") {
      deliveryCostPressure = insufficientMetric(
        "deliveryCostPressure",
        "Delivery Cost Pressure",
        bandKnown
          ? `Fewer than two fresh published cost series apply to a ${BAND_LABEL[expo.band].toLowerCase()} base — no delivery-cost assessment is made.`
          : "Fewer than two fresh macro cost series are held — no delivery-cost assessment is made.",
      );
    } else {
      const basis: Basis[] = [];
      if (expo.basis) basis.push(expo.basis);
      if (!bandKnown) {
        basis.push({
          text: "Vendor delivery-location mix is not evidenced — this is the MARKET-LEVEL cost read, not a vendor-specific one.",
          source: "Coverage note", ownership: "market",
        });
      }
      for (const s of [...new Set(read.seriesUsed)]) {
        const b = v.macroBasisBySeries[s];
        if (b) basis.push(b);
      }
      if ((talent?.totalHeadcount ?? 0) >= 50_000) {
        basis.push({
          text: `Labour-heavy delivery model (headcount ${count(talent!.totalHeadcount!)}) — published wage and FX movements bear directly on their cost base.`,
          source: "AnalystGenius talent signals", ownership: "market", asOf: talent?.sourcedAt ?? null,
        });
      }
      deliveryCostPressure = metric(
        "deliveryCostPressure",
        "Delivery Cost Pressure",
        read.state,
        "insufficient", // point-in-time YoY readings; no trajectory is asserted
        bandKnown && read.signals >= 2 ? "medium" : "low",
        read.reading,
        basis,
        v.macroAsOf,
      );
    }
  }

  /* Operational risk — AG top-issues read plus disclosure-grade events. */
  let operationalRisk: Metric;
  const issues = sig.topIssues;
  if (!issues || issues.riskScore == null) {
    operationalRisk = insufficientMetric(
      "operationalRisk",
      "Operational Risk",
      "No risk analysis is held for this vendor.",
    );
  } else {
    const cyber = v.sec?.byItem["1.05"] ?? 0;
    const restructuring = v.sec?.byItem["2.05"] ?? 0;
    const score = issues.riskScore;
    const state: MetricState = score >= 70 || cyber > 0 ? "unfavourable" : score >= 55 ? "mixed" : "stable";
    const basis: Basis[] = [
      { text: `AG reads external risk at this provider as ${externalRiskBand(score)} relative to the tracked set.`, source: "AnalystGenius top issues", ownership: "market", asOf: issues.sourcedAt },
    ];
    for (const t of issues.issueTitles.slice(0, 2)) {
      basis.push({ text: t, source: "AnalystGenius top issues", ownership: "market", asOf: issues.sourcedAt });
    }
    if (cyber > 0) basis.push({ text: `${cyber} material cybersecurity incident disclosure (8-K 1.05) in 12 months.`, source: "SEC 8-K", ownership: "market" });
    if (restructuring > 0) basis.push({ text: `${restructuring} exit/disposal-cost disclosure (8-K 2.05) in 12 months.`, source: "SEC 8-K", ownership: "market" });
    operationalRisk = metric(
      "operationalRisk",
      "Operational Risk",
      state,
      "insufficient",
      issues.isStale ? "low" : "medium",
      null,
      basis,
      issues.sourcedAt,
    );
  }

  /* Reputation movement — AG reputation tracker (scores and trends only). */
  let reputationMovement: Metric;
  const rep = sig.reputation;
  if (!rep || rep.sentimentScore == null) {
    reputationMovement = insufficientMetric(
      "reputationMovement",
      "Reputation Movement",
      "No reputation reading is held for this vendor.",
    );
  } else {
    /* Movement from the tracker's OWN trailing series where present (reconstructed
       history — labelled as such), else its per-audience trend flags. */
    let movement: Movement =
      rep.trendsUp > rep.trendsDown ? "improving" : rep.trendsDown > rep.trendsUp ? "deteriorating" : "stable";
    const basis: Basis[] = [
      {
        text: `Across tracked audiences, ${rep.trendsUp} sentiment series are trending up and ${rep.trendsDown} down.`,
        source: "AnalystGenius reputation tracker", ownership: "market",
        asOf: rep.sourcedAt,
      },
    ];
    const series = v.repSeries;
    if (series && series.points.length >= 4) {
      const vals = series.points.map((p) => p.value).filter((x): x is number => x != null);
      const first = vals[0];
      const last = vals[vals.length - 1];
      if (first != null && last != null) {
        const delta = last - first;
        movement = delta >= 6 ? "improving" : delta <= -6 ? "deteriorating" : "stable";
        basis.push({
          text: `Tracker series moved ${delta >= 0 ? "+" : ""}${delta} points across its ${vals.length} most recent periods (${historyModeLabel(series.mode)}).`,
          source: series.source, ownership: "market",
        });
      }
    }
    const state: MetricState = rep.sentimentScore >= 70 ? "favourable" : rep.sentimentScore >= 50 ? "stable" : "unfavourable";
    reputationMovement = metric(
      "reputationMovement",
      "Reputation Movement",
      state,
      movement,
      "medium",
      rep.insightTitle,
      basis,
      rep.sourcedAt,
    );
  }

  /* AI productivity / automation / gain-sharing — AG AI-readiness + talent +
     materiality-gated capability events (§6/§7). A generic announcement never
     moves these: only events that cleared the upstream gate are visible here. */
  let aiProductivityOpportunity: Metric;
  if (ai == null && materialT12 === 0) {
    aiProductivityOpportunity = insufficientMetric(
      "aiProductivityOpportunity",
      "AI Productivity Opportunity",
      "No AI-capability reading and no material capability changes are held for this vendor.",
    );
  } else {
    const state: MetricState =
      ai != null && (ai >= 70 || (ai >= 55 && materialT12 >= 2))
        ? "favourable"
        : (ai != null && ai >= 50) || materialT12 >= 2
          ? "stable"
          : "mixed";
    const basis: Basis[] = [];
    if (ai != null) basis.push({ text: `AG places the AI delivery readiness of this provider ${bandAgainstTrackedSet(ai, 70, 40)}.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
    if (eventCountBasis) basis.push(eventCountBasis);
    basis.push(...eventBasis);
    aiProductivityOpportunity = metric(
      "aiProductivityOpportunity",
      "AI Productivity Opportunity",
      state,
      eventMove,
      // Confidence is EARNED by corroboration (freeze directive §7): a strong
      // readiness score confirmed by a high-materiality gated event reads
      // high; a single family reads medium; neither reads low.
      ai != null && ai >= 70 && highT12 >= 1 ? "high" : ai != null ? "medium" : "low",
      state === "favourable" && (aiChange === "materially-increased" || aiChange === "increased")
        ? "Their AI delivery capability has materially advanced over the observed 12 months — productivity assumptions set earlier deserve challenge."
        : state === "favourable"
          ? "Their AI delivery capability has advanced — productivity assumptions set earlier deserve challenge."
          : "AI capability is present but not yet decisive for productivity commitments.",
      basis,
      ev?.latestDate ?? cat?.sourcedAt ?? null,
    );
  }

  let automationOpportunity: Metric;
  {
    const labourHeavy = (talent?.totalHeadcount ?? 0) >= 50_000;
    const auto = automationState({ aiReadiness: ai, labourHeavy, materialEventsT12: materialT12 });
    if (auto === "insufficient") {
      automationOpportunity = insufficientMetric(
        "automationOpportunity",
        "Automation Opportunity",
        "No automation-capability reading and no material capability changes are held for this vendor.",
      );
    } else {
      const basis: Basis[] = [];
      if (ai != null) basis.push({ text: `AG places the AI delivery readiness of this provider ${bandAgainstTrackedSet(ai, 70, 40)}.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
      if (talent?.totalHeadcount != null) {
        basis.push({
          text: `Delivery headcount ${count(talent.totalHeadcount)} (${talent.headcountTrend ?? "trend not stated"}) — the labour base automation would displace.`,
          source: "AnalystGenius talent signals", ownership: "market",
          asOf: talent.sourcedAt,
        });
      }
      if (eventCountBasis) basis.push(eventCountBasis);
      automationOpportunity = metric(
        "automationOpportunity",
        "Automation Opportunity",
        auto,
        eventMove,
        ai != null && ai >= 70 && highT12 >= 1 && labourHeavy ? "high" : ai != null ? "medium" : "low",
        auto === "favourable"
          ? "Advanced automation capability over a labour-heavy delivery base — the buyer's benefit case is live."
          : null,
        basis,
        ev?.latestDate ?? cat?.sourcedAt ?? null,
      );
    }
  }

  let gainShareOpportunity: Metric;
  if (ai == null && talent?.netFlow == null && materialT12 === 0) {
    gainShareOpportunity = insufficientMetric(
      "gainShareOpportunity",
      "Gain-Sharing Opportunity",
      "Insufficient evidence on AI capability, labour dependency and capability events to assess gain-sharing.",
    );
  } else {
    const capabilityUp = (ai != null && ai >= 60) || aiChange === "materially-increased" || aiChange === "increased";
    const labourDown = talent?.netFlow != null && talent.netFlow < 0;
    /* A gated commercial-model event (pricing model change, productivity or
       AI-revenue disclosure) is direct evidence the vendor itself is monetising
       the productivity shift — the strongest gain-share opening we can observe. */
    const state: MetricState =
      capabilityUp && (labourDown || commercialModelEvent != null)
        ? "favourable"
        : capabilityUp || labourDown || commercialModelEvent != null
          ? "stable"
          : "mixed";
    const basis: Basis[] = [];
    if (ai != null) basis.push({ text: `AG places the AI delivery readiness of this provider ${bandAgainstTrackedSet(ai, 70, 40)}.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
    if (talent?.netFlow != null)
      basis.push({ text: `Net talent flow ${signed(talent.netFlow)} with headcount ${talent.headcountTrend ?? "trend not stated"}.`, source: "AnalystGenius talent signals", ownership: "market", asOf: talent.sourcedAt });
    if (commercialModelEvent)
      basis.push({
        text: `${shortDate(commercialModelEvent.date)}: ${commercialModelEvent.headline} — observed commercial-model evidence.`,
        source: "Material AI capability changes", ownership: "market", asOf: commercialModelEvent.date,
      });
    if (marginPrim)
      basis.push({
        text: `Financial capacity to fund gain-share structures: operating margin ${marginPrim.value.toFixed(1)}% (SEC 10-K, period ending ${shortDate(marginPrim.asOf)}).`,
        source: "SEC EDGAR companyfacts", ownership: "market", asOf: marginPrim.asOf,
      });
    gainShareOpportunity = metric(
      "gainShareOpportunity",
      "Gain-Sharing Opportunity",
      state,
      eventMove,
      // Fix 4 + freeze §7: baseline inputs alone earn low; change evidence
      // earns medium; an observed commercial-model disclosure corroborated by
      // capability or labour movement earns high.
      commercialModelEvent != null && (capabilityUp || labourDown)
        ? "high"
        : capabilityUp || labourDown || commercialModelEvent != null || materialT12 > 0
          ? "medium"
          : "low",
      state === "favourable" && commercialModelEvent
        ? "Their own disclosures monetise the productivity shift — gains exist that commercial assumptions set earlier will not reflect."
        : state === "favourable"
          ? "Delivery capability is rising while labour dependency falls — productivity gains may not yet be reflected in commercial assumptions."
          : null,
      basis,
      ev?.latestDate ?? cat?.sourcedAt ?? talent?.sourcedAt ?? null,
    );
  }

  /* Market test — are there credible scoped alternatives right now? */
  let marketTestOpportunity: Metric;
  if (!d || d.contracts === 0) {
    marketTestOpportunity = insufficientMetric(
      "marketTestOpportunity",
      "Market-Test Opportunity",
      "No contract footprint on record to define a testable market.",
    );
  } else {
    const alts = v.alternativesInTopLine;
    // Competitive breadth counts both corpora: scoped alternatives in the vendor's top
    // commercial line, and distinct scoped winners of fresh public work.
    const competitiveBreadth = Math.max(alts, v.procWinners180 > 1 ? v.procWinners180 - 1 : 0);
    const state: MetricState =
      competitiveBreadth >= 2 && d.inPlay12 >= 1 ? "favourable" : competitiveBreadth >= 1 ? "stable" : "unfavourable";
    const basis: Basis[] = [
      {
        text: `${count(alts)} other selected vendor${alts === 1 ? "" : "s"} active in ${d.topLines[0]?.line ?? "their top line"}; ${count(d.inPlay12)} of their observed agreements in the 12-month window.`,
        source: "Curated contract tracker (market record)", ownership: "market",
      },
    ];
    if (v.procWinners180 >= 2) {
      basis.push({
        text: `${count(v.procWinners180)} of the selected vendors won public work in the last 180 days — live competitive participation.`,
        source: "Public procurement record", ownership: "market",
      });
    }
    marketTestOpportunity = metric(
      "marketTestOpportunity",
      "Market-Test Opportunity",
      state,
      "insufficient",
      capConfidenceByAge("medium", v.spineDataAsOf, { maxFreshDays: 120 }),
      state === "favourable"
        ? "Credible alternatives exist in-scope while observed renewal activity concentrates."
        : state === "unfavourable"
          ? "No scoped alternative shows observed activity in their field — a test would need a wider market."
          : null,
      basis,
      v.spineDataAsOf ?? v.spineLastIngest,
    );
  }

  /* Savings opportunity — banded from leverage, pricing, heat, gain-share. */
  let savingsOpportunity: Metric;
  if (buyerLeverage.state === "insufficient") {
    savingsOpportunity = insufficientMetric(
      "savingsOpportunity",
      "Savings Opportunity",
      "Insufficient evidence for a reliable savings assessment.",
    );
  } else {
    const inputs = [
      buyerLeverage.state === "favourable",
      pricingPressure.state === "favourable" || pricingPressure.state === "mixed",
      dealMarketHeat.state === "favourable",
      gainShareOpportunity.state === "favourable",
    ].filter(Boolean).length;
    const state: MetricState = inputs >= 3 ? "favourable" : inputs === 2 ? "mixed" : "stable";
    const present = [
      buyerLeverage.state === "favourable" ? "buyer leverage" : null,
      pricingPressure.state === "favourable" || pricingPressure.state === "mixed" ? "pricing conditions" : null,
      dealMarketHeat.state === "favourable" ? "demand heat" : null,
      gainShareOpportunity.state === "favourable" ? "gain-share economics" : null,
    ].filter((x): x is string => Boolean(x));
    const spineStaleHere = v.spineDataAsOf ? (Date.now() - Date.parse(v.spineDataAsOf)) / 86_400_000 > 120 : true;
    savingsOpportunity = metric(
      "savingsOpportunity",
      "Savings Opportunity",
      state,
      buyerLeverage.movement,
      "low",
      (present.length > 0
        ? `${present.join(", ")} ${present.length === 1 ? "has" : "have"} moved in the buyer's favour`
        : "No savings precondition has clearly moved in the buyer's favour") +
        (spineStaleHere ? ", but stale contract evidence limits confidence" : "") +
        " — not a claim about your contracts.",
      [
        {
          text: `${inputs} of 4 savings preconditions present (leverage, pricing conditions, demand heat, gain-share).`,
          source: "Derived from canonical metrics", ownership: "market",
        },
      ],
      v.spineLastIngest,
    );
  }

  return {
    buyerLeverage,
    pricingPressure,
    savingsOpportunity,
    automationOpportunity,
    aiProductivityOpportunity,
    gainShareOpportunity,
    marketTestOpportunity,
    financialResilience,
    financialHeadroom,
    providerMomentum,
    talentPressure,
    deliveryCostPressure,
    dealMarketHeat,
    operationalRisk,
    reputationMovement,
    // Fix 4: evidence-floor banding for gain-sharing — levels are earned by
    // commercially meaningful change evidence, not by baseline inputs existing.
    gainShareLevelBand: gainShareLevel({
      aiReadiness: ai,
      materialEventsT12: materialT12,
      highEventsT12: highT12,
      commercialModelEvent: commercialModelEvent != null,
      labourDown: talent?.netFlow != null && talent.netFlow < 0,
      talentKnown: talent?.netFlow != null || talent?.headcountTrend != null,
      marginRoom: marginPrim != null && marginPrim.value >= 12,
    }),
  };
}

/* ───────────────────── opportunities from metrics ───────────────────── */

const stateToLevel = (m: Metric): OpportunityLevel =>
  m.state === "insufficient"
    ? "insufficient"
    : m.state === "favourable"
      ? "high"
      : m.state === "mixed"
        ? "medium"
        : m.state === "stable"
          ? "medium"
          : "low";

function opportunitiesFor(metrics: VendorMetrics, spineStale: boolean): Record<OpportunityType, Opportunity> {
  const mk = (
    type: OpportunityType,
    from: Metric,
    boost: boolean,
    investigate: string[],
  ): Opportunity => {
    let level = stateToLevel(from);
    // Very High is earned, not defaulted: a favourable state, a reinforcing
    // condition, AND better-than-low confidence. Low-confidence reads cap at
    // High so the top band keeps discriminating power.
    if (boost && level === "high" && from.confidence !== "low") level = "very-high";
    return {
      type,
      level,
      movement: from.movement,
      confidence: from.confidence,
      why: from.basis,
      investigate,
      reason: opportunityReason(level, from.confidence, from.basis, spineStale),
    };
  };

  /* Gain-sharing uses the evidence-floor band directly (fix 4): the level is
     earned by change evidence, and the metric's insufficient state wins. */
  const mkGainShare = (from: Metric, band: VendorMetrics["gainShareLevelBand"], investigate: string[]): Opportunity => {
    const level = from.state === "insufficient" ? "insufficient" : band ?? stateToLevel(from);
    return {
      type: "gain-sharing",
      level,
      movement: from.movement,
      confidence: from.confidence,
      why: from.basis,
      investigate,
      reason: opportunityReason(level, from.confidence, from.basis, spineStale),
    };
  };

  return {
    pricing: mk(
      "pricing",
      metrics.pricingPressure,
      metrics.buyerLeverage.state === "favourable",
      [
        "Rate benchmarks for the services in scope before any renewal conversation.",
        "Whether pricing of comparable agreements still reflects the demand conditions the record shows.",
      ],
    ),
    automation: mk(
      "automation",
      metrics.automationOpportunity,
      metrics.talentPressure.state === "unfavourable",
      [
        "Which labour-intensive processes in scope are now automatable on their platform.",
        "Whether staffing assumptions in agreements priced before these changes remain justified.",
      ],
    ),
    "gain-sharing": mkGainShare(
      metrics.gainShareOpportunity,
      metrics.gainShareLevelBand,
      [
        "Productivity commitments and baseline resets — buyers with agreements priced before these capability changes may have a basis to challenge them.",
        "Unit or outcome pricing where labour dependency has visibly fallen.",
        "A shared-productivity-benefit clause wherever a new term is negotiated.",
      ],
    ),
    "commercial-leverage": mk(
      "commercial-leverage",
      metrics.buyerLeverage,
      metrics.dealMarketHeat.state === "favourable",
      [
        "Their wider observed end-of-term activity — concurrent expiries strengthen a buyer's position.",
        "Timing: conversations opened while their defensive exposure is high carry more weight.",
      ],
    ),
    "market-test": mk(
      "market-test",
      metrics.marketTestOpportunity,
      false,
      [
        "A structured market test against the scoped alternatives active in the same line.",
        "Whether incumbency pricing survives a credible competitive comparison.",
      ],
    ),
  };
}

/**
 * Evidence sufficiency for RANKING purposes (calibration pass, 23 Aug 2026).
 *
 * This governs how confidently a comparative position may be asserted — it is
 * NOT a second score and never changes a metric's own state. Depth here means
 * corroboration across independent readings, deliberately NOT contract volume:
 * rewarding volume would just hand the ranking to the largest vendor, and a
 * well-supported negative conclusion should still be able to outrank a
 * deep-evidence neutral one.
 */
export function evidenceSufficiency(
  opps: Record<OpportunityType, Opportunity>,
  currentPeriodSignings: number,
): "supported" | "directional" {
  // families making a real claim on evidence that is not itself thin
  const corroborating = Object.values(opps).filter(
    (o) => (o.level === "very-high" || o.level === "high") && o.confidence !== "low" && o.confidence !== "insufficient",
  ).length;
  // No observed activity in the current window is not, on its own, a buyer
  // opportunity — absence must be corroborated before it ranks as strength.
  if (currentPeriodSignings === 0 && corroborating < 2) return "directional";
  return "supported";
}

function overallFrom(
  opps: Record<OpportunityType, Opportunity>,
  metrics: VendorMetrics,
  currentPeriodSignings: number,
): Opportunity {
  const defined = Object.values(opps).filter((o) => o.level !== "insufficient");
  let level: OpportunityLevel = "insufficient";
  if (defined.length > 0) {
    const avg = defined.reduce((a, o) => a + levelScore(o.level), 0) / defined.length;
    const max = Math.max(...defined.map((o) => levelScore(o.level)));
    const blended = Math.round(avg * 0.5 + max * 0.5);
    level = (["insufficient", "low", "medium", "high", "very-high"] as const)[Math.min(4, Math.max(1, blended))];
  }
  /* Zero-activity sanity rule: a vendor with no observed signings in the
     current window, and without corroboration from other families, may not
     present as the top band. The families keep their own states; only the
     headline claim is pulled back to what the evidence carries. */
  const sufficiency = evidenceSufficiency(opps, currentPeriodSignings);
  if (sufficiency === "directional" && level === "very-high") level = "high";
  // §9/§10: name the strongest family so the rank explains itself — vendors
  // get different commercial stories, not one universal narrative.
  const top = [...defined].sort((a, b) => levelScore(b.level) - levelScore(a.level))[0];
  const FAMILY_WORD: Record<OpportunityType, string> = {
    pricing: "pricing", automation: "automation", "gain-sharing": "gain-sharing",
    "commercial-leverage": "commercial leverage", "market-test": "market-test",
  };
  return {
    type: "commercial-leverage",
    level,
    evidenceQualifier: sufficiency === "directional" ? "directional" : undefined,
    movement: metrics.buyerLeverage.movement,
    confidence: defined.length >= 3 ? "medium" : defined.length >= 1 ? "low" : "insufficient",
    why: defined.slice(0, 2).flatMap((o) => o.why.slice(0, 1)),
    investigate: [],
    // §22: name the strongest family AND what actually distinguishes THIS
    // vendor. Listing evidence sources alone gave every vendor drawing on the
    // same families an identical sentence, which read as boilerplate.
    reason: top
      ? `Strongest lever: ${FAMILY_WORD[top.type]}. ${vendorDiscriminator(metrics, top.type) ?? top.reason ?? ""}`.trim()
      : "Insufficient evidence for a reliable opportunity read.",
  };
}

/**
 * Why THIS vendor's strongest lever is strong, in its own terms (§22).
 *
 * Two clauses: what the lever rests on, then the condition that most
 * distinguishes this vendor from peers pulling the same lever. Naming
 * evidence sources alone gave every vendor an identical sentence, which read
 * as boilerplate and defeated the comparison. Returns null when nothing
 * distinguishing is held, so the caller falls back rather than inventing a
 * difference.
 */
function vendorDiscriminator(m: VendorMetrics, lever: OpportunityType): string | null {
  const strong = (x: Metric): boolean => x.movement === "materially-improving" || x.movement === "materially-deteriorating";

  const leverClause: Record<OpportunityType, string | null> = {
    pricing: m.pricingPressure.state === "favourable" ? "Their own pricing record leans toward the buyer" : null,
    automation: m.automationOpportunity.state === "favourable" ? "Advanced automation capability sits over a labour-heavy delivery base" : null,
    "gain-sharing": "Delivery productivity is moving faster than commercial terms have followed",
    "commercial-leverage": m.buyerLeverage.state === "favourable" ? "Observed end-of-term activity is concentrating in the buyer's favour" : null,
    "market-test": "Credible alternatives are active in the same lines of work",
  };

  const secondary: Array<[boolean, string]> = [
    [m.aiProductivityOpportunity.state === "favourable" && strong(m.aiProductivityOpportunity), "their AI delivery capability has moved materially, so productivity assumptions set earlier deserve challenge"],
    [m.automationOpportunity.state === "favourable" && strong(m.automationOpportunity) && lever !== "automation", "their automation capability is advancing faster than their delivery model has repriced"],
    [m.talentPressure.state === "unfavourable", "their delivery workforce is contracting, which is a capacity question on multi-year commitments"],
    [m.dealMarketHeat.movement === "materially-deteriorating", "their observed win pace has cooled, shifting demand pressure toward the buyer"],
    [m.providerMomentum.movement === "materially-deteriorating", "their commercial momentum is deteriorating on the latest readings"],
    [m.financialHeadroom.state === "favourable", "their margin position leaves observed room for commercial flexibility"],
    [m.operationalRisk.state === "unfavourable", "their operational risk reading is unfavourable, which belongs in any continuity discussion"],
  ];

  const lead = leverClause[lever];
  const tail = secondary.find(([hit]) => hit)?.[1] ?? null;
  if (!lead && !tail) return null;
  if (!lead) return `${tail!.charAt(0).toUpperCase()}${tail!.slice(1)}.`;
  return tail ? `${lead}, and ${tail}.` : `${lead}.`;
}

/** A reading this vendor genuinely supports: a stable key, and how it reads. */
interface Discriminator {
  key: string;
  /** Used when this reading sets the vendor apart from the market. */
  distinct: string;
  /** Used when the market shares it — named, but not claimed as distinguishing. */
  shared: string;
}

/**
 * Every reading this vendor genuinely supports.
 *
 * Commercial exposure is included because §11 names it as a legitimate
 * distinction and it was the missing half of several: IBM carries substantial
 * renewal exposure alongside deteriorating momentum, a combination held by 8
 * vendors in 66, and neither reading alone said anything a peer did not.
 */
function discriminatorCandidates(m: VendorMetrics, lever: OpportunityType, coverage: VendorIntel["coverage"]): Discriminator[] {
  const strong = (x: Metric): boolean => x.movement === "materially-improving" || x.movement === "materially-deteriorating";
  return ([
    [m.aiProductivityOpportunity.state === "favourable" && strong(m.aiProductivityOpportunity), "ai",
      "their AI delivery capability has moved materially, so productivity assumptions set earlier deserve challenge",
      "AI delivery capability on the move"],
    [m.automationOpportunity.state === "favourable" && strong(m.automationOpportunity) && lever !== "automation", "automation",
      "their automation capability is advancing faster than their delivery model has repriced",
      "automation capability advancing"],
    [m.talentPressure.state === "unfavourable", "talent",
      "their delivery workforce is contracting, which is a capacity question on multi-year commitments",
      "a contracting delivery workforce"],
    [(coverage?.inPlay12 ?? 0) >= 5, "exposure",
      "an unusual share of their observed agreements reach end-of-term inside twelve months",
      "several agreements reaching end-of-term inside twelve months"],
    [m.dealMarketHeat.movement === "materially-deteriorating", "winPace",
      "their observed win pace has cooled, shifting demand pressure toward the buyer",
      "a cooling win pace"],
    [m.providerMomentum.movement === "materially-deteriorating", "momentum",
      "their commercial momentum is deteriorating on the latest readings",
      "deteriorating commercial momentum"],
    [m.financialHeadroom.state === "favourable", "margin",
      "their margin position leaves observed room for commercial flexibility",
      "margin room for commercial flexibility"],
    [m.operationalRisk.state === "unfavourable", "opRisk",
      "their operational risk reading is unfavourable, which belongs in any continuity discussion",
      "an unfavourable operational risk reading"],
    [m.financialResilience.state === "favourable", "finExpanding",
      "their financial position is expanding on the latest reading",
      "an expanding financial position"],
    /* This clause fired for nobody: it tested for "materially-deteriorating",
       a movement the reputation metric never emits — its values are
       deteriorating / stable / improving. Nineteen vendors were carrying a
       deteriorating reputation reading that no differentiation could see. The
       20% cap still keeps it out of single-clause distinctions; it earns its
       place only in a pairing. */
    [m.reputationMovement.movement === "deteriorating", "reputation",
      "their reputation reading is deteriorating",
      "a deteriorating reputation reading"],
  ] as Array<[boolean, string, string, string]>)
    .filter(([hit]) => hit)
    .map(([, key, distinct, shared]) => ({ key, distinct, shared }));
}

/** A reading held by at most this share of the market is distinctive. */
const DISTINCT_SINGLE_SHARE = 0.2;
/** A pairing held by at most this share is distinctive even when each half is common. */
const DISTINCT_PAIR_SHARE = 0.125;

/**
 * Say what actually separates each provider — or say honestly that nothing does.
 *
 * The previous pass claimed each clause exclusively for the first vendor that
 * supported it. With nine clauses and 66 vendors that capped distinctiveness at
 * nine by construction, and which vendors got one was decided by iteration
 * order rather than by evidence. 48 of 66 fell through to "Its readings are
 * similar to others in this market" — a sentence that answers the one question
 * Vendor Detail exists to answer with nothing at all. IBM sat in that group
 * while carrying nine agreements in play worth $2.1bn against deteriorating
 * momentum.
 *
 * Distinctiveness is a property of the market, not of who was processed first,
 * so it is measured: a reading held by a fifth of the market says little, while
 * a pairing held by an eighth says a great deal even when each half is common.
 * Where nothing separates a provider the readings it does hold are still named,
 * with the question they leave open — and where there are no readings at all,
 * that thinness is itself the finding. No vendor is forced to sound unique, and
 * none is left with filler.
 */
function differentiateReasons(vendors: VendorIntel[]): void {
  if (vendors.length < 2) return;
  const FAMILY_WORD: Record<OpportunityType, string> = {
    pricing: "pricing", automation: "automation", "gain-sharing": "gain-sharing",
    "commercial-leverage": "commercial leverage", "market-test": "market-test",
  };

  const profile = new Map<string, Discriminator[]>();
  for (const v of vendors) {
    const defined = Object.values(v.opportunities).filter((o) => o.level !== "insufficient");
    const top = [...defined].sort((a, b) => levelScore(b.level) - levelScore(a.level))[0];
    profile.set(v.ticker, top ? discriminatorCandidates(v.metrics, top.type, v.coverage) : []);
  }

  const singleCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const list of profile.values()) {
    const keys = list.map((d) => d.key).sort();
    for (const k of keys) singleCount.set(k, (singleCount.get(k) ?? 0) + 1);
    for (let a = 0; a < keys.length; a += 1)
      for (let b = a + 1; b < keys.length; b += 1) {
        const p = `${keys[a]}|${keys[b]}`;
        pairCount.set(p, (pairCount.get(p) ?? 0) + 1);
      }
  }
  const n = vendors.length;
  const singleCap = Math.max(1, Math.floor(n * DISTINCT_SINGLE_SHARE));
  const pairCap = Math.max(1, Math.floor(n * DISTINCT_PAIR_SHARE));

  for (const v of vendors) {
    const list = profile.get(v.ticker) ?? [];
    const defined = Object.values(v.opportunities).filter((o) => o.level !== "insufficient");
    const top = [...defined].sort((a, b) => levelScore(b.level) - levelScore(a.level))[0];
    if (!top) continue;
    const head = `Strongest lever: ${FAMILY_WORD[top.type]}.`;

    if (list.length === 0) {
      /* §16 — thin evidence is a finding in its own right, not a gap to paper over. */
      v.overall.reason =
        `${head} No market reading currently separates this provider from the selected peer set, and published evidence is thinner here than for peers — the immediate task is verification rather than commercial inference.`;
      continue;
    }

    const rarestSingle = list.reduce((best, d) =>
      (singleCount.get(d.key) ?? n) < (singleCount.get(best.key) ?? n) ? d : best, list[0]!);
    let rarestPair: { a: Discriminator; b: Discriminator; count: number } | null = null;
    for (let a = 0; a < list.length; a += 1)
      for (let b = a + 1; b < list.length; b += 1) {
        const key = [list[a]!.key, list[b]!.key].sort().join("|");
        const c = pairCount.get(key) ?? n;
        if (!rarestPair || c < rarestPair.count) rarestPair = { a: list[a]!, b: list[b]!, count: c };
      }

    const singleIsDistinct = (singleCount.get(rarestSingle.key) ?? n) <= singleCap;
    const pairIsDistinct = rarestPair !== null && rarestPair.count <= pairCap;

    if (pairIsDistinct && (!singleIsDistinct || rarestPair!.count < (singleCount.get(rarestSingle.key) ?? n))) {
      /* §13 — the combination carries what neither half does. Stated as
         co-occurrence, never as cause. */
      /* Both halves read as noun phrases so the pair joins cleanly; the
         `distinct` wording is a full clause and only works on its own. */
      v.overall.reason =
        `${head} Unlike most of this market, it combines ${rarestPair!.a.shared} with ${rarestPair!.b.shared} — a pairing worth taking into any commercial discussion.`;
    } else if (singleIsDistinct) {
      const t = rarestSingle.distinct;
      v.overall.reason = `${head} Unlike most of this market, ${t}.`;
    } else {
      /* §15 — market-typical readings, named, with the question they leave. */
      const named = list.slice(0, 2).map((d) => d.shared);
      v.overall.reason =
        `${head} Its readings — ${named.join(" and ")} — are shared across much of this market, so nothing here separates this provider commercially; the useful question is whether that shared position is reflected in the terms currently on offer.`;
    }
  }
}

/* ───────────────────── market rollups ───────────────────── */

function rollup(
  id: string,
  label: string,
  vendorMetrics: Metric[],
  favourableReading: string,
  unfavourableReading: string,
): Metric {
  const assessed = vendorMetrics.filter((m) => m.state !== "insufficient");
  if (assessed.length === 0) {
    return insufficientMetric(id, label, "Insufficient evidence across the selected vendors.");
  }
  const states = { favourable: 0, stable: 0, unfavourable: 0, mixed: 0 };
  for (const m of assessed) states[m.state as keyof typeof states] += 1;
  const n = assessed.length;
  const state: MetricState =
    states.favourable > n / 2
      ? "favourable"
      : states.unfavourable > n / 2
        ? "unfavourable"
        : states.favourable + states.unfavourable === 0
          ? "stable"
          : "mixed";
  const moves = assessed.map((m) => m.movement).filter((m) => m !== "insufficient");
  const up = moves.filter((m) => m.includes("improving")).length;
  const down = moves.filter((m) => m.includes("deteriorating")).length;
  const movement: Movement = moves.length === 0 ? "insufficient" : up > down ? "improving" : down > up ? "deteriorating" : "stable";
  const confs: Confidence[] = ["high", "medium", "low"];
  const confidence = confs.find((c) => assessed.every((m) => m.confidence === c)) ??
    (assessed.some((m) => m.confidence === "low") ? "low" : "medium");
  // §17: divergence is analyst signal, not noise — say when the read is uneven.
  const divergent = states.favourable > 0 && states.unfavourable > 0;
  /* A state with no sentence beside it asks the buyer to infer the meaning
     from a chip and a count, which is the hierarchy this product inverts. Five
     of nine market readings rendered that way. Mixed is a real condition --
     the market is split, and which side a provider sits on is the question --
     and stable is a real answer to "has anything moved". */
  const splitReading =
    states.favourable > 0 && states.unfavourable > 0
      ? `The market is split on this: ${states.favourable} of ${n} read favourably for buyers and ${states.unfavourable} against, so it is a provider-by-provider question rather than a market-wide one.`
      : states.unfavourable > 0
        ? `No provider reads favourably for buyers here, and ${states.unfavourable} of ${n} read against — treat this as a market-wide condition rather than a lever against any one provider.`
        : states.favourable > 0
          ? `${states.favourable} of ${n} providers read favourably for buyers and none read against, so any advantage here is concentrated in those providers rather than available across the market.`
          : `Nothing in the selected market separates providers on this reading, so it is unlikely to be where commercial advantage sits this period.`;
  const baseReading =
    state === "favourable" ? favourableReading
      : state === "unfavourable" ? unfavourableReading
        : splitReading;
  return metric(
    id,
    label,
    state,
    movement,
    confidence,
    divergent
      ? `${baseReading ? baseReading + " " : ""}Uneven across the selected vendors — favourable for ${states.favourable}, unfavourable for ${states.unfavourable}.`
      : baseReading,
    [
      {
        text: `${states.favourable} of ${n} assessed vendors favourable, ${states.unfavourable} unfavourable, ${states.stable + states.mixed} steady or mixed.`,
        source: "Derived from canonical metrics", ownership: "market",
      },
    ],
    null,
  );
}

/* ───────────────────── macro freshness gate (§15/§29) ───────────────────── */

const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/** Per-series staleness ceilings (days), matched to publication cadence. */
const MACRO_FRESH_DAYS: Record<string, number> = {
  ECIWAG: 220, // quarterly wage index + publication lag
  CPIAUCSL: 120, // monthly US CPI
  INDCPIALLMINMEI: 260, // monthly India CPI, long OECD source lag
  DEXINUS: 45, // daily FX
  DEXUSEU: 45, // daily FX — USD per EUR
  DEXUSUK: 45, // daily FX — USD per GBP
};

/**
 * Builds the market-level MacroReading once per resolve. A series that fails
 * its freshness ceiling is dropped entirely (null) rather than silently kept —
 * deliveryCostState then honestly reports "insufficient" below two signals.
 */
function buildMacroInputs(map: Map<string, MacroSeriesReading>): {
  macro: MacroSeriesSet;
  macroBasis: Basis[];
  macroBasisBySeries: Record<string, Basis>;
  macroAsOf: string | null;
} {
  const today = Date.now();
  const fresh = (id: string): MacroSeriesReading | null => {
    const r = map.get(id);
    if (!r || r.yoyPct == null) return null;
    const age = (today - Date.parse(r.latestDate)) / 86_400_000;
    return age <= (MACRO_FRESH_DAYS[id] ?? 120) ? r : null;
  };
  const wage = fresh("ECIWAG");
  const usCpi = fresh("CPIAUCSL");
  const inCpi = fresh("INDCPIALLMINMEI");
  const fx = fresh("DEXINUS");
  const eur = fresh("DEXUSEU");
  const gbp = fresh("DEXUSUK");

  const macroBasisBySeries: Record<string, Basis> = {};
  if (wage)
    macroBasisBySeries.ECIWAG = { text: `US employment cost index ${signedPct(wage.yoyPct!)} YoY (period ending ${shortDate(wage.latestDate)}).`, source: "FRED — BLS Employment Cost Index", ownership: "market", asOf: wage.latestDate };
  if (usCpi)
    macroBasisBySeries.CPIAUCSL = { text: `US CPI ${signedPct(usCpi.yoyPct!)} YoY (period ending ${shortDate(usCpi.latestDate)}).`, source: "FRED — US CPI", ownership: "market", asOf: usCpi.latestDate };
  if (inCpi)
    macroBasisBySeries.INDCPIALLMINMEI = { text: `India CPI ${signedPct(inCpi.yoyPct!)} YoY (period ending ${shortDate(inCpi.latestDate)}).`, source: "FRED — OECD India CPI", ownership: "market", asOf: inCpi.latestDate };
  if (fx)
    macroBasisBySeries.DEXINUS = {
      text: `INR moved ${signedPct(fx.yoyPct!)} vs USD over 12 months (${fx.yoyPct! >= 0 ? "rupee weakened — offshore delivery cheaper in USD terms" : "rupee strengthened — offshore delivery dearer in USD terms"}; as of ${shortDate(fx.latestDate)}).`,
      source: "FRED — INR/USD daily rate", ownership: "market", asOf: fx.latestDate,
    };
  if (eur)
    macroBasisBySeries.DEXUSEU = {
      text: `EUR moved ${signedPct(eur.yoyPct!)} vs USD over 12 months (${eur.yoyPct! >= 0 ? "euro strengthened — European delivery dearer in USD terms" : "euro weakened — European delivery cheaper in USD terms"}; as of ${shortDate(eur.latestDate)}).`,
      source: "FRED — USD/EUR daily rate", ownership: "market", asOf: eur.latestDate,
    };
  if (gbp)
    macroBasisBySeries.DEXUSUK = {
      text: `GBP moved ${signedPct(gbp.yoyPct!)} vs USD over 12 months (as of ${shortDate(gbp.latestDate)}).`,
      source: "FRED — USD/GBP daily rate", ownership: "market", asOf: gbp.latestDate,
    };

  const core = [wage, usCpi, inCpi, fx];
  const dates = [...core, eur, gbp].filter(Boolean).map((r) => r!.latestDate);
  return {
    macro: {
      usWageYoY: wage?.yoyPct ?? null,
      usCpiYoY: usCpi?.yoyPct ?? null,
      indiaCpiYoY: inCpi?.yoyPct ?? null,
      inrPerUsdYoY: fx?.yoyPct ?? null,
      eurPerUsdYoY: eur?.yoyPct ?? null,
      gbpPerUsdYoY: gbp?.yoyPct ?? null,
    },
    macroBasis: (["ECIWAG", "CPIAUCSL", "INDCPIALLMINMEI", "DEXINUS"] as const)
      .map((k) => macroBasisBySeries[k])
      .filter((b): b is Basis => Boolean(b)),
    macroBasisBySeries,
    macroAsOf: dates.length ? dates.sort().at(-1)! : null,
  };
}

/* ───────────────────── the resolver ───────────────────── */


/**
 * Does a narrative-reality record agree with itself?
 *
 * The AG narrative-reality signal carries both a `direction` label and a
 * headline explaining it, and on some records they say opposite things.
 * Accenture is labelled "over-hyped" while its headline reads "narrative and
 * reality are close — matching recognized revenue conversion within one
 * quarter" (gap score 15). Cognizant is labelled "aligned" while its headline
 * calls it "the most under-recognized provider in AG's tracking set". Wipro is
 * "aligned" while its headline says the narrative is "running hotter than the
 * reality signals". Four records across three of the largest providers a buyer
 * is likely to be managing.
 *
 * The right label is not recoverable here — on Accenture the gap score agrees
 * with the headline, on Wipro it agrees with the direction — so this does not
 * guess. It withholds the record from buyer-facing synthesis and leaves the
 * source untouched for upstream repair. A contradictory judgement about a
 * provider is worse than no judgement: the buyer cannot tell which half to act
 * on, and one visible contradiction discredits the rest.
 */
const NRG_OVER = /running hotter|ahead of (?:its|the) (?:reality|delivery)|narrative outpaces|over-?claim|louder than/i;
const NRG_UNDER = /under-?recognis|under-?recogniz|under-?distribut|under-?stated|under-?appreciat|executing above/i;
const NRG_ALIGNED = /broadly aligned|are close|aligns with|matching|consistent with|in line with/i;

export function narrativeRecordIsSelfConsistent(direction: string | null, headline: string | null): boolean {
  if (!direction || !headline) return false;
  const implied = [
    NRG_OVER.test(headline) ? "over-hyped" : null,
    NRG_UNDER.test(headline) ? "under-recognized" : null,
    NRG_ALIGNED.test(headline) ? "aligned" : null,
  ].filter(Boolean);
  /* Silent or genuinely ambiguous headlines are left alone; only a headline
     that clearly states one thing while the label states another is withheld. */
  if (implied.length !== 1) return true;
  return implied[0] === direction;
}


/**
 * AG's proprietary indices are analytical inputs, not buyer-facing readings.
 *
 * Five basis lines were publishing them verbatim -- "AG AI-readiness 53/100",
 * "AG risk score 74/100", "Sentiment 65/100". A number on an undisclosed scale
 * tells a buyer nothing they can verify, act on, or take to a supplier, and
 * inviting them to reason about it exposes methodology the product does not
 * sell. The scores keep driving states, opportunities and rankings exactly as
 * before; only their rendering changes, to the qualitative reading the score
 * already stands for.
 */
function bandAgainstTrackedSet(score: number, high: number, low: number): string {
  if (score >= high) return "among the stronger of the tracked set";
  if (score <= low) return "among the weaker of the tracked set";
  return "in the middle of the tracked set";
}


/**
 * External risk, said plainly.
 *
 * This read "among the weaker of the tracked set", which inverts badly on a
 * risk scale -- weaker risk is ambiguous where weaker capability is not -- and
 * it carried "(upstream marks this analysis stale)" into the line Vendor
 * Detail prints as "Current risk to the buyer". Staleness is a property of the
 * record, not a thing to tell a buyer mid-sentence; it stays on `asOf`.
 */
function externalRiskBand(score: number): string {
  if (score >= 70) return "elevated";
  if (score <= 40) return "contained";
  return "middling";
}


/**
 * What a movement in award flow means for a buyer.
 *
 * Services Demand was the sharpest reading in the product -- public awards
 * down from 146 to 12 across a quarter -- and it rendered as a state chip and
 * a count with no sentence saying why that matters. Demand falling is the
 * condition under which providers compete hardest, which is the whole point of
 * watching it.
 */
function demandReading(movement: Movement): string | null {
  if (movement.includes("deteriorating")) {
    return "Award flow into this market has fallen — providers are competing for less new work, which is the backdrop buyers negotiate against.";
  }
  if (movement.includes("improving")) {
    return "Award flow into this market has risen — providers have more work to choose between, which usually firms their commercial position.";
  }
  return null;
}

export const resolveIntelligence = cache(async (scopeJson: string): Promise<MarketIntel> => {
  const scope = JSON.parse(scopeJson) as MarketScope;
  const universe = await getUniverse();
  const universeTickers = universe.map((u) => u.ticker);
  const tickers = scopedTickers(scope, universeTickers);
  const key = [...tickers].sort().join(",");

  const [deals, signals, catalog, sec, deltas, agg, anchor, freshness, proc, prims, repSeries, procMonthly, pricingMix, aiEvents, macroMap] =
    await Promise.all([
      getVendorDealFacts(key),
      getVendorSignals(key),
      getCatalog(key),
      getSecSummaries(key),
      getSignalDeltas(key),
      getScopeAggregates(key),
      getSpineAnchor(),
      getFreshness(),
      getProcurementFlow(key),
      getVendorPrimitives(key),
      getReputationSeries(key),
      getProcurementMonthlyFlow(key),
      getPricingModelMixByYear(key),
      getAiEvents(key),
      getMacroReadings(),
    ]);

  const { macro, macroBasis, macroBasisBySeries, macroAsOf } = buildMacroInputs(macroMap);

  /* Alternatives: which scoped vendors share a top service line. */
  const topLineOf = new Map<string, string | null>();
  for (const t of tickers) topLineOf.set(t, deals.get(t)?.topLines[0]?.line ?? null);
  const lineCounts = new Map<string, number>();
  for (const line of topLineOf.values()) {
    if (line) lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
  }
  // A vendor's alternatives = scoped vendors holding ANY contracts in its top line.
  const vendorsPerLine = new Map<string, number>();
  for (const t of tickers) {
    for (const l of deals.get(t)?.topLines ?? []) {
      vendorsPerLine.set(l.line, (vendorsPerLine.get(l.line) ?? 0) + 1);
    }
  }

  const nameOf = new Map(universe.map((u) => [u.ticker, u.name]));

  const vendors: VendorIntel[] = tickers.map((ticker) => {
    const d = deals.get(ticker);
    const topLine = d?.topLines[0]?.line ?? null;
    const alternatives = topLine ? Math.max(0, (vendorsPerLine.get(topLine) ?? 1) - 1) : 0;
    const metrics = resolveVendorMetrics({
      ticker,
      name: nameOf.get(ticker) ?? ticker,
      deals: d,
      signals: signals.get(ticker),
      catalog: catalog.get(ticker),
      sec: sec.get(ticker),
      delta: deltas.get(ticker),
      proc: proc.byVendor.get(ticker),
      prims: prims.get(ticker),
      repSeries: repSeries.get(ticker),
      procWinners180: proc.distinctWinners180,
      aiEvents: aiEvents.get(ticker),
      macro,
      macroBasis,
      macroBasisBySeries,
      macroAsOf,
      alternativesInTopLine: alternatives,
      scopeVendorCount: tickers.length,
      spineLastIngest: anchor.lastIngest,
      spineDataAsOf: anchor.dataAsOf,
    });
    const opportunities = opportunitiesFor(metrics, (anchor.dataAgeDays ?? 999) > 120);
    const nrg = signals.get(ticker)?.nrg;
    const asOfs = [
      catalog.get(ticker)?.sourcedAt,
      signals.get(ticker)?.talent?.sourcedAt,
      signals.get(ticker)?.topIssues?.sourcedAt,
    ].filter((x): x is string => Boolean(x));
    return {
      ticker,
      name: nameOf.get(ticker) ?? ticker,
      coverage: {
        contracts: d?.contracts ?? 0,
        inPlay12: d?.inPlay12 ?? 0,
        inPlay24: d?.inPlay24 ?? 0,
        inPlay12DisclosedUsd: d?.inPlay12Tcv ?? null,
        inPlay12Inferred: d
          ? inferredDominates({
              disclosedUsd: d.inPlay12Tcv,
              inferredLowUsd: d.inPlay12Inf.low,
              inferredMidUsd: d.inPlay12Inf.mid,
              inferredHighUsd: d.inPlay12Inf.high,
            })
          : false,
        signingsT12: d?.awardsT12 ?? 0,
        signingsPrior12: d?.awardsPrior12 ?? 0,
        hasSignals: signals.has(ticker),
        hasSec: sec.has(ticker),
      },
      metrics,
      opportunities,
      overall: overallFrom(opportunities, metrics, d?.awardsT12 ?? 0),
      perception: (() => {
        const sent = signals.get(ticker)?.sentiment;
        if (!sent || (!sent.summary && (sent.earlyWarnings ?? []).length === 0)) return null;
        /* Highest urgency wins; ties break toward the nearer horizon. Only
           trusted issues reach here -- withheld providers carry none. */
        const issues = [...(signals.get(ticker)?.topIssues?.namedIssues ?? [])].sort(
          (a, b) => (b.urgency ?? 0) - (a.urgency ?? 0) || (a.timeHorizon === "near-term" ? -1 : 1),
        );
        const top = issues[0];
        return {
          summary: sent.summary ?? null,
          earlyWarnings: sent.earlyWarnings ?? [],
          asOf: sent.sourcedAt ?? null,
          topIssue: top ? { name: top.name, category: top.category, timeHorizon: top.timeHorizon } : null,
        };
      })(),
      claimsVsDelivery:
        nrg && narrativeRecordIsSelfConsistent(nrg.direction, nrg.headline)
          ? { direction: nrg.direction, headline: nrg.headline, asOf: nrg.generatedAt ?? nrg.sourcedAt }
          : null,
      lastUpdated: asOfs.sort().at(-1) ?? anchor.lastIngest,
    };
  });

  /* Rank by level, then let evidence sufficiency break ties. Sufficiency only
     separates vendors already on the same band — it never promotes a weaker
     conclusion above a stronger one, which would be volume bias. */
  vendors.sort((a, b) => {
    const byLevel = levelScore(b.overall.level) - levelScore(a.overall.level);
    if (byLevel !== 0) return byLevel;
    const rank = (v: VendorIntel): number => (v.overall.evidenceQualifier === "directional" ? 1 : 0);
    return rank(a) - rank(b);
  });
  differentiateReasons(vendors);

  /* §11/§12 — comparative differentiation: why manage THIS vendor differently.
     Superlatives use the selected market only (or the supported universe when
     Whole Market is selected); no ranking is asserted without evidence. */
  {
    const scopeWord = scope.mode === "whole_market" ? "across the supported universe" : "in your selected market";
    const FAMILY_WORD: Record<OpportunityType, string> = {
      pricing: "pricing", automation: "automation", "gain-sharing": "gain-sharing",
      "commercial-leverage": "commercial leverage", "market-test": "market-test",
    };
    const FAMILIES = Object.keys(FAMILY_WORD) as OpportunityType[];
    // unique per-family leaders (ties assert nothing)
    const leaders = new Map<OpportunityType, string>();
    for (const f of FAMILIES) {
      const scored = vendors
        .map((v) => ({ t: v.ticker, s: levelScore(v.opportunities[f].level) }))
        .filter((x) => x.s >= 2) // medium or better — weak leads earn no superlative
        .sort((a, b) => b.s - a.s);
      if (scored.length >= 1 && (scored.length === 1 || scored[0]!.s > scored[1]!.s)) leaders.set(f, scored[0]!.t);
    }
    // unique resilience leader
    const RES_RANK: Record<string, number> = { favourable: 3, stable: 2, mixed: 1, unfavourable: 0 };
    const res = vendors
      .map((v) => ({ t: v.ticker, s: RES_RANK[v.metrics.financialResilience.state] ?? -1 }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    const resLeader = res.length >= 2 && res[0]!.s > res[1]!.s ? res[0]!.t : null;

    for (const v of vendors) {
      const defined = FAMILIES.map((f) => v.opportunities[f]).filter((o) => o.level !== "insufficient");
      if (defined.length === 0 || vendors.length < 2) {
        v.differentiation = {
          strongest: defined.length === 0 ? "Insufficient evidence for a reliable relative ranking." : `Strongest lever: ${FAMILY_WORD[defined.sort((a, b) => levelScore(b.level) - levelScore(a.level))[0]!.type]}.`,
          weakest: null, keyChange: null,
          relatives: vendors.length < 2 ? ["Only one vendor in scope — no relative ranking is possible."] : ["Insufficient evidence for a reliable relative ranking."],
          risk: null, discuss: null,
        };
        continue;
      }
      const ranked = [...defined].sort((a, b) => levelScore(b.level) - levelScore(a.level));
      const strongest = ranked[0]!;
      const weakest = ranked[ranked.length - 1]!;
      const relatives: string[] = [];
      for (const [f, t] of leaders) {
        if (t === v.ticker) relatives.push(`Strongest ${FAMILY_WORD[f]} opportunity ${scopeWord}.`);
      }
      if (resLeader === v.ticker) relatives.push(`Highest financial resilience among the selected vendors.`);
      if (relatives.length === 0) relatives.push("No unique leadership position — evidence supports no reliable superlative for this vendor.");
      // most important 12-month change: the strongest fresh movement
      const MOVE_RANK: Record<string, number> = { "materially-improving": 2, "materially-deteriorating": 2, improving: 1, deteriorating: 1 };
      const moving = (Object.values(v.metrics).filter((m) => m && typeof m === "object") as Metric[])
        .filter((m) => MOVE_RANK[m.movement])
        .sort((a, b) => (MOVE_RANK[b.movement]! - MOVE_RANK[a.movement]!) || ((b.asOf ?? "").localeCompare(a.asOf ?? "")));
      const keyChange = moving[0]
        ? `${moving[0].label} ${moving[0].movement.replace(/-/g, " ")}${moving[0].basis[0] ? ` — ${moving[0].basis[0].text}` : ""}`
        : null;
      /* basis[0] on operational risk is the internal score line. It must never
         be the buyer-facing sentence — prefer a NAMED issue or disclosure, and
         fall back to a plain statement rather than exposing a score. */
      const riskLine = v.metrics.operationalRisk.basis
        .map((b) => b.text)
        .find((t) => !/^AG risk score/i.test(t));
      const risk =
        v.metrics.operationalRisk.state === "unfavourable"
          ? riskLine ?? "Elevated operational risk on the current record."
          : v.metrics.talentPressure.state === "unfavourable"
            ? "Delivery workforce is contracting — capacity risk on multi-year commitments."
            : null;
      v.differentiation = {
        /* The reason usually opens with the same level word, so the
           parenthetical repeated it ("pricing (very high). Very high — ..."). */
        strongest: (() => {
          const lvl = strongest.level.replace(/-/g, " ");
          const reason = strongest.reason ?? "";
          const repeats = reason.toLowerCase().startsWith(lvl.toLowerCase());
          return `Strongest lever: ${FAMILY_WORD[strongest.type]}${repeats ? "" : ` (${lvl})`}. ${reason}`.trim();
        })(),
        weakest: weakest !== strongest ? `Weakest lever: ${FAMILY_WORD[weakest.type]} (${weakest.level.replace(/-/g, " ")}).` : null,
        keyChange,
        relatives,
        risk,
        discuss: strongest.investigate[0] ?? null,
      };
    }
  }

  const m = (sel: (v: VendorIntel) => Metric) => vendors.map(sel);

  const strip = {
    /* A market CONDITION, not an economic force: it belongs with delivery
       resilience, never under buyer economics. Declared here so the shape
       matches MarketIntel["strip"]; the analysis is attached below. */
    operationalRisk: rollup(
      "m.oprisk", "Operational Risk", m((v) => v.metrics.operationalRisk),
      "No elevated operational risk across your market.",
      "Elevated operational risk across your market.",
    ),
    buyerLeverage: rollup(
      "m.buyerLeverage", "Buyer Leverage", m((v) => v.metrics.buyerLeverage),
      "Decision windows are open across your market.",
      "Little of your market reaches a decision point soon.",
    ),
    pricingPressure: rollup(
      "m.pricingPressure", "Pricing Pressure", m((v) => v.metrics.pricingPressure),
      "Pricing conditions lean toward the buyer.",
      "Pricing conditions favour the vendors.",
    ),
    automationOpportunity: rollup(
      "m.automation", "Automation Opportunity", m((v) => v.metrics.automationOpportunity),
      "Automation capability across your market has outrun old delivery assumptions.",
      "Automation capability is not yet decisive in your market.",
    ),
    commercialOpportunities: rollup(
      "m.commercial", "Commercial Opportunities",
      vendors.map((v) => ({
        ...v.metrics.buyerLeverage,
        state: (v.overall.level === "very-high" || v.overall.level === "high"
          ? "favourable"
          : v.overall.level === "medium"
            ? "mixed"
            : v.overall.level === "insufficient"
              ? "insufficient"
              : "stable") as MetricState,
      })),
      "Material commercial opportunity exists across your selected vendors.",
      "Commercial opportunity is limited across your selected vendors right now.",
    ),
    marketHeat: rollup(
      "m.heat", "Market Heat", m((v) => v.metrics.dealMarketHeat),
      "Demand has cooled across your market — conditions favour the buyer.",
      "Demand is heating across your market.",
    ),
    servicesDemand: (() => {
      // Fresh public award flow carries demand when it can (§13); the spine is context.
      if (proc.totalT90 + proc.totalPrior90 >= 5) {
        const move = ratioMove(proc.totalT90, proc.totalPrior90);
        return metric(
          "m.demand", "Services Demand",
          move.includes("deteriorating") ? "unfavourable" : move.includes("improving") ? "favourable" : "stable",
          move, "medium", demandReading(move),
          [{
            text: `${count(proc.totalT90)} public awards to selected vendors in the trailing 90 days vs ${count(proc.totalPrior90)} in the prior 90 (public record, refreshed ${shortDate(proc.lastIngest)}).`,
            source: "Public procurement record", ownership: "market", asOf: proc.lastIngest,
          }],
          proc.lastIngest,
        );
      }
      if (agg.contracts === 0) return insufficientMetric("m.demand", "Services Demand", "No contract evidence in scope.");
      const move = ratioMove(agg.awardsT12, agg.awardsPrior12);
      return metric(
        "m.demand", "Services Demand",
        move.includes("deteriorating") ? "unfavourable" : move.includes("improving") ? "favourable" : "stable",
        move, "low", demandReading(move),
        [{
          text: `${count(agg.awardsT12)} observed commercial signings across ${count(agg.awardsT12Vendors)} vendors in the 12 months to ${shortDate(anchor.dataAsOf ?? anchor.lastIngest)}, vs ${count(agg.awardsPrior12)} across ${count(agg.awardsPrior12Vendors)} in the prior 12.`,
          source: "Curated contract tracker (market record)", ownership: "market",
        }],
        anchor.dataAsOf ?? anchor.lastIngest,
      );
    })(),
    competitiveIntensity: (() => {
      if (agg.contracts === 0) return insufficientMetric("m.intensity", "Competitive Intensity", "No contract evidence in scope.");
      const move = ratioMove(agg.awardsT12Vendors, agg.awardsPrior12Vendors);
      return metric(
        "m.intensity", "Competitive Intensity",
        move.includes("improving") ? "favourable" : move.includes("deteriorating") ? "unfavourable" : "stable",
        move, "low", null,
        [{
          text: `${count(agg.awardsT12Vendors)} scoped vendors won work in the current window vs ${count(agg.awardsPrior12Vendors)} in the prior window.`,
          source: "Curated contract tracker (market record)", ownership: "market",
        }],
        anchor.lastIngest,
      );
    })(),
    aiProductivityPressure: rollup(
      "m.aiPressure", "AI Productivity Pressure", m((v) => v.metrics.aiProductivityOpportunity),
      "AI capability in your market should now be changing what buyers pay for.",
      "AI capability is not yet repricing delivery in your market.",
    ),
  };

  /* ── market-state explanations (§20 depth upgrade) ───────────────────
     Attached from the SAME resolved objects the cards, charts, Analyst
     Insight and signals read, so an explanation can never disagree with the
     state it explains. The builders select drivers and phrase; they never
     recalculate. ── */
  const mv = (sel: (v: VendorIntel) => Metric) =>
    vendors.map((v) => ({ name: v.name, metric: sel(v) }));
  const byName = new Map(vendors.map((v) => [v.name, v.ticker]));
  const rankBy = (pick: (t: string) => number | null | undefined) => (name: string) => {
    const t = byName.get(name);
    return t ? pick(t) ?? null : null;
  };

  const withAnalysis = (metricValue: Metric, analysis: MetricAnalysis | undefined): Metric =>
    analysis ? { ...metricValue, analysis } : metricValue;

  /* The band shows these four and the Market grid does not, so they would
     otherwise carry no explanation anywhere. Analysed on the strip objects
     themselves, so band and grid can never diverge. */
  strip.buyerLeverage = withAnalysis(
    strip.buyerLeverage,
    rollupAnalysis(readingsFrom(mv((v) => v.metrics.buyerLeverage)), strip.buyerLeverage.state, BUYER_LEVERAGE_COPY),
  );
  strip.automationOpportunity = withAnalysis(
    strip.automationOpportunity,
    rollupAnalysis(readingsFrom(mv((v) => v.metrics.automationOpportunity)), strip.automationOpportunity.state, AUTOMATION_COPY),
  );
  strip.commercialOpportunities = withAnalysis(
    strip.commercialOpportunities,
    rollupAnalysis(
      // same derivation the rollup itself uses: the vendor's overall band
      vendors.map((v) => ({
        name: v.name,
        state: (v.overall.level === "very-high" || v.overall.level === "high"
          ? "favourable"
          : v.overall.level === "medium"
            ? "mixed"
            : v.overall.level === "insufficient"
              ? "insufficient"
              : "stable") as MetricState,
        rank: levelScore(v.overall.level),
      })),
      strip.commercialOpportunities.state,
      COMMERCIAL_COPY,
    ),
  );
  strip.marketHeat = withAnalysis(
    strip.marketHeat,
    rollupAnalysis(readingsFrom(mv((v) => v.metrics.dealMarketHeat)), strip.marketHeat.state, HEAT_COPY),
  );
  strip.pricingPressure = withAnalysis(
    strip.pricingPressure,
    pricingAnalysis(readingsFrom(mv((v) => v.metrics.pricingPressure)), strip.pricingPressure.state),
  );
  strip.aiProductivityPressure = withAnalysis(
    strip.aiProductivityPressure,
    aiPressureAnalysis(readingsFrom(mv((v) => v.metrics.aiProductivityOpportunity)), strip.aiProductivityPressure.state),
  );
  strip.competitiveIntensity = withAnalysis(
    strip.competitiveIntensity,
    agg.contracts === 0
      ? undefined
      : intensityAnalysis(agg.awardsT12Vendors, agg.awardsPrior12Vendors, tickers.length, strip.competitiveIntensity.state),
  );
  strip.servicesDemand = withAnalysis(
    strip.servicesDemand,
    agg.contracts === 0
      ? undefined
      : demandAnalysis(
          {
            // mirrors the canonical rule in strip.servicesDemand exactly
            ledBy: proc.totalT90 + proc.totalPrior90 >= 5 ? "procurement" : "commercial",
            t12: agg.awardsT12,
            prior12: agg.awardsPrior12,
            vendorsT12: agg.awardsT12Vendors,
            perVendor: vendors.map((v) => ({
              name: v.name,
              t12: deals.get(v.ticker)?.awardsT12 ?? 0,
              prior12: deals.get(v.ticker)?.awardsPrior12 ?? 0,
            })),
            procPerVendor: vendors.map((v) => ({
              name: v.name,
              t90: proc.byVendor.get(v.ticker)?.awardsT90 ?? 0,
              prior90: proc.byVendor.get(v.ticker)?.awardsPrior90 ?? 0,
            })),
            procT90: proc.totalT90,
            procPrior90: proc.totalPrior90,
            asOf: shortDate(anchor.dataAsOf ?? anchor.lastIngest),
            procAsOf: proc.lastIngest ? shortDate(proc.lastIngest) : null,
          },
          strip.servicesDemand.state,
        ),
  );

  const oprisk = strip.operationalRisk;

  /* ── Buyer economics ───────────────────────────────────────────────────
     A distinct analytical layer from Market State. Market State says WHAT
     conditions are changing; this says what those conditions do to the
     buyer's commercial position ECONOMICALLY. Nothing here repeats a strip
     reading: pricing, demand, intensity and AI pressure stay above, and
     operational risk is a delivery condition that sits with delivery
     resilience, not an economic force. ── */

  // A. What is happening to the cost of delivering the work.
  const deliveryCost = rollup(
    "m.deliveryCost", "Delivery Cost Economics", m((v) => v.metrics.deliveryCostPressure),
    "Published cost inputs are easing across the selected market.",
    "Published cost inputs are rising across the selected market.",
  );

  // B. Whether suppliers can afford to invest or concede.
  const headroom = rollup(
    "m.headroom", "Supplier Financial Headroom", m((v) => v.metrics.financialHeadroom),
    "Filed positions show room to fund investment or concession.",
    "Filed positions show little room to fund investment or concession.",
  );

  // C. How much observed commercial value enters a negotiation-sensitive
  //    window, and how concentrated it is. Counts and value are canonical;
  //    disclosed and inferred value stay separate via formatValueMix.
  const exposure = (() => {
    if (agg.contracts === 0) {
      return insufficientMetric("m.exposure", "Commercial Exposure", "No contract evidence in scope.");
    }
    const perVendor = vendors
      .map((v) => ({ name: v.name, n: deals.get(v.ticker)?.inPlay12 ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const total = agg.inPlay12;
    const topShare = total > 0 && perVendor[0] ? perVendor[0].n / total : 0;
    const state: MetricState =
      total === 0 ? "unfavourable" : total >= Math.max(3, vendors.length) ? "favourable" : "stable";
    return metric(
      "m.exposure", "Commercial Exposure", state,
      ratioMove(agg.inPlay12, agg.expiredPast12), agg.inPlay12Tcv != null ? "medium" : "low",
      null,
      [{
        text: `${count(total)} observed agreement${total === 1 ? "" : "s"} reach end-of-term within 12 months across the selected market (${formatValueMix({ disclosedUsd: agg.inPlay12Tcv, inferredLowUsd: agg.inPlay12Inf.low, inferredMidUsd: agg.inPlay12Inf.mid, inferredHighUsd: agg.inPlay12Inf.high })}); ${count(agg.inPlay24)} within 24 months.`,
        source: "Curated contract tracker (market record)", ownership: "market",
      }],
      anchor.dataAsOf ?? anchor.lastIngest,
    );
  })();

  // D. Whether provider productivity is running ahead of how they charge.
  const productivityTerms = (() => {
    const capability = strip.aiProductivityPressure.state;
    const automation = strip.automationOpportunity.state;
    if (capability === "insufficient" && automation === "insufficient") {
      return insufficientMetric("m.prodTerms", "Productivity vs Commercial Terms",
        "No substantiated capability movement is held for the selected vendors.");
    }
    const capabilityMoving = capability === "favourable" || automation === "favourable";
    const withShare = pricingMix.points.filter((pt) => pt.value != null);
    const first = withShare[0];
    const last = withShare[withShare.length - 1];
    const shareMoved = first && last && last.value != null && first.value != null
      ? Math.abs(last.value - first.value) >= 2
      : null;
    /* Four real cases, not two: a gap only exists where capability moved and
       terms did not. "Neither moved" is no gap at all, and must not read as
       though productivity were lagging. */
    const state: MetricState =
      shareMoved === null
        ? "mixed"
        : capabilityMoving && !shareMoved
          ? "favourable"
          : capabilityMoving && shareMoved
            ? "stable"
            : !capabilityMoving && shareMoved
              ? "unfavourable"
              : "mixed";
    const basis: Basis[] = [];
    if (first && last && first.value != null && last.value != null) {
      basis.push({
        text: `Consumption/outcome-shaped share of observed agreements ${first.value}% (${first.period}) → ${last.value}% (${last.period}).`,
        source: pricingMix.source, ownership: "market",
      });
    }
    return metric(
      "m.prodTerms", "Productivity vs Commercial Terms", state, "insufficient",
      withShare.length >= 2 ? "medium" : "low", null, basis,
      anchor.dataAsOf ?? anchor.lastIngest,
    );
  })();

  const economicsDimensions: Metric[] = [
    withAnalysis(
      deliveryCost,
      deliveryCostAnalysis(
        readingsFrom(mv((v) => v.metrics.deliveryCostPressure)),
        deliveryCost.state,
        vendors.filter((v) => v.metrics.deliveryCostPressure.basis.some((b) => /not evidenced/i.test(b.text))).length,
        vendors.length,
      ),
    ),
    withAnalysis(
      headroom,
      headroomAnalysis(
        readingsFrom(mv((v) => v.metrics.financialHeadroom), rankBy((t) => prims.get(t)?.get("operating_margin_pct")?.value)),
        headroom.state,
      ),
    ),
    withAnalysis(
      exposure,
      agg.contracts === 0
        ? undefined
        : exposureAnalysis(
            {
              total: agg.inPlay12,
              prior: agg.expiredPast12,
              within24: agg.inPlay24,
              value: formatValueMix({
                disclosedUsd: agg.inPlay12Tcv,
                inferredLowUsd: agg.inPlay12Inf.low,
                inferredMidUsd: agg.inPlay12Inf.mid,
                inferredHighUsd: agg.inPlay12Inf.high,
              }),
              valueIsInferred: inferredDominates({
                disclosedUsd: agg.inPlay12Tcv,
                inferredLowUsd: agg.inPlay12Inf.low,
                inferredMidUsd: agg.inPlay12Inf.mid,
                inferredHighUsd: agg.inPlay12Inf.high,
              }),
              perVendor: vendors
                .map((v) => ({ name: v.name, n: deals.get(v.ticker)?.inPlay12 ?? 0 }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n),
              topByValue: (() => {
                // concentration judged on DISCLOSED value, matching the chart
                const byValue = vendors
                  .map((v) => ({ name: v.name, usd: v.coverage.inPlay12DisclosedUsd ?? 0 }))
                  .filter((x) => x.usd > 0)
                  .sort((a, b) => b.usd - a.usd);
                const totalUsd = byValue.reduce((a, b) => a + b.usd, 0);
                return byValue[0] && totalUsd > 0
                  ? { name: byValue[0].name, share: byValue[0].usd / totalUsd }
                  : null;
              })(),
              asOf: shortDate(anchor.dataAsOf ?? anchor.lastIngest),
            },
            exposure.state,
          ),
    ),
    withAnalysis(
      productivityTerms,
      productivityTermsAnalysis(
        {
          capability: strip.aiProductivityPressure.state,
          automation: strip.automationOpportunity.state,
          gainShare: readingsFrom(mv((v) => v.metrics.gainShareOpportunity)),
          labour: readingsFrom(mv((v) => v.metrics.talentPressure)),
          shareFirst: pricingMix.points.filter((pt) => pt.value != null)[0] ?? null,
          shareLast: pricingMix.points.filter((pt) => pt.value != null).slice(-1)[0] ?? null,
          coverage: pricingMix.coverage
            ? `${count(pricingMix.coverage.classifiedCount)} of ${count(pricingMix.coverage.observedCount)} observed agreements carrying a commercial-model classification`
            : null,
        },
        productivityTerms.state,
      ),
    ),
  ].filter((x) => x.state !== "insufficient" || x.basis.length > 0);
  strip.operationalRisk = withAnalysis(
    oprisk,
    riskAnalysis(
      {
        readings: readingsFrom(
          mv((v) => v.metrics.operationalRisk),
          rankBy((t) => signals.get(t)?.topIssues?.riskScore),
        ),
        topics: vendors.map((v) => ({
          name: v.name,
          titles: signals.get(v.ticker)?.topIssues?.issueTitles?.slice(0, 2) ?? [],
          cyber: sec.get(v.ticker)?.byItem["1.05"] ?? 0,
          restructuring: sec.get(v.ticker)?.byItem["2.05"] ?? 0,
        })),
      },
      oprisk.state,
      oprisk.confidence,
    ),
  );

  const buyerEconomics = (() => {
    const assessed = economicsDimensions.filter((x) => x.state !== "insufficient");
    const fav = assessed.filter((x) => x.state === "favourable").length;
    const unf = assessed.filter((x) => x.state === "unfavourable").length;
    const state: MetricState =
      assessed.length === 0 ? "insufficient" : fav > unf + 1 ? "favourable" : unf > fav + 1 ? "unfavourable" : "mixed";
    const movement: Movement = strip.buyerLeverage.movement;
    return { state, movement, dimensions: economicsDimensions };
  })();

  /* ── 12-month change — reconstructed from dated observations, plus GENUINE
     observed snapshots where the canonical ledger holds ≥2 versions (§9/§15).
     Every row states its mode; reconstructed history is never presented as
     contemporaneous calculation. Quality gates (documented, §14): a direction
     is asserted only from ≥2 dated points; sub-threshold series say so. ── */
  const trackedSince = [...deltas.values()].map((d) => d.trackedSince).filter(Boolean).sort()[0] ?? null;

  const seriesDelta = (metricName: string): { moved: number; assessed: number; net: number } => {
    let moved = 0;
    let assessed = 0;
    let net = 0;
    for (const t of tickers) {
      const s = prims.get(t)?.get(metricName)?.series;
      if (!s || s.length < 2) continue;
      assessed++;
      const d0 = s[s.length - 1].value - s[0].value;
      if (d0 !== 0) {
        moved++;
        net += d0;
      }
    }
    return { moved, assessed, net };
  };

  const qSum = (series: HistorySeries, fromIdx: number, toIdx: number): number =>
    series.points.slice(fromIdx, toIdx).reduce((a, p) => a + (p.value ?? 0), 0);

  const changes: TwelveMonthDimension[] = [];
  /* The SAME two movements as numbers, for the Market page's deal-flow
     visual. Assigned inside the identical blocks and from the identical
     expressions as the rows below, so the chart and the prose can never
     drift apart. Nothing here recomputes anything. */
  let flowCommercial: FlowWindow | null = null;
  let flowProcurement: FlowWindow | null = null;

  {
    /* CANONICAL commercial deal flow (metric registry: commercialDealFlow).
       Reads the SAME resolved rolling-12-month result the Vendors tab shows,
       rather than recomputing from calendar quarters against a different
       anchor — the defect that produced 66 vs 51 here and 56 vs 59 there
       from one dataset. Per-vendor figures sum to this total by construction. */
    const recent = agg.awardsT12;
    const prior = agg.awardsPrior12;
    if (recent + prior > 0) {
      changes.push({
        dimension: "Deal flow (commercial)",
        metricId: "m.demand",
        state: recent < prior ? "favourable" : recent > prior ? "unfavourable" : "stable",
        movement: ratioMove(recent, prior),
        detail: `${count(recent)} observed signings across the selected market in the ${commercialWindowLabel(anchor.dataAsOf, shortDate)}, vs ${count(prior)} in the prior 12 months.`,
        confidence: "medium",
        source: "Contract market record",
      });
      flowCommercial = {
        prior,
        current: recent,
        priorWindow: "Prior 12 months",
        currentWindow: "Current 12 months",
        asOf: anchor.dataAsOf ? shortDate(anchor.dataAsOf) : null,
        source: "Contract market record",
        confidence: "medium",
      };
    }
  }

  {
    // Public award flow — the fresh series.
    if (proc.totalT90 + proc.totalPrior90 >= 5) {
      changes.push({
        dimension: "Deal flow (public procurement)",
        metricId: "m.demand",
        state: proc.totalT90 < proc.totalPrior90 ? "favourable" : proc.totalT90 > proc.totalPrior90 ? "unfavourable" : "stable",
        movement: ratioMove(proc.totalT90, proc.totalPrior90),
        detail: `${count(proc.totalT90)} public awards to selected vendors in the trailing 90 days vs ${count(proc.totalPrior90)} in the prior 90 (${historyModeLabel(procMonthly.mode)}; flow evidence, never enterprise pricing).`,
        confidence: "medium",
        source: procMonthly.source,
      });
      flowProcurement = {
        prior: proc.totalPrior90,
        current: proc.totalT90,
        priorWindow: "Prior 90 days",
        currentWindow: "Trailing 90 days",
        asOf: proc.lastIngest ? shortDate(proc.lastIngest) : null,
        source: procMonthly.source,
        confidence: "medium",
      };
    }
  }

  {
    // Commercial-model mix — the observable gain-sharing precondition.
    // §10: absence in this dataset is never absence in the market; the row
    // carries its own coverage so the reader can weigh the claim.
    const withShare = pricingMix.points.filter((p) => p.value != null);
    const cov = pricingMix.coverage;
    const covNote = cov
      ? ` Coverage: ${count(cov.classifiedCount)} of ${count(cov.observedCount)} observed agreements in the window carry a commercial-model classification (${cov.coverageQuality}) — a dataset-scoped read, not a market-wide one.`
      : "";
    if (withShare.length >= 2) {
      const first = withShare[0];
      const last = withShare[withShare.length - 1];
      const delta = Number(((last.value ?? 0) - (first.value ?? 0)).toFixed(1));
      changes.push({
        dimension: "Pricing economics (commercial model)",
        state: "mixed",
        movement: delta > 1 ? "improving" : delta < -1 ? "deteriorating" : "stable",
        detail: `Consumption/outcome-shaped share of observed agreements ${first.value}% (${first.period}, n=${first.n}) → ${last.value}% (${last.period}, n=${last.n}) (${historyModeLabel(pricingMix.mode)}). Rate-LEVEL movement remains unverifiable from the record.${covNote}`,
        confidence: cov && cov.coverageQuality !== "weak" ? "low" : "insufficient",
        source: pricingMix.source,
      });
    } else {
      changes.push({
        dimension: "Pricing economics",
        state: "insufficient",
        movement: "insufficient",
        detail: `Commercial contract evidence is as of ${shortDate(anchor.dataAsOf)} — rate-level movement over the retrospective window cannot be evidenced.`,
        confidence: "insufficient",
        source: "Curated contract spine (market record)",
      });
    }
  }

  {
    // Talent — genuine observed snapshots from the canonical ledger.
    const t = seriesDelta("talent_net_flow");
    changes.push({
      dimension: "Talent pressure",
        metricId: "talentPressure",
      state: t.net < 0 ? "unfavourable" : "stable",
      movement: t.assessed === 0 ? "insufficient" : t.net < -500 ? "deteriorating" : t.net > 500 ? "improving" : "stable",
      detail:
        t.assessed === 0
          ? `Observed snapshots begin ${shortDate(trackedSince)} — movement will accrue from the canonical ledger.`
          : `Net talent flow moved for ${t.moved} of ${t.assessed} vendors with ≥2 canonical snapshots (observed snapshots since ${shortDate(trackedSince)}).`,
      confidence: t.assessed >= 2 ? "medium" : "low",
      source: "Canonical vendor snapshots · AG talent signals",
    });
  }

  {
    // AI capability — materiality-gated events (12-month view) plus observed
    // snapshots of the AG AI-readiness primitive as they accrue.
    const a = seriesDelta("ai_readiness");
    let evTotal = 0;
    let evVendors = 0;
    let evLatest: string | null = null;
    for (const e of aiEvents.values()) {
      if (e.materialT12 > 0) {
        evTotal += e.materialT12;
        evVendors++;
      }
      if (e.latestDate && (!evLatest || e.latestDate > evLatest)) evLatest = e.latestDate;
    }
    const eventLine =
      evTotal > 0
        ? `${count(evTotal)} material AI capability changes across ${count(evVendors)} selected vendors in the trailing 12 months (latest ${shortDate(evLatest)}; routine announcements excluded; evidence collected to that date).`
        : `No material AI capability changes in the observed 12-month dataset${evLatest ? ` (collection currently ends ${shortDate(evLatest)})` : ""} — a dataset statement, not a market one.`;
    const snapshotLine =
      a.assessed === 0
        ? ` AI-readiness snapshots begin ${shortDate(trackedSince)}; a full 12-month readiness series is still accruing.`
        : ` AI-readiness moved for ${a.moved} of ${a.assessed} vendors across canonical snapshots (observed snapshots).`;
    changes.push({
      dimension: "AI delivery capability",
        metricId: "aiProductivityOpportunity",
      state: evTotal > 0 || a.moved > 0 ? "mixed" : "stable",
      movement:
        evVendors >= 2 ? "improving"
        : evTotal > 0 ? "stable"
        : a.assessed === 0 ? "insufficient"
        : a.net > 0 ? "improving" : a.net < 0 ? "deteriorating" : "stable",
      detail: eventLine + snapshotLine,
      confidence: evTotal > 0 ? "medium" : "low",
      source: "Material AI capability changes · Vendor readings",
    });
  }

  {
    // Delivery-cost economics — published macro series, market-level.
    const dcMarket = deliveryCostState(macro);
    if (dcMarket.state === "insufficient") {
      changes.push({
        dimension: "Delivery-cost economics",
        state: "insufficient",
        movement: "insufficient",
        detail: "Fewer than two fresh published cost series (wage index, CPI, FX) are held — no delivery-cost movement is asserted.",
        confidence: "insufficient",
        source: "FRED macro series (BLS · OECD · FX)",
      });
    } else {
      changes.push({
        dimension: "Delivery-cost economics",
        state: dcMarket.state,
        movement: "insufficient", // YoY point readings; no trajectory asserted
        detail: `${dcMarket.reading ?? ""} Read from ${count(dcMarket.signals)} published series (as of ${shortDate(macroAsOf)}): ${macroBasis.map((b) => b.text).join(" ")}`,
        confidence: dcMarket.signals >= 3 ? "medium" : "low",
        source: "FRED macro series (BLS · OECD · FX)",
      });
    }
  }

  {
    // Reputation — the tracker's own trailing series (reconstructed).
    let assessed = 0;
    let netShift = 0;
    for (const t of tickers) {
      const s = repSeries.get(t);
      if (!s || s.points.length < 4) continue;
      const vals = s.points.map((p) => p.value).filter((x): x is number => x != null);
      if (vals.length < 4) continue;
      assessed++;
      netShift += vals[vals.length - 1] - vals[0];
    }
    if (assessed > 0) {
      changes.push({
        dimension: "Reputation",
        metricId: "reputationMovement",
        state: netShift < -6 * assessed ? "unfavourable" : "stable",
        movement: netShift > 4 * assessed ? "improving" : netShift < -4 * assessed ? "deteriorating" : "stable",
        detail: `Mean tracker-series shift ${netShift >= 0 ? "+" : ""}${Math.round(netShift / assessed)} points across ${assessed} vendors (reconstructed from the AG tracker's own trailing series).`,
        confidence: "low",
        source: "AnalystGenius reputation tracker",
      });
    }
  }

  {
    // Buyer leverage inputs — expiry pipeline vs recent endings (both corpora shown separately).
    changes.push({
      dimension: "Buyer leverage",
        metricId: "buyerLeverage",
      state: agg.inPlay12 > agg.expiredPast12 ? "favourable" : agg.inPlay12 === 0 ? "unfavourable" : "stable",
      movement: ratioMove(agg.inPlay12, agg.expiredPast12),
      detail: `Across your selected market (${count(tickers.length)} vendor${tickers.length === 1 ? "" : "s"}), ${count(agg.inPlay12)} observed commercial agreements reach end-of-term in the next 12 months (${formatValueMix({ disclosedUsd: agg.inPlay12Tcv, inferredLowUsd: agg.inPlay12Inf.low, inferredMidUsd: agg.inPlay12Inf.mid, inferredHighUsd: agg.inPlay12Inf.high })}) vs ${count(agg.expiredPast12)} that ended in the last 12 — market record, not the reader's contracts.`,
      confidence: "medium",
      source: "Curated contract tracker (market record)",
    });
  }

  const names = tickers.map((t) => nameOf.get(t) ?? t);
  const updatedAt = freshness.map((f) => f.lastSeen).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;

  const intel: MarketIntel = {
    scope: {
      mode: scope.mode === "whole_market" ? "whole_market" : "selected_vendors",
      tickers,
      names,
    },
    baselineStart: scope.baselineStart,
    updatedAt,
    spine: anchor,
    strip,
    buyerEconomics,
    vendors,
    changes,
    dealFlow: { commercial: flowCommercial, procurement: flowProcurement },
    watch: [],
    signalTrackingSince: trackedSince,
  };

  intel.watch = await buildWatchSignals(intel, key);
  return intel;
});
