import "server-only";
import { cache } from "react";
import {
  getCatalog,
  getFreshness,
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
  type ProcurementFlow,
  type SecSummary,
  type SignalDelta,
  type VendorDealFacts,
  type VendorPrimitive,
  type VendorSignals,
} from "@/lib/data/facts";
import {
  getPricingModelMixByYear,
  getProcurementMonthlyFlow,
  getReputationSeries,
  getSpineQuarterlyFlow,
  type HistorySeries,
} from "@/lib/data/history";
import {
  capConfidenceByAge,
  headroomState,
  historyModeLabel,
  invertMove,
  procurementHeatState,
  ratioMove,
} from "./rules";
import { scopedTickers, type MarketScope } from "@/lib/market-scope";
import { money, count, signed, shortDate } from "@/lib/format";
import {
  type Basis,
  type Confidence,
  type MarketIntel,
  type Metric,
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
        text: `${count(d.inPlay12)} observed agreement${d.inPlay12 === 1 ? "" : "s"} on the market record reach end-of-term within 12 months (${money(d.inPlay12Tcv)}); ${count(d.inPlay24)} within 24 months (${money(d.inPlay24Tcv)}).`,
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
    const confidence: Confidence = d.contracts >= 10 ? "high" : d.contracts >= 3 ? "medium" : "low";
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
      v.spineLastIngest,
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
        text: `Context from the curated spine: ${count(d.awardsT12)} observed commercial awards (${money(d.awardsT12Tcv)}) in the 12 months to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}, vs ${count(d.awardsPrior12)} (${money(d.awardsPrior12Tcv)}) prior.`,
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
      "Too few observed contracts or awards to read deal flow for this vendor.",
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
          text: `${count(d.awardsT12)} observed awards (${money(d.awardsT12Tcv)}) in the 12 months to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}, vs ${count(d.awardsPrior12)} (${money(d.awardsPrior12Tcv)}) in the prior 12; ${spineNote}.`,
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
    const cooling = dealMarketHeat.state === "favourable";
    const alternatives = v.alternativesInTopLine;
    const state: MetricState = cooling && alternatives >= 1 ? "favourable" : cooling || alternatives >= 2 ? "mixed" : "stable";
    pricingPressure = metric(
      "pricingPressure",
      "Pricing Pressure",
      state,
      dealMarketHeat.movement === "insufficient" ? "insufficient" : invertMove(dealMarketHeat.movement),
      "low",
      state === "favourable"
        ? "Conditions lean toward the buyer on price."
        : state === "mixed"
          ? "Some pricing conditions favour the buyer; evidence is partial."
          : "No clear pricing pressure either way from the record.",
      [
        {
          text: `Award flow ${count(d.awardsT12)} vs ${count(d.awardsPrior12)} across the two 12-month windows; ${count(alternatives)} scoped alternative${alternatives === 1 ? "" : "s"} in ${d.topLines[0]?.line ?? "their top line"}.`,
          source: "Curated contract tracker (market record)", ownership: "market",
        },
      ],
      v.spineLastIngest,
    );
  }

  /* Financial resilience — EDGAR-backed where listed (E4 regulatory facts),
     AG catalog otherwise. */
  const marginPrim = v.prims?.get("operating_margin_pct");
  const cashPrim = v.prims?.get("cash_usd");
  const debtPrim = v.prims?.get("long_term_debt_usd");
  const edgarRevPrim = v.prims?.get("edgar_revenue_annual");

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
      basis.push({ text: `Observed commercial awards ${count(d.awardsT12)} vs ${count(d.awardsPrior12)} across the two spine windows (to ${shortDate(v.spineDataAsOf ?? v.spineLastIngest)}).`, source: "Curated contract tracker (market record)", ownership: "market" });
    providerMomentum = metric(
      "providerMomentum",
      "Provider Momentum",
      state,
      movement,
      (v.proc && procHeat.usable) || (g != null && d && d.contracts >= 3) ? "medium" : "low",
      null,
      basis,
      v.proc?.lastAwardDate ?? cat?.sourcedAt ?? v.spineLastIngest,
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

  const deliveryCostPressure = insufficientMetric(
    "deliveryCostPressure",
    "Delivery Cost Pressure",
    "No delivery-cost or rate data is held — no assessment is made.",
  );

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
      { text: `AG risk score ${score}/100${issues.isStale ? " (upstream marks this analysis stale)" : ""}.`, source: "AnalystGenius top issues", ownership: "market", asOf: issues.sourcedAt },
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
        text: `Sentiment ${rep.sentimentScore}/100 across tracked audiences; ${rep.trendsUp} trending up, ${rep.trendsDown} down.`,
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

  /* AI productivity / automation / gain-sharing — AG AI-readiness + talent. */
  const ai = cat?.aiReadinessScore ?? null;
  const aiDelta = v.delta?.aiReadinessDelta ?? null;
  const aiMove: Movement =
    aiDelta == null ? "insufficient" : aiDelta > 2 ? "improving" : aiDelta < -2 ? "deteriorating" : "stable";

  let aiProductivityOpportunity: Metric;
  if (ai == null) {
    aiProductivityOpportunity = insufficientMetric(
      "aiProductivityOpportunity",
      "AI Productivity Opportunity",
      "No AI-capability reading is held for this vendor.",
    );
  } else {
    const state: MetricState = ai >= 70 ? "favourable" : ai >= 50 ? "stable" : "mixed";
    aiProductivityOpportunity = metric(
      "aiProductivityOpportunity",
      "AI Productivity Opportunity",
      state,
      aiMove,
      "medium",
      state === "favourable"
        ? "Their AI delivery capability has advanced — productivity assumptions set earlier deserve challenge."
        : "AI capability is present but not yet decisive for productivity commitments.",
      [
        { text: `AG AI-readiness ${ai.toFixed(0)}/100.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null },
      ],
      cat?.sourcedAt ?? null,
    );
  }

  let automationOpportunity: Metric;
  if (ai == null) {
    automationOpportunity = insufficientMetric(
      "automationOpportunity",
      "Automation Opportunity",
      "No automation-capability reading is held for this vendor.",
    );
  } else {
    const labourHeavy = (talent?.totalHeadcount ?? 0) >= 50_000;
    const state: MetricState = ai >= 70 && labourHeavy ? "favourable" : ai >= 60 ? "stable" : "mixed";
    const basis: Basis[] = [
      { text: `AG AI-readiness ${ai.toFixed(0)}/100.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null },
    ];
    if (talent?.totalHeadcount != null) {
      basis.push({
        text: `Delivery headcount ${count(talent.totalHeadcount)} (${talent.headcountTrend ?? "trend not stated"}) — the labour base automation would displace.`,
        source: "AnalystGenius talent signals", ownership: "market",
        asOf: talent.sourcedAt,
      });
    }
    automationOpportunity = metric(
      "automationOpportunity",
      "Automation Opportunity",
      state,
      aiMove,
      "medium",
      state === "favourable"
        ? "Advanced automation capability over a labour-heavy delivery base — the buyer's benefit case is live."
        : null,
      basis,
      cat?.sourcedAt ?? null,
    );
  }

  let gainShareOpportunity: Metric;
  if (ai == null && (talent?.netFlow == null)) {
    gainShareOpportunity = insufficientMetric(
      "gainShareOpportunity",
      "Gain-Sharing Opportunity",
      "Insufficient evidence on AI capability and labour dependency to assess gain-sharing.",
    );
  } else {
    const capabilityUp = ai != null && ai >= 60;
    const labourDown = talent?.netFlow != null && talent.netFlow < 0;
    const state: MetricState = capabilityUp && labourDown ? "favourable" : capabilityUp || labourDown ? "stable" : "mixed";
    const basis: Basis[] = [];
    if (ai != null) basis.push({ text: `AG AI-readiness ${ai.toFixed(0)}/100.`, source: "AnalystGenius vendor catalog", ownership: "market", asOf: cat?.sourcedAt ?? null });
    if (talent?.netFlow != null)
      basis.push({ text: `Net talent flow ${signed(talent.netFlow)} with headcount ${talent.headcountTrend ?? "trend not stated"}.`, source: "AnalystGenius talent signals", ownership: "market", asOf: talent.sourcedAt });
    if (marginPrim)
      basis.push({
        text: `Financial capacity to fund gain-share structures: operating margin ${marginPrim.value.toFixed(1)}% (SEC 10-K, period ending ${shortDate(marginPrim.asOf)}).`,
        source: "SEC EDGAR companyfacts", ownership: "market", asOf: marginPrim.asOf,
      });
    gainShareOpportunity = metric(
      "gainShareOpportunity",
      "Gain-Sharing Opportunity",
      state,
      aiMove,
      "medium",
      state === "favourable"
        ? "Delivery capability is rising while labour dependency falls — productivity gains may not yet be reflected in commercial assumptions."
        : null,
      basis,
      cat?.sourcedAt ?? talent?.sourcedAt ?? null,
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
      "medium",
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
    savingsOpportunity = metric(
      "savingsOpportunity",
      "Savings Opportunity",
      state,
      buyerLeverage.movement,
      "low",
      "Potential savings opportunity from movement in vendor and market economics — not a claim about your contracts.",
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

function opportunitiesFor(metrics: VendorMetrics): Record<OpportunityType, Opportunity> {
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
    "gain-sharing": mk(
      "gain-sharing",
      metrics.gainShareOpportunity,
      metrics.aiProductivityOpportunity.state === "favourable",
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

function overallFrom(opps: Record<OpportunityType, Opportunity>, metrics: VendorMetrics): Opportunity {
  const defined = Object.values(opps).filter((o) => o.level !== "insufficient");
  let level: OpportunityLevel = "insufficient";
  if (defined.length > 0) {
    const avg = defined.reduce((a, o) => a + levelScore(o.level), 0) / defined.length;
    const max = Math.max(...defined.map((o) => levelScore(o.level)));
    const blended = Math.round(avg * 0.5 + max * 0.5);
    level = (["insufficient", "low", "medium", "high", "very-high"] as const)[Math.min(4, Math.max(1, blended))];
  }
  return {
    type: "commercial-leverage",
    level,
    movement: metrics.buyerLeverage.movement,
    confidence: defined.length >= 3 ? "medium" : defined.length >= 1 ? "low" : "insufficient",
    why: defined.slice(0, 2).flatMap((o) => o.why.slice(0, 1)),
    investigate: [],
  };
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
  return metric(
    id,
    label,
    state,
    movement,
    confidence,
    state === "favourable" ? favourableReading : state === "unfavourable" ? unfavourableReading : null,
    [
      {
        text: `${states.favourable} of ${n} assessed vendors favourable, ${states.unfavourable} unfavourable, ${states.stable + states.mixed} steady or mixed.`,
        source: "Derived from canonical metrics", ownership: "market",
      },
    ],
    null,
  );
}

/* ───────────────────── the resolver ───────────────────── */

export const resolveIntelligence = cache(async (scopeJson: string): Promise<MarketIntel> => {
  const scope = JSON.parse(scopeJson) as MarketScope;
  const universe = await getUniverse();
  const universeTickers = universe.map((u) => u.ticker);
  const tickers = scopedTickers(scope, universeTickers);
  const key = [...tickers].sort().join(",");

  const [deals, signals, catalog, sec, deltas, agg, anchor, freshness, proc, prims, repSeries, spineQ, procMonthly, pricingMix] =
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
      getSpineQuarterlyFlow(key),
      getProcurementMonthlyFlow(key),
      getPricingModelMixByYear(key),
    ]);

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
      alternativesInTopLine: alternatives,
      scopeVendorCount: tickers.length,
      spineLastIngest: anchor.lastIngest,
      spineDataAsOf: anchor.dataAsOf,
    });
    const opportunities = opportunitiesFor(metrics);
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
        hasSignals: signals.has(ticker),
        hasSec: sec.has(ticker),
      },
      metrics,
      opportunities,
      overall: overallFrom(opportunities, metrics),
      claimsVsDelivery: nrg
        ? { direction: nrg.direction, headline: nrg.headline, asOf: nrg.generatedAt ?? nrg.sourcedAt }
        : null,
      lastUpdated: asOfs.sort().at(-1) ?? anchor.lastIngest,
    };
  });

  vendors.sort((a, b) => levelScore(b.overall.level) - levelScore(a.overall.level));

  const m = (sel: (v: VendorIntel) => Metric) => vendors.map(sel);

  const strip = {
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
          move, "medium", null,
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
        move, "low", null,
        [{
          text: `${count(agg.awardsT12)} observed awards across ${count(agg.awardsT12Vendors)} vendors in the 12 months to ${shortDate(anchor.dataAsOf ?? anchor.lastIngest)}, vs ${count(agg.awardsPrior12)} across ${count(agg.awardsPrior12Vendors)} in the prior 12.`,
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

  const economicsDimensions: Metric[] = [
    strip.pricingPressure,
    rollup("m.labour", "Labour Economics", m((v) => v.metrics.talentPressure),
      "Vendor delivery workforces are expanding.", "Vendor delivery workforces are under strain."),
    strip.competitiveIntensity,
    rollup("m.supplier", "Supplier Economics", m((v) => v.metrics.financialResilience),
      "Your vendors are financially expanding.", "Your vendors are financially strained."),
    strip.aiProductivityPressure,
    strip.servicesDemand,
    rollup("m.oprisk", "Operational Risk", m((v) => v.metrics.operationalRisk),
      "No elevated operational risk across your market.", "Elevated operational risk across your market."),
  ];
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

  {
    // Commercial deal flow — quarterly signings, anchored to the spine's own data-as-of.
    const pts = spineQ.points;
    if (pts.length >= 8) {
      const recent = qSum(spineQ, pts.length - 4, pts.length);
      const prior = qSum(spineQ, pts.length - 8, pts.length - 4);
      changes.push({
        dimension: "Deal flow (commercial)",
        state: recent < prior ? "favourable" : recent > prior ? "unfavourable" : "stable",
        movement: ratioMove(recent, prior),
        detail: `${count(recent)} observed signings across the four most recent quarters on record vs ${count(prior)} in the four before (to ${shortDate(anchor.dataAsOf)}; ${historyModeLabel(spineQ.mode)}).`,
        confidence: "medium",
        source: spineQ.source,
      });
    }
  }

  {
    // Public award flow — the fresh series.
    if (proc.totalT90 + proc.totalPrior90 >= 5) {
      changes.push({
        dimension: "Deal flow (public procurement)",
        state: proc.totalT90 < proc.totalPrior90 ? "favourable" : proc.totalT90 > proc.totalPrior90 ? "unfavourable" : "stable",
        movement: ratioMove(proc.totalT90, proc.totalPrior90),
        detail: `${count(proc.totalT90)} public awards to selected vendors in the trailing 90 days vs ${count(proc.totalPrior90)} in the prior 90 (${historyModeLabel(procMonthly.mode)}; flow evidence, never enterprise pricing).`,
        confidence: "medium",
        source: procMonthly.source,
      });
    }
  }

  {
    // Commercial-model mix — the observable gain-sharing precondition.
    const withShare = pricingMix.points.filter((p) => p.value != null);
    if (withShare.length >= 2) {
      const first = withShare[0];
      const last = withShare[withShare.length - 1];
      const delta = Number(((last.value ?? 0) - (first.value ?? 0)).toFixed(1));
      changes.push({
        dimension: "Pricing economics (commercial model)",
        state: "mixed",
        movement: delta > 1 ? "improving" : delta < -1 ? "deteriorating" : "stable",
        detail: `Consumption/outcome-shaped share of observed agreements ${first.value}% (${first.period}, n=${first.n}) → ${last.value}% (${last.period}, n=${last.n}) (${historyModeLabel(pricingMix.mode)}). Rate-LEVEL movement remains unverifiable from the record.`,
        confidence: "low",
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
    // AI capability — observed snapshots of the AG AI-readiness primitive.
    const a = seriesDelta("ai_readiness");
    changes.push({
      dimension: "AI delivery capability",
      state: a.moved > 0 ? "mixed" : "stable",
      movement: a.assessed === 0 ? "insufficient" : a.net > 0 ? "improving" : a.net < 0 ? "deteriorating" : "stable",
      detail:
        a.assessed === 0
          ? `AI-readiness snapshots begin ${shortDate(trackedSince)}; a full 12-month capability series is not yet held.`
          : `AI-readiness moved for ${a.moved} of ${a.assessed} vendors across canonical snapshots (observed snapshots); a full 12-month series is still accruing.`,
      confidence: "low",
      source: "Canonical vendor snapshots · AG vendor catalog",
    });
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
      state: agg.inPlay12 > agg.expiredPast12 ? "favourable" : agg.inPlay12 === 0 ? "unfavourable" : "stable",
      movement: ratioMove(agg.inPlay12, agg.expiredPast12),
      detail: `${count(agg.inPlay12)} observed commercial agreements reach end-of-term in the next 12 months (${money(agg.inPlay12Tcv)}) vs ${count(agg.expiredPast12)} that ended in the last 12 — market record, not the reader's contracts.`,
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
    watch: [],
    signalTrackingSince: trackedSince,
  };

  intel.watch = await buildWatchSignals(intel, key);
  return intel;
});
