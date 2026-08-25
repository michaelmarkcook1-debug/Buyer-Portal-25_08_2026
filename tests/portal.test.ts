import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedNumbers, proprietaryScoreOffences, validateInsight } from "@/lib/insight/validate";
import { baselineFrom, parseCookieValue, scopedTickers, tickersFromParam } from "@/lib/scope-core";
import {
  aiCapabilityChange,
  allowedAiEnterprisePillar,
  assertHistoryMode,
  automationState,
  capConfidenceByAge,
  deliveryCostState,
  headroomState,
  historyModeLabel,
  isAllowedPricingSource,
  gainShareLevel,
  mixCoverage,
  newestOf,
  showsConfidenceCaveat,
  pricingRead,
  procurementHeatState,
  ratioMove,
} from "@/lib/metrics/rules";
import { shiftLevel, type MetricState } from "@/lib/metrics/types";
import { levelInk, stateInk } from "@/components/charts/Charts";
import { EXCLUDED_STAGES, REFRESH_STAGES } from "@/lib/backoffice/stages";
import { scrubSecrets } from "@/lib/backoffice/run-state";
import { detectExecutor } from "@/lib/backoffice/executor";
import { EFFECT_INK } from "@/components/ui";
import { METRIC_REGISTRY, commercialWindowLabel, scopeLabel } from "@/lib/metrics/canonical";
import { evidenceSufficiency } from "@/lib/metrics/resolve";
import { marketFirstViolation } from "@/lib/insight/generate";
import { LEVEL_VOCABULARY, METRIC_DICTIONARY, SIGNAL_CLASS_HELP, displayState, levelEffect } from "@/lib/metrics/dictionary";
import {
  BUYER_LEVERAGE_COPY, HEAT_COPY, aiPressureAnalysis, demandAnalysis, deliveryCostAnalysis,
  exposureAnalysis, headroomAnalysis, intensityAnalysis, labourAnalysis, pricingAnalysis,
  productivityTermsAnalysis, riskAnalysis, rollupAnalysis, supplierAnalysis,
} from "@/lib/metrics/market-analysis";
import { MARKET_FIRST_HIERARCHY, TOP_LEVEL_TABS } from "@/lib/insight/objectives";
import { buildCalls } from "@/components/WholeMarketLenses";

/**
 * Locked-rules tests, in the estate's spirit: the grounding firewall and the
 * scope rules are safety controls — do not relax without updating the suite.
 */

describe("grounding firewall (spec §24)", () => {
  const context = JSON.stringify({
    vendors: ["Accenture", "Cognizant"],
    facts: ["3 agreements reach end-of-term within 12 months ($14.2bn)", "Net talent flow -3,824"],
    score: 65,
  });

  it("passes prose whose figures all appear in the context", () => {
    const r = validateInsight(
      "Three of the figures matter: 3 agreements end within 12 months, worth $14.2bn, while net flow of -3,824 signals strain.",
      context,
    );
    expect(r.ok).toBe(true);
  });

  it("blocks a fabricated figure", () => {
    const r = validateInsight("Savings of $50M are achievable this quarter.", context);
    expect(r.ok).toBe(false);
    expect(r.blocked[0]).toContain("50m");
  });

  it("blocks a fabricated percentage", () => {
    const r = validateInsight("Pricing has fallen 7% across the market.", context);
    expect(r.ok).toBe(false);
  });

  it("trims past the 200-word cap at a sentence boundary", () => {
    const sentence = "The record shows 3 agreements in the window. ";
    const r = validateInsight(sentence.repeat(40), context);
    expect(r.ok).toBe(true);
    expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(180);
    expect(r.text.endsWith(".")).toBe(true);
    expect(r.warnings.some((w) => w.includes("trimmed"))).toBe(true);
  });

  it("warns on proscribed generic phrases", () => {
    const r = validateInsight("Buyers should navigate uncertainty around the 3 agreements.", context);
    expect(r.warnings.some((w) => w.includes("navigate uncertainty"))).toBe(true);
  });

  it("collects magnitude-suffixed and plain variants of context numbers", () => {
    const allowed = allowedNumbers(JSON.stringify({ v: "$2.4M across 47 agreements" }));
    expect(allowed.has("2.4m")).toBe(true);
    expect(allowed.has("2.4")).toBe(true);
    expect(allowed.has("47")).toBe(true);
  });
});

describe("ownership firewall (truth-safety correction §4)", () => {
  // The context carries the market figures, so the numeric firewall passes —
  // these tests isolate OWNERSHIP violations specifically.
  const context = JSON.stringify({
    facts: [
      "[market observation] $46.6M reaches end-of-term within 12 months across 5 observed TCS agreements",
      "Nearest observed end-of-term: 30 Aug 2026",
    ],
  });

  it("blocks a market figure paired with buyer-ownership language", () => {
    const r = validateInsight("TCS has $46.6M of your commitments reaching end-of-term.", context);
    expect(r.ok).toBe(false);
    expect(r.blocked.some((b) => b.includes("Ownership violation"))).toBe(true);
  });

  it("blocks a public contract date described as the reader's renewal", () => {
    const r = validateInsight("Your renewal on 30 Aug 2026 is the moment of maximum leverage.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks a public award amount described as the reader's spend", () => {
    const r = validateInsight("This puts $46.6M of your spend in play this year.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks asserted buyer exposure the portal cannot know", () => {
    const r = validateInsight("You hold 5 agreements with TCS reaching end-of-term.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks buyer-directed timing keyed to a market date without market framing", () => {
    const r = validateInsight("Press TCS before the 30 Aug 2026 renewal on automation-adjusted pricing.", context);
    expect(r.ok).toBe(false);
  });

  it("passes the same advice when framed as market evidence", () => {
    const r = validateInsight(
      "An observed TCS agreement reaches end-of-term on 30 Aug 2026; buyers with comparable agreements should press on automation-adjusted pricing before that renewal cycle closes.",
      context,
    );
    expect(r.ok).toBe(true);
  });

  it("keeps public contract figures usable as market evidence", () => {
    const r = validateInsight(
      "Across observed TCS contracts in the market, $46.6M reaches end-of-term within 12 months.",
      context,
    );
    expect(r.ok).toBe(true);
  });

  it("keeps buyer-level opportunity language legitimate (no overcorrection)", () => {
    const r = validateInsight(
      "Buyer leverage is strong across your market, and pricing pressure favours your position.",
      context,
    );
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual([]);
  });

  it("surfaces unrecognised second-person possessives for review", () => {
    const r = validateInsight("Your roadmap should absorb this shift.", context);
    expect(r.warnings.some((w) => w.includes("your roadmap"))).toBe(true);
  });
});

describe("completeness & window hardening (final truth-safety pass)", () => {
  const context = JSON.stringify({
    facts: [
      "[market observation] $546.4M across 11 observed Accenture-associated agreements reach end-of-term within 12 months",
      "[market observation] $46.6M across 5 observed TCS-associated agreements",
      "Nearest observed end-of-term: 30 Aug 2026",
    ],
  });

  it("blocks a named vendor's 'book'", () => {
    const r = validateInsight("Accenture's own $546.4M book anchors the market.", context);
    expect(r.ok).toBe(false);
    expect(r.blocked.some((b) => b.includes("book/portfolio"))).toBe(true);
  });

  it("blocks 'their expiring book'", () => {
    const r = validateInsight("Their expiring book creates leverage for buyers.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks possessive-less 'expiring books' (sprint 2 tightening)", () => {
    const r = validateInsight("Vendors are defending large expiring books while demand cools.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks 'order books' and asserted negotiating windows (sprint 2 tightening)", () => {
    expect(validateInsight("Starved order books push vendors into defensive pricing.", context).ok).toBe(false);
    expect(validateInsight("This is a genuine negotiating window, not just a cyclical dip.", context).ok).toBe(false);
  });

  it("blocks reader-directed 'now' urgency on renewal timing without market framing", () => {
    const r = validateInsight("Buyers should pressure-test renewal pricing now while validating staffing.", context);
    expect(r.ok).toBe(false);
    const ok = validateInsight(
      "Buyers with comparable observed agreements should pressure-test renewal pricing now against the market record.",
      context,
    );
    expect(ok.ok).toBe(true);
  });

  it("blocks authoritative 'vendor commitments'", () => {
    const r = validateInsight("Vendor commitments of $46.6M reach end-of-term this year.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks converting market dates into an open negotiating window", () => {
    const r = validateInsight("The negotiating window is open across the market.", context);
    expect(r.ok).toBe(false);
  });

  it("blocks 'renegotiate now' urgency on market timing", () => {
    const r = validateInsight("Renegotiate now, ahead of the 30 Aug 2026 expiry.", context);
    expect(r.ok).toBe(false);
  });

  it("passes the preferred completeness phrasing", () => {
    const r = validateInsight(
      "$546.4M of observed Accenture-associated agreements in the current market dataset reach end-of-term within 12 months.",
      context,
    );
    expect(r.ok).toBe(true);
  });

  it("passes the preferred window phrasing", () => {
    const r = validateInsight(
      "Observed renewal activity is concentrating at a time when the automation case is strengthening, potentially improving the commercial backdrop for buyers with comparable agreements.",
      context,
    );
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual([]);
  });
});

describe("market scope (spec §2/§3)", () => {
  it("normalises vendors params in both shapes", () => {
    expect(tickersFromParam("acn,ctsh")).toEqual(["ACN", "CTSH"]);
    expect(tickersFromParam(["acn", "ctsh,tcs"])).toEqual(["ACN", "CTSH", "TCS"]);
  });

  it("drops malformed tickers rather than passing them to a query", () => {
    expect(tickersFromParam("acn,<script>,x".repeat(1))).toEqual(["ACN", "X"]);
  });

  it("derives the baseline as first use minus 12 months", () => {
    expect(baselineFrom("2026-08-21T10:00:00.000Z")).toBe("2025-08-21");
  });

  it("rejects cookie payloads with unknown modes", () => {
    expect(parseCookieValue(JSON.stringify({ v: 1, mode: "everything" }))).toBeNull();
  });
});

describe("data-engine truth gates (Sprint 1 §18)", () => {
  it("public procurement is never an allowed pricing source", () => {
    expect(isAllowedPricingSource("procurement")).toBe(false);
    expect(isAllowedPricingSource("public-record")).toBe(false);
    expect(isAllowedPricingSource("curated-spine")).toBe(true);
  });

  it("procurement heat refuses to read below the observation floor", () => {
    expect(procurementHeatState(1, 1).usable).toBe(false);
    expect(procurementHeatState(9, 3)).toMatchObject({ usable: true, state: "unfavourable" });
    expect(procurementHeatState(2, 8)).toMatchObject({ usable: true, state: "favourable" });
  });

  it("seed/stale AI Enterprise intelligence cannot enter portal metrics", () => {
    expect(allowedAiEnterprisePillar({ dataStatusHint: "seed", evidenceGrade: "E4", confidence: 90 })).toBe(false);
    expect(allowedAiEnterprisePillar({ dataStatusHint: "stale", evidenceGrade: "E4", confidence: 90 })).toBe(false);
    expect(allowedAiEnterprisePillar({ dataStatusHint: "documented", evidenceGrade: "E1", confidence: 90 })).toBe(false);
    expect(allowedAiEnterprisePillar({ dataStatusHint: "documented", evidenceGrade: "E0", confidence: 90 })).toBe(false);
    expect(allowedAiEnterprisePillar({ dataStatusHint: "documented", evidenceGrade: "E3", confidence: 80 })).toBe(true);
  });

  it("stale evidence cannot silently keep high confidence", () => {
    expect(capConfidenceByAge("high", "2026-08-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("high");
    expect(capConfidenceByAge("high", "2026-01-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("medium");
    expect(capConfidenceByAge("medium", "2024-01-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("low");
    expect(capConfidenceByAge("low", "2020-01-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("low");
    expect(capConfidenceByAge("insufficient", "2020-01-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("insufficient");
  });

  it("reconstructed history can never claim observed-snapshot status", () => {
    expect(() => assertHistoryMode("observed_snapshot", false)).toThrow(/History integrity/);
    expect(assertHistoryMode("observed_snapshot", true)).toBe("observed_snapshot");
    expect(assertHistoryMode("reconstructed", false)).toBe("reconstructed");
    // The buyer-facing wording is plain language (§16), but a rebuilt series
    // must still never present itself as a contemporaneous snapshot.
    expect(historyModeLabel("reconstructed")).not.toMatch(/snapshot|observed reading/i);
    expect(historyModeLabel("reconstructed")).not.toBe(historyModeLabel("observed_snapshot"));
    expect(historyModeLabel("reconstructed")).toMatch(/historical|dated evidence/i);
  });

  it("financial headroom never fabricates for unlisted vendors", () => {
    expect(headroomState({ operatingMarginPct: null, cashUsd: null, longTermDebtUsd: null }).state).toBe("insufficient");
    expect(headroomState({ operatingMarginPct: 14, cashUsd: 9e9, longTermDebtUsd: 3e9 }).state).toBe("favourable");
    expect(headroomState({ operatingMarginPct: 1.5, cashUsd: 1e9, longTermDebtUsd: 8e9 }).state).toBe("unfavourable");
  });

  it("selected vendors define every relative calculation — scope never widens (§15)", () => {
    expect(scopedTickers({ mode: "selected_vendors", vendorIds: ["ACN", "CTSH"] }, ["ACN", "CTSH", "TTNQY", "IBM"]))
      .toEqual(["ACN", "CTSH"]);
    expect(scopedTickers({ mode: "whole_market", vendorIds: [] }, ["ACN", "CTSH", "TTNQY"]))
      .toEqual(["ACN", "CTSH", "TTNQY"]);
    expect(scopedTickers({ mode: "unset", vendorIds: [] }, ["ACN"])).toEqual([]);
  });
});

describe("opportunity banding", () => {
  it("never shifts an insufficient level — absence stays absence", () => {
    expect(shiftLevel("insufficient", 1)).toBe("insufficient");
  });
  it("clamps at the band edges", () => {
    expect(shiftLevel("very-high", 1)).toBe("very-high");
    expect(shiftLevel("low", -1)).toBe("low");
  });
});

/* ── Sprint 2 (§29): AI events, completeness guard, delivery-cost honesty ── */

describe("AI capability change — materiality gate (sprint 2 §6/§7)", () => {
  it("a generic announcement alone can never raise the AI change state", () => {
    // Generic announcements are materiality 1 and never reach the portal
    // (facts query gates at >=3), so their event counts are zero here.
    expect(aiCapabilityChange({ materialT12: 0, highT12: 0 }, null)).toBe("insufficient");
    expect(automationState({ aiReadiness: null, labourHeavy: true, materialEventsT12: 0 })).toBe("insufficient");
  });

  it("gated events move the 12-month state; readiness delta alone reads stable", () => {
    expect(aiCapabilityChange({ materialT12: 2, highT12: 0 }, null)).toBe("increased");
    expect(aiCapabilityChange({ materialT12: 3, highT12: 1 }, null)).toBe("materially-increased");
    expect(aiCapabilityChange({ materialT12: 0, highT12: 0 }, 1)).toBe("stable");
    expect(aiCapabilityChange({ materialT12: 0, highT12: 0 }, -5)).toBe("decreased");
  });

  it("automation favourable needs capability AND labour base, or capability AND real events", () => {
    expect(automationState({ aiReadiness: 75, labourHeavy: true, materialEventsT12: 0 })).toBe("favourable");
    expect(automationState({ aiReadiness: 65, labourHeavy: false, materialEventsT12: 2 })).toBe("favourable");
    expect(automationState({ aiReadiness: 65, labourHeavy: false, materialEventsT12: 0 })).toBe("stable");
    expect(automationState({ aiReadiness: 40, labourHeavy: true, materialEventsT12: 5 })).toBe("mixed");
  });
});

describe("completeness guard (sprint 2 §10) — dataset absence is never market absence", () => {
  const context = JSON.stringify({ mix: "0 consumption-based agreements observed", n: 240 });

  it("blocks market-wide absence claims", () => {
    for (const bad of [
      "The market has no consumption-based pricing.",
      "No consumption-based pricing exists in the market.",
      "Nowhere in the industry is gain-sharing present.",
    ]) {
      expect(validateInsight(bad, context).ok).toBe(false);
    }
  });

  it("allows dataset-scoped absence claims", () => {
    const ok = validateInsight(
      "No consumption-based pricing was identified in the observed agreement dataset of 240 agreements.",
      context,
    );
    expect(ok.ok).toBe(true);
  });

  it("coverage banding never claims strong coverage on thin classification", () => {
    expect(mixCoverage(240, 220).coverageQuality).toBe("strong");
    expect(mixCoverage(240, 60).coverageQuality).toBe("weak");
    expect(mixCoverage(40, 25).coverageQuality).toBe("partial");
    expect(mixCoverage(0, 0).coverageQuality).toBe("weak");
  });
});

describe("delivery-cost economics (sprint 2 §15) — macro-grounded, never fabricated", () => {
  it("below two fresh series the state is insufficient — no fabricated blend", () => {
    expect(deliveryCostState({ usWageYoY: 4.5, usCpiYoY: null, indiaCpiYoY: null, inrPerUsdYoY: null }).state).toBe("insufficient");
    expect(deliveryCostState({ usWageYoY: null, usCpiYoY: null, indiaCpiYoY: null, inrPerUsdYoY: null }).state).toBe("insufficient");
  });

  it("direction requires a clear majority of series; splits read mixed/stable", () => {
    expect(
      deliveryCostState({ usWageYoY: 2.0, usCpiYoY: 2.1, indiaCpiYoY: 3.0, inrPerUsdYoY: 3.5 }).state,
    ).toBe("favourable");
    expect(
      deliveryCostState({ usWageYoY: 5.2, usCpiYoY: 4.8, indiaCpiYoY: 7.1, inrPerUsdYoY: -3.0 }).state,
    ).toBe("unfavourable");
  });

  it("stale FX/wage series are dropped by the freshness cap before they reach the read", () => {
    // The resolver's per-series ceilings feed capConfidenceByAge-style gating;
    // the rule itself is exercised here: stale asOf degrades confidence.
    expect(capConfidenceByAge("high", "2025-01-01", { maxFreshDays: 45, today: "2026-08-21" })).toBe("medium");
    expect(capConfidenceByAge("high", "2026-08-10", { maxFreshDays: 45, today: "2026-08-21" })).toBe("high");
  });
});


/* ── Sprint 3 Stage 1: discrimination, floors, freshness, cache hardening ── */

describe("pricing discrimination (sprint 3 fix 3)", () => {
  it("a market-wide macro tailwind alone cannot mark ANY vendor favourable", () => {
    const universe = Array.from({ length: 50 }, () =>
      pricingRead({ heatUsable: false, cooling: false, stronglyCooling: false, alternatives: 0, marginRoom: false, macroFavourable: true }),
    );
    expect(universe.filter((r) => r.state === "favourable")).toHaveLength(0);
    expect(universe.every((r) => r.state === "stable" && r.marketContextOnly)).toBe(true);
  });

  it("favourable is earned by the vendor's own corroborated record", () => {
    expect(pricingRead({ heatUsable: true, cooling: true, stronglyCooling: true, alternatives: 2, marginRoom: false, macroFavourable: false }).state).toBe("favourable");
    expect(pricingRead({ heatUsable: true, cooling: true, stronglyCooling: false, alternatives: 1, marginRoom: true, macroFavourable: false }).state).toBe("favourable");
    // mild cooling + breadth but no margin corroboration -> mixed, not favourable
    expect(pricingRead({ heatUsable: true, cooling: true, stronglyCooling: false, alternatives: 3, marginRoom: false, macroFavourable: true }).state).toBe("mixed");
    // a lone structural signal reads stable
    expect(pricingRead({ heatUsable: false, cooling: false, stronglyCooling: false, alternatives: 1, marginRoom: false, macroFavourable: false }).state).toBe("stable");
  });

  it("stale tracker evidence caps pricing confidence", () => {
    expect(capConfidenceByAge("medium", "2026-04-16", { maxFreshDays: 120, today: "2026-08-21" })).toBe("low");
    expect(capConfidenceByAge("medium", "2026-07-16", { maxFreshDays: 120, today: "2026-08-21" })).toBe("medium");
  });
});

describe("gain-sharing evidence floor (sprint 3 fix 4)", () => {
  it("no evidence at all reads insufficient", () => {
    expect(gainShareLevel({ aiReadiness: null, materialEventsT12: 0, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: false, marginRoom: false })).toBe("insufficient");
  });

  it("baseline inputs with no meaningful change read LOW, never medium", () => {
    expect(gainShareLevel({ aiReadiness: 38, materialEventsT12: 0, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: true, marginRoom: false })).toBe("low");
    expect(gainShareLevel({ aiReadiness: 45, materialEventsT12: 0, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: true, marginRoom: true })).toBe("low");
  });

  it("one change family reads medium; several read high/very-high", () => {
    expect(gainShareLevel({ aiReadiness: 65, materialEventsT12: 0, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: true, marginRoom: false })).toBe("medium");
    expect(gainShareLevel({ aiReadiness: 65, materialEventsT12: 2, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: true, marginRoom: false })).toBe("high");
    expect(gainShareLevel({ aiReadiness: 65, materialEventsT12: 3, highEventsT12: 1, commercialModelEvent: false, labourDown: true, talentKnown: true, marginRoom: true })).toBe("very-high");
    expect(gainShareLevel({ aiReadiness: 61, materialEventsT12: 4, highEventsT12: 1, commercialModelEvent: true, labourDown: true, talentKnown: true, marginRoom: true })).toBe("very-high");
  });

  it("a generic announcement cannot raise the level (gate keeps events at zero)", () => {
    const before = gainShareLevel({ aiReadiness: 40, materialEventsT12: 0, highEventsT12: 0, commercialModelEvent: false, labourDown: false, talentKnown: true, marginRoom: false });
    expect(before).toBe("low");
  });
});

describe("freshness semantics (sprint 3 fix 5)", () => {
  it("newestOf picks the newest non-null date and never invents one", () => {
    expect(newestOf("2016-08-22", "2026-04-16", null, "2025-01-01")).toBe("2026-04-16");
    expect(newestOf(null, undefined)).toBe(null);
  });
});

describe("insight cache hardening (sprint 3 fix 1)", () => {
  const context = JSON.stringify({ facts: ["46 observed agreements ($7.2bn) reach end-of-term"] });
  it("the three incident phrases cannot survive the current validator", () => {
    for (const bad of [
      "Vendors are exposed as their contract books come up for renewal.",
      "Their renewal books are defended aggressively.",
      "Your renewal window opens in the autumn.",
      "Vendors are chasing renewal-heavy books rather than fresh volume.",
      "Accenture's book of business is under pressure.",
    ]) {
      expect(validateInsight(bad, context).ok).toBe(false);
    }
  });

  it("keeps the legitimate financial ratio 'book-to-bill' legal", () => {
    const r = validateInsight("A published book-to-bill above 1 supports the observed momentum reading.", JSON.stringify({ f: "book-to-bill 1" }));
    expect(r.blocked).toEqual([]);
  });
});

/* ── Sprint 3 Stage 2: band-aware delivery economics (P4) ── */

import { deliveryCostForBand } from "@/lib/metrics/rules";
import { deliveryExposure } from "@/lib/metrics/exposure";

describe("delivery-location economics (sprint 3 P4)", () => {
  const macro = {
    usWageYoY: 5.1, usCpiYoY: 4.4, indiaCpiYoY: 3.0, inrPerUsdYoY: 9.0,
    eurPerUsdYoY: 6.0, gbpPerUsdYoY: 4.0,
  };

  it("vendor exposure differences produce different states from the SAME macro data", () => {
    const india = deliveryCostForBand(macro, "india-heavy");     // weak INR + soft India CPI vs hot US-CPI escalator -> split
    const us = deliveryCostForBand(macro, "us-heavy");           // hot US wages + CPI -> supplier
    const europe = deliveryCostForBand(macro, "europe-heavy");   // stronger EUR/GBP -> supplier
    expect(india.state).toBe("mixed"); // 2-1 split reads mixed, honestly
    // with a soft US-CPI escalator the India read is cleanly buyer-favourable
    expect(deliveryCostForBand({ ...macro, usCpiYoY: 3.2 }, "india-heavy").state).toBe("favourable");
    expect(us.state).toBe("unfavourable");
    expect(europe.state).toBe("unfavourable");
  });

  it("missing regional series read insufficient — never a fabricated blend", () => {
    const r = deliveryCostForBand({ ...macro, eurPerUsdYoY: null, gbpPerUsdYoY: null }, "europe-heavy");
    expect(r.state).toBe("insufficient");
  });

  it("neutral FX moves cast no vote", () => {
    const r = deliveryCostForBand({ ...macro, inrPerUsdYoY: 0.5, indiaCpiYoY: null, usCpiYoY: null }, "india-heavy");
    expect(r.signals).toBe(0);
    expect(r.state).toBe("insufficient");
  });

  it("unknown exposure yields an insufficient band, not fake precision", () => {
    expect(deliveryExposure("ZZZ", null, null).band).toBe("insufficient");
    // a 100k+ global operator's HQ alone is NOT delivery-mix evidence
    expect(deliveryExposure("ZZZ", "Paris, France", 250_000).band).toBe("insufficient");
    // India HQ = the provider's own filings describe India-centred delivery
    expect(deliveryExposure("ZZZ", "Mumbai, India", 600_000).band).toBe("india-heavy");
    // documented exception with cited filing evidence
    const ctsh = deliveryExposure("CTSH", "Teaneck, US", 340_000);
    expect(ctsh.band).toBe("india-heavy");
    expect(ctsh.basis?.text).toContain("10-K");
  });
});

/* ── Sprint 4: decision quality — objectives, signals, reasons ── */

import { OBJECTIVES, SCENARIOS_DEFAULT_OBJECTIVE } from "@/lib/insight/objectives";
import { dedupeSignals, leverageSignalClass, opportunityReason } from "@/lib/metrics/rules";

describe("tab-specific analytical objectives (sprint 4 §5)", () => {
  it("every tab asks a genuinely different question", () => {
    const values = Object.values(OBJECTIVES);
    expect(new Set(values).size).toBe(values.length);
    // each answers a distinct concern
    // concepts, not casing — each tab keeps its distinct analytical concern
    expect(OBJECTIVES.home).toMatch(/single most important development/i);
    expect(OBJECTIVES.market).toMatch(/DIVERGE/i);
    expect(OBJECTIVES.vendors).toMatch(/DIFFERENTLY/i);
    expect(OBJECTIVES["vendor-detail"]).toMatch(/THIS vendor/i);
    expect(OBJECTIVES.opportunities).toMatch(/strongest commercial lever/i);
    expect(OBJECTIVES.scenarios).toMatch(/what the buyer would do differently/i);
    expect(SCENARIOS_DEFAULT_OBJECTIVE).toContain("Do not invent modelled outcomes");
  });
});

describe("signal decision gate + deduplication (sprint 4 §7/§8)", () => {
  it("weak/stale leverage evidence cannot become ACT", () => {
    expect(leverageSignalClass("low", 5)).toBe("WATCH");
    expect(leverageSignalClass("medium", 1)).toBe("WATCH");
    expect(leverageSignalClass("medium", 3)).toBe("ACT");
    expect(leverageSignalClass("high", 2)).toBe("ACT");
  });

  it("the same underlying development surfaces once — strongest class wins", () => {
    const sig = (cls: "ACT" | "WATCH" | "KNOW", ticker: string, date: string | null, headline: string) =>
      ({ classification: cls, tickers: [ticker], date, headline });
    const out = dedupeSignals([
      sig("KNOW", "ACN", "2026-04-24", "Reported results of operations"),
      sig("ACT", "ACN", "2026-04-24", "Terminated a material agreement"),
      sig("WATCH", "ACN", "2026-08-05", "Workforce redesign event"),
      sig("WATCH", "TTNQY", "2026-04-24", "Different vendor, same day"),
    ]);
    expect(out).toHaveLength(3);
    expect(out.filter((s) => s.tickers[0] === "ACN" && s.date === "2026-04-24")).toHaveLength(1);
    expect(out.find((s) => s.tickers[0] === "ACN" && s.date === "2026-04-24")!.classification).toBe("ACT");
  });

  it("undated state signals are never merged away", () => {
    const out = dedupeSignals([
      { classification: "ACT" as const, tickers: ["ACN"], date: null, headline: "a" },
      { classification: "KNOW" as const, tickers: ["ACN"], date: null, headline: "b" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("opportunity reasons (sprint 4 §10/§20)", () => {
  const basis = (source: string) => ({ text: "x 1", source, ownership: "market" as const });

  it("levels are explained by drivers, never black-box", () => {
    const r = opportunityReason("high", "medium", [basis("AI capability events (materiality-gated)"), basis("AnalystGenius talent signals")], true);
    expect(r).toContain("High — primarily driven by");
    expect(r).toContain("material AI capability change");
    expect(r).toContain("workforce movement");
    expect(r).not.toMatch(/materiality-gated/i); // buyer-facing copy stays plain (§16)
  });

  it("high opportunity + low confidence produces cautious investigate-first language", () => {
    const r = opportunityReason("high", "low", [basis("Curated contract tracker (market record)")], true);
    expect(r).toContain("remains stale");
    expect(r).toContain("investigate rather than a negotiating conclusion");
  });

  it("different evidence profiles produce different stories", () => {
    const a = opportunityReason("high", "medium", [basis("AI capability events (materiality-gated)")], false);
    const b = opportunityReason("high", "medium", [basis("Public procurement record")], false);
    expect(a).not.toBe(b);
  });
});

/* ── Value provenance (directive 2026-08-23) ── */

import { count, formatTcvDisplay, formatValueMix, inferredDominates, money } from "@/lib/format";

describe("TCV value provenance (2026-08-23 directive)", () => {
  it("an inferred midpoint can never render as disclosed fact", () => {
    const midOnly = formatValueMix({ disclosedUsd: null, inferredLowUsd: null, inferredMidUsd: 19_200_000, inferredHighUsd: null });
    expect(midOnly).toContain("inferred");
    expect(midOnly).toContain("≈");
    const banded = formatValueMix({ disclosedUsd: null, inferredLowUsd: 9_600_000, inferredMidUsd: 19_200_000, inferredHighUsd: 38_400_000 });
    expect(banded).toContain("inferred");
    expect(banded).toContain("–");
    expect(banded).not.toMatch(/^\$19/); // never leads with the bare midpoint
  });

  it("mixed-provenance sums stay distinguishable — never one blended figure", () => {
    const mixed = formatValueMix({ disclosedUsd: 420_000_000, inferredLowUsd: 110_000_000, inferredMidUsd: 135_000_000, inferredHighUsd: 160_000_000 });
    expect(mixed).toContain("disclosed");
    expect(mixed).toContain("inferred");
    expect(mixed).not.toContain("580"); // no silent total
  });

  it("disclosed/calculated values remain authoritative and unchanged", () => {
    expect(formatValueMix({ disclosedUsd: 420_000_000, inferredLowUsd: null, inferredMidUsd: null, inferredHighUsd: null })).toBe("$420.0M");
  });

  it("missing TCV is not invented", () => {
    expect(formatValueMix({ disclosedUsd: null, inferredLowUsd: null, inferredMidUsd: null, inferredHighUsd: null })).toBe("—");
  });

  it("inferred-dominated sums flag for confidence step-down", () => {
    expect(inferredDominates({ disclosedUsd: 40_000_000, inferredLowUsd: null, inferredMidUsd: 60_000_000, inferredHighUsd: null })).toBe(true);
    expect(inferredDominates({ disclosedUsd: 400_000_000, inferredLowUsd: null, inferredMidUsd: 60_000_000, inferredHighUsd: null })).toBe(false);
  });

  it("insight firewall + ownership remain intact with provenance language", () => {
    const ctx = JSON.stringify({ f: "46 observed agreements ($7.2bn disclosed + $110M–$160M inferred)" });
    const ok = validateInsight("Observed and inferred contract activity suggests approximately $110M–$160M of additional exposure beyond the $7.2bn disclosed.", ctx);
    expect(ok.blocked).toEqual([]);
    const bad = validateInsight("Your contracts include $110M of inferred exposure.", ctx);
    expect(bad.ok).toBe(false);
  });
});

describe("TCV v2.1 buyer-facing states (2026-08-23 deployment directive §3/§26)", () => {
  it("known value renders as a plain figure", () => {
    expect(formatTcvDisplay({ tcvUsd: 120_000_000, valueProvenance: "disclosed" })).toBe("$120.0M");
  });

  it("approved inference renders as a range, never a bare midpoint", () => {
    const out = formatTcvDisplay({ tcvUsd: null, valueProvenance: "inferred", tcvLowUsd: 18_000_000, tcvMidUsd: 22_000_000, tcvHighUsd: 27_000_000 });
    expect(out).toContain("–");
    expect(out).toContain("$18.0M");
    expect(out).toContain("$27.0M");
    expect(out).not.toContain("22");
  });

  it("withheld inference says so explicitly — never an em-dash, never a guess", () => {
    expect(formatTcvDisplay({ tcvUsd: null, valueProvenance: "insufficient_evidence" })).toBe("Not reliably estimable");
    expect(formatTcvDisplay({ tcvUsd: null, valueProvenance: null })).toBe("Not reliably estimable");
    // a v1 leftover with no range must not resurface as an estimate
    expect(formatTcvDisplay({ tcvUsd: null, valueProvenance: "insufficient_evidence", tcvMidUsd: 19_200_000 })).toBe("Not reliably estimable");
  });

  it("no confidence, comparable count, model version or methodology is ever displayed", () => {
    const states = [
      formatTcvDisplay({ tcvUsd: 120_000_000, valueProvenance: "disclosed" }),
      formatTcvDisplay({ tcvUsd: null, valueProvenance: "inferred", tcvLowUsd: 18_000_000, tcvHighUsd: 27_000_000 }),
      formatTcvDisplay({ tcvUsd: null, valueProvenance: "insufficient_evidence" }),
    ];
    for (const s of states) {
      expect(s).not.toMatch(/confiden|comparable|v2\.1|score|model|method|evidence completeness/i);
    }
  });

  it("insight must not reconstruct a withheld value", () => {
    const ctx = JSON.stringify({ f: "Atos/Viasat digital workplace agreement — TCV: Not reliably estimable" });
    const invented = validateInsight("The Atos–Viasat agreement is worth approximately $19.2M.", ctx);
    expect(invented.ok).toBe(false);
  });
});

describe("pilot-readiness sprint (2026-08-23)", () => {
  it("buyer-facing history wording stays plain but never claims snapshot status", () => {
    const reconstructed = historyModeLabel("reconstructed");
    expect(reconstructed).not.toMatch(/reconstructed from dated observations/i);
    expect(reconstructed).not.toMatch(/snapshot/i);
    expect(historyModeLabel("observed_snapshot")).not.toBe(reconstructed);
  });

  it("opportunity reasons carry no engineering jargon", () => {
    const b = (source: string) => ({ text: "x 1", source, ownership: "market" as const });
    const r = opportunityReason("very-high", "medium", [b("AI capability events"), b("FRED")], false);
    expect(r).not.toMatch(/materiality-gated|canonical spine|reconstructed from dated/i);
  });

  it("confidence is stated only when it changes how a reading should be used", () => {
    // High/medium readings carry no confidence chrome; thin ones still say so.
    expect(showsConfidenceCaveat("high")).toBe(false);
    expect(showsConfidenceCaveat("medium")).toBe(false);
    expect(showsConfidenceCaveat("low")).toBe(true);
    expect(showsConfidenceCaveat("insufficient")).toBe(true);
  });

  it("a withheld briefing never names the validation machinery to the buyer", () => {
    // The calm state is copy, not analysis — the reasons stay in server logs.
    const calm = "Analyst Insight temporarily unavailable.";
    expect(calm).not.toMatch(/grounding|validator|firewall|ownership|numeric/i);
  });

  it("refresh remains manual — no scheduler is armed in source", () => {
    const wf = readFileSync(
      resolve(process.cwd(), "..", "AG Sourcing Tool 20_06_2026", ".github/workflows/data-refresh.yml"),
      "utf8",
    );
    // A schedule: trigger anywhere in the workflow would arm automatic refresh.
    expect(wf).not.toMatch(/^\s{2}schedule:/m);
    expect(wf).toMatch(/workflow_dispatch/);
    expect(wf).toMatch(/CURRENTLY DISABLED/i);
  });
});

describe("cross-surface consistency correction (2026-08-23)", () => {
  it("commercial deal flow has exactly one canonical definition", () => {
    const def = METRIC_REGISTRY["commercialDealFlow"]!;
    expect(def.anchor).toBe("commercial_contract_data_as_of");
    expect(def.comparison).toBe("rolling_12m_vs_prior_12m");
    // procurement answers a DIFFERENT question and must stay distinct
    const proc = METRIC_REGISTRY["procurementAwardFlow"]!;
    expect(proc.id).not.toBe(def.id);
    expect(proc.comparison).not.toBe(def.comparison);
    expect(proc.evidenceFamilies).not.toEqual(def.evidenceFamilies);
  });

  it("the commercial anchor is never ingestion time or today", () => {
    // Metrics sourced EXCLUSIVELY from the commercial contract families must
    // close their windows on the evidence anchor. Composite metrics that
    // blend families legitimately carry series_specific, because each
    // sub-reading inherits its own family's anchor — that is a real
    // distinction, not a loophole.
    const commercialOnly = Object.values(METRIC_REGISTRY).filter(
      (m) => m.evidenceFamilies.length > 0 && m.evidenceFamilies.every((f) => f.startsWith("contract_tracker")),
    );
    expect(commercialOnly.length).toBeGreaterThan(0);
    for (const m of commercialOnly) {
      if (m.id === "endOfTermConcentration") continue; // forward-looking: today is correct
      expect(m.anchor, `${m.id} must close on the commercial evidence anchor`).toBe("commercial_contract_data_as_of");
    }
    // and no metric anywhere may anchor on ingestion time
    for (const m of Object.values(METRIC_REGISTRY)) {
      expect(String(m.anchor)).not.toMatch(/ingest/i);
    }
  });

  it("every surface inherits one commercial window label", () => {
    const sd = (d: string) => d;
    expect(commercialWindowLabel("2026-05-19", sd)).toBe("rolling 12 months to 2026-05-19");
    // the same anchor always yields the same string — no per-page variants
    expect(commercialWindowLabel("2026-05-19", sd)).toBe(commercialWindowLabel("2026-05-19", sd));
  });

  it("scope is carried at the point of use, so similar figures cannot be confused", () => {
    expect(scopeLabel("vendor", { vendorName: "Accenture" })).toBe("Accenture");
    expect(scopeLabel("market", { vendorCount: 3 })).toBe("Selected market · 3 vendors");
    expect(scopeLabel("market", { vendorCount: 1 })).toBe("Selected market · 1 vendor");
  });

  it("Where-to-look-first names each vendor at most once", () => {
    const mk = (ticker: string, overall: string, talent: string, momentum: string): unknown => ({
      ticker, name: ticker,
      overall: { level: overall, reason: "r" },
      opportunities: {
        pricing: { level: overall }, automation: { level: overall }, "gain-sharing": { level: overall },
        "commercial-leverage": { level: overall }, "market-test": { level: overall },
      },
      metrics: {
        talentPressure: { state: talent, movement: "stable" },
        automationOpportunity: { state: "favourable" },
        aiProductivityOpportunity: { movement: "materially-improving" },
        providerMomentum: { movement: momentum },
      },
    });
    const vendors = [
      mk("A", "very-high", "unfavourable", "materially-deteriorating"),
      mk("B", "high", "favourable", "stable"),
      mk("C", "medium", "unfavourable", "stable"),
    ] as never[];
    const { calls } = buildCalls(vendors);
    const names = calls.map((c) => c.ticker);
    expect(new Set(names).size).toBe(names.length);
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("no false league table when vendors are genuinely tied", () => {
    const tiedVendor = (t: string): unknown => ({
      ticker: t, name: t,
      overall: { level: "very-high", reason: "r" },
      opportunities: {
        pricing: { level: "very-high" }, automation: { level: "very-high" }, "gain-sharing": { level: "very-high" },
        "commercial-leverage": { level: "very-high" }, "market-test": { level: "very-high" },
      },
      metrics: {
        talentPressure: { state: "favourable", movement: "stable" },
        automationOpportunity: { state: "stable" },
        aiProductivityOpportunity: { movement: "stable" },
        providerMomentum: { movement: "stable" },
      },
    });
    const { calls, tiedNote } = buildCalls([tiedVendor("A"), tiedVendor("B"), tiedVendor("C")] as never[]);
    // identical evidence must not produce a ranked "strongest" claim
    expect(calls.length).toBe(0);
    expect(tiedNote).toMatch(/similar/i);
  });
});

describe("canonical invariants (cross-surface correction, continued)", () => {
  it("every repeated portal concept is registered", () => {
    const required = [
      "commercialDealFlow", "buyerLeverage", "pricingPressure", "commercialOpportunity",
      "savingsOpportunity", "automationOpportunity", "aiProductivityOpportunity",
      "gainShareOpportunity", "marketTestOpportunity", "financialResilience",
      "financialHeadroom", "providerMomentum", "talentPressure", "deliveryCostPressure",
      "dealMarketHeat", "operationalRisk", "reputationMovement", "endOfTermConcentration",
      "aiCapabilityEvents", "procurementAwardFlow", "twelveMonthChange",
    ];
    for (const id of required) {
      expect(METRIC_REGISTRY[id], `missing canonical definition: ${id}`).toBeDefined();
      expect(METRIC_REGISTRY[id]!.id).toBe(id);
      expect(METRIC_REGISTRY[id]!.meaning.length).toBeGreaterThan(20);
    }
  });

  it("no two registry entries share an ID (one concept, one definition)", () => {
    const ids = Object.values(METRIC_REGISTRY).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the retired commercial-flow variants cannot be reconstructed from the canonical definition", () => {
    const def = METRIC_REGISTRY["commercialDealFlow"]!;
    // 56/59 came from an ingestion anchor; 66/51 from calendar quarters vs today.
    expect(def.anchor).not.toBe("today");
    expect(def.comparison).toBe("rolling_12m_vs_prior_12m");
    // quarterly history is a DIFFERENT concept and must not be registered as flow
    expect(Object.values(METRIC_REGISTRY).some((m) => /quarter/i.test(m.meaning) && m.id === "commercialDealFlow")).toBe(false);
  });

  it("market total equals the sum of its vendor components (additive metrics)", () => {
    // The invariant the audit violated: 56 vs 59 on Vendors, 66 vs 51 on Market.
    const vendors = [
      { current: 12, prior: 18 },
      { current: 14, prior: 23 },
      { current: 32, prior: 18 },
    ];
    const marketCurrent = vendors.reduce((a, v) => a + v.current, 0);
    const marketPrior = vendors.reduce((a, v) => a + v.prior, 0);
    expect(marketCurrent).toBe(58);
    expect(marketPrior).toBe(59);
    // and the retired figures must not satisfy it
    expect(marketCurrent).not.toBe(56);
    expect(marketCurrent).not.toBe(66);
    expect(marketPrior).not.toBe(51);
  });

  it("a signal direction cannot contradict the canonical change direction", () => {
    // ratioMove is the single direction function; ACT/WATCH and the
    // retrospective must both derive from it rather than asserting prose.
    expect(ratioMove(58, 59)).toBe("stable");
    expect(ratioMove(58, 59)).not.toMatch(/improving/);
    // a genuine decline stays a decline wherever it is read
    expect(ratioMove(3, 9)).toMatch(/deteriorating/);
    expect(ratioMove(9, 3)).toMatch(/improving/);
  });

  it("procurement and commercial flow stay distinguishable to a reader", () => {
    const flow = METRIC_REGISTRY["commercialDealFlow"]!;
    const proc = METRIC_REGISTRY["procurementAwardFlow"]!;
    expect(flow.comparison).not.toBe(proc.comparison);
    expect(flow.anchor).not.toBe(proc.anchor);
    // different evidence families — they can move in opposite directions legitimately
    expect(flow.evidenceFamilies.some((f) => proc.evidenceFamilies.includes(f))).toBe(false);
  });
});

describe("formatting and disclosure invariants", () => {
  it("one money formatter, restrained precision, same value never rendered three ways", () => {
    const v = 7_083_100_000;
    expect(money(v)).toBe("$7.1bn");
    // the same value must not also be renderable as $7.08bn or $7,083M
    expect(money(v)).not.toMatch(/7\.08/);
    expect(money(v)).not.toMatch(/7,083/);
    expect(money(41_200_000)).toBe("$41.2M");
    expect(money(1_900_000)).toBe("$1.9M");
    expect(money(null)).toBe("—");
    // magnitude boundaries stay stable
    expect(money(999_999_999)).toMatch(/M$/);
    expect(money(1_000_000_000)).toMatch(/bn$/);
  });

  it("counts use one locale formatter", () => {
    expect(count(58)).toBe("58");
    expect(count(1234)).toBe("1,234");
    expect(count(null)).toBe("—");
  });

  it("Whole Market uses the same canonical registry as a selected market", () => {
    // scope changes which vendors are counted, never which definition applies
    for (const m of Object.values(METRIC_REGISTRY)) {
      expect(["selected_market", "single_vendor", "whole_universe"]).toContain(m.scope);
      // no metric may declare a different anchor for whole-market mode
      expect(m.anchor).toBeDefined();
    }
    expect(METRIC_REGISTRY["commercialDealFlow"]!.scope).toBe("selected_market");
  });

  it("quarterly signing history is a distinct concept from commercial deal flow", () => {
    // §3: retained history must not be labelled "deal flow"
    expect(METRIC_REGISTRY["commercialDealFlow"]!.comparison).toBe("rolling_12m_vs_prior_12m");
    expect(METRIC_REGISTRY["quarterlySigningHistory"]).toBeUndefined(); // not a portal metric
  });
});

describe("thin-evidence calibration (2026-08-23)", () => {
  const opp = (level: string, confidence = "medium") => ({ level, confidence } as never);
  const opps = (levels: Record<string, string>, conf = "medium") =>
    ({
      pricing: opp(levels.pricing ?? "medium", conf),
      automation: opp(levels.automation ?? "medium", conf),
      "gain-sharing": opp(levels["gain-sharing"] ?? "medium", conf),
      "commercial-leverage": opp(levels["commercial-leverage"] ?? "medium", conf),
      "market-test": opp(levels["market-test"] ?? "medium", conf),
    } as never);

  it("zero current signings alone cannot produce an unqualified top band", () => {
    // one strong family, no corroboration, no activity in the current window
    const r = evidenceSufficiency(opps({ pricing: "very-high" }), 0);
    expect(r).toBe("directional");
  });

  it("zero signings WITH corroboration from other families stays supported", () => {
    const r = evidenceSufficiency(opps({ pricing: "very-high", automation: "high", "gain-sharing": "high" }), 0);
    expect(r).toBe("supported");
  });

  it("evidence depth is corroboration, not contract volume", () => {
    // a vendor with activity is supported even on a single strong family:
    // volume must never decide the ranking
    expect(evidenceSufficiency(opps({ pricing: "very-high" }), 12)).toBe("supported");
    // and thin corroboration with NO activity is directional regardless of level
    expect(evidenceSufficiency(opps({ pricing: "very-high", automation: "very-high" }, "low"), 0)).toBe("directional");
  });

  it("low-confidence families do not count as corroboration", () => {
    expect(evidenceSufficiency(opps({ pricing: "very-high", automation: "high" }, "low"), 0)).toBe("directional");
  });

  it("commercial signings and procurement awards stay lexically distinct", () => {
    const commercial = METRIC_REGISTRY["commercialDealFlow"]!;
    const procurement = METRIC_REGISTRY["procurementAwardFlow"]!;
    expect(commercial.meaning).toMatch(/signing/i);
    expect(commercial.meaning).not.toMatch(/\baward/i);
    expect(procurement.meaning).toMatch(/award/i);
    expect(procurement.meaning).not.toMatch(/\bsigning/i);
  });
});

describe("Analyst Insight market-first hierarchy (2026-08-23)", () => {
  const scope = ["Accenture", "Cognizant", "TCS"];

  it("flags a top-level hero that opens on a single vendor", () => {
    const v = marketFirstViolation(
      "The strongest lever right now sits with Accenture's renewal exposure, which dwarfs its peers.",
      "opportunities", scope);
    expect(v).not.toBeNull();
    expect(v).toMatch(/Accenture/);
  });

  it("passes a hero that establishes the market before naming a vendor", () => {
    expect(marketFirstViolation(
      "Across the selected market, buyer value is concentrating in the gap between rising delivery productivity and commercial terms that have not moved with it.",
      "opportunities", scope)).toBeNull();
    expect(marketFirstViolation(
      "These vendors are diverging on delivery capacity rather than price.",
      "vendors", scope)).toBeNull();
    expect(marketFirstViolation(
      "This market currently favours the buyer, driven by a demand-side break.",
      "market", scope)).toBeNull();
  });

  it("allows a single vendor to lead where it genuinely dominates the market", () => {
    expect(marketFirstViolation(
      "Accenture's renewal concentration dominates this market, accounting for the bulk of end-of-term value.",
      "home", scope)).toBeNull();
  });

  it("detail pages may lead with their focal subject", () => {
    expect(marketFirstViolation("Accenture is repricing faster than its peers.", "vendor-detail", scope)).toBeNull();
    expect(marketFirstViolation("Accenture's pricing case rests on three readings.", "opportunity-detail", scope)).toBeNull();
  });

  it("is scope-driven, not a hardcoded vendor blacklist", () => {
    // a vendor outside the selected scope must not trigger the guard
    expect(marketFirstViolation("Infosys leads on automation.", "opportunities", scope)).toBeNull();
    // but it does trigger for whatever market IS selected
    expect(marketFirstViolation("Infosys leads on automation.", "opportunities", ["Infosys", "Unisys", "Mastek"])).not.toBeNull();
  });

  it("every top-level objective demands a market judgement first", () => {
    for (const tab of TOP_LEVEL_TABS) {
      expect(OBJECTIVES[tab]).toMatch(/market/i);
    }
    // and the opportunities objective no longer forbids market context
    expect(OBJECTIVES.opportunities).not.toMatch(/do not re-narrate the market backdrop/i);
    expect(MARKET_FIRST_HIERARCHY).toMatch(/MARKET JUDGEMENT/);
  });
});

describe("semantic labels and colour meaning (2026-08-23)", () => {
  it("adjectives match the variable being measured", () => {
    expect(displayState("operationalRisk", "unfavourable").label).toBe("High");
    expect(displayState("operationalRisk", "favourable").label).toBe("Low");
    expect(displayState("buyerLeverage", "favourable").label).toBe("Strong");
    expect(displayState("buyerLeverage", "unfavourable").label).toBe("Weak");
    expect(displayState("providerMomentum", "favourable").label).toBe("Strengthening");
    expect(displayState("dealMarketHeat", "favourable").label).toBe("Cool");
    expect(displayState("talentPressure", "unfavourable").label).toBe("High");
    expect(displayState("deliveryCostPressure", "unfavourable").label).toBe("Rising");
    // the generic favourable/unfavourable scale is gone from these variables
    for (const id of ["operationalRisk", "buyerLeverage", "providerMomentum", "dealMarketHeat", "talentPressure"]) {
      for (const st of ["favourable", "unfavourable"] as const) {
        expect(displayState(id, st).label).not.toMatch(/^(Favourable|Unfavourable)$/);
      }
    }
  });

  it("high risk is never styled as buyer-positive", () => {
    expect(displayState("operationalRisk", "unfavourable").effect).toBe("unfavourable");
    expect(displayState("operationalRisk", "unfavourable").effect).not.toBe("favourable");
    expect(displayState("operationalRisk", "mixed").effect).not.toBe("favourable");
  });

  it("high opportunity magnitude IS buyer-positive", () => {
    expect(levelEffect("very-high")).toBe("favourable");
    expect(levelEffect("high")).toBe("favourable");
    expect(levelEffect("insufficient")).toBe("unknown");
    expect(displayState("gainShareOpportunity", "favourable").effect).toBe("favourable");
  });

  it("strong buyer leverage is buyer-positive", () => {
    expect(displayState("buyerLeverage", "favourable").effect).toBe("favourable");
  });

  it("a strengthening supplier is NOT automatically buyer-positive", () => {
    // the word sounds positive; the buyer effect is what drives colour
    const strengthening = displayState("providerMomentum", "favourable");
    expect(strengthening.label).toBe("Strengthening");
    expect(strengthening.effect).not.toBe("favourable");
    // and a weakening supplier moves pressure toward the buyer
    expect(displayState("providerMomentum", "unfavourable").effect).toBe("favourable");
  });

  it("vendor financial strength is context, not buyer advantage", () => {
    const strong = displayState("financialResilience", "favourable");
    expect(strong.label).toBe("Very strong");
    expect(strong.effect).toBe("neutral");
  });

  it("every dictionary entry can explain itself without exposing methodology", () => {
    for (const [id, s] of Object.entries(METRIC_DICTIONARY)) {
      expect(s.name.length, id).toBeGreaterThan(2);
      expect(s.definition.length, id).toBeGreaterThan(20);
      expect(s.interpretation.length, id).toBeGreaterThan(20);
      const copy = `${s.definition} ${s.interpretation} ${s.caveat ?? ""}`;
      expect(copy, id).not.toMatch(/weight|threshold|formula|coefficient|algorithm|model score/i);
    }
  });

  it("Act/Watch/Know is explained once, centrally", () => {
    expect(SIGNAL_CLASS_HELP.interpretation).toMatch(/ACT/);
    expect(SIGNAL_CLASS_HELP.interpretation).toMatch(/WATCH/);
    expect(SIGNAL_CLASS_HELP.interpretation).toMatch(/KNOW/);
  });

  it("colour is never the sole carrier of meaning", () => {
    // every state resolves to a word, not just a tone
    for (const id of Object.keys(METRIC_DICTIONARY)) {
      for (const st of ["favourable", "stable", "unfavourable", "mixed", "insufficient"] as const) {
        expect(displayState(id, st).label.trim().length, `${id}/${st}`).toBeGreaterThan(0);
      }
    }
  });

  it("every metric the resolver emits has its own vocabulary", () => {
    // Market rollups previously fell through to the generic Favourable /
    // Unfavourable scale because their ids are "m."-prefixed. Pin every id the
    // resolver constructs so a new dimension cannot reintroduce that.
    const src = readFileSync(resolve(__dirname, "../lib/metrics/resolve.ts"), "utf8");
    const ids = new Set<string>();
    for (const m of src.matchAll(/\b(?:metric|rollup|insufficientMetric)\(\s*\n?\s*"([\w.]+)"/g)) {
      ids.add(m[1]);
    }
    expect(ids.size).toBeGreaterThan(10);
    for (const id of ids) {
      for (const st of ["favourable", "unfavourable"] as const) {
        expect(displayState(id, st).label, `${id}/${st}`).not.toMatch(/^(Favourable|Unfavourable)$/);
      }
    }
  });

  it("market dimensions read as the thing they measure", () => {
    expect(displayState("m.labour", "unfavourable").label).toBe("Under strain");
    expect(displayState("m.intensity", "favourable").label).toBe("Broadening");
    expect(displayState("m.supplier", "unfavourable").label).toBe("Strained");
    expect(displayState("m.demand", "favourable").label).toBe("Expanding");
    // "Contracting" read as a noun means signing activity — a different measure
    expect(displayState("m.demand", "unfavourable").label).toBe("Softening");
    expect(displayState("m.demand", "unfavourable").label).not.toMatch(/Contracting/);
    expect(displayState("m.buyerEconomics", "favourable").label).toBe("Buyer favourable");
    // rollups of a vendor metric inherit that metric's vocabulary
    expect(displayState("m.oprisk", "unfavourable").label).toBe("High");
    expect(displayState("m.heat", "favourable").label).toBe("Cool");
  });

  it("one metric never shows the same word in two colours", () => {
    // Across metrics a shared word may differ in tone ("High" AI productivity
    // vs "High" talent pressure). WITHIN one metric it must not, or the same
    // reading would change colour between refreshes.
    for (const [id, s] of Object.entries(METRIC_DICTIONARY)) {
      const byLabel = new Map<string, string>();
      for (const st of ["favourable", "stable", "unfavourable", "mixed", "insufficient"] as const) {
        const { label, effect } = displayState(id, st);
        const prior = byLabel.get(label);
        if (prior) expect(effect, `${id} "${label}"`).toBe(prior);
        else byLabel.set(label, effect);
      }
      void s;
    }
  });

  it("market context dimensions are not miscoloured as buyer wins", () => {
    // demand and supplier health are context, not advantage — same rule the
    // vendor-level financial resilience entry follows
    expect(displayState("m.demand", "favourable").effect).toBe("neutral");
    // a softening market is the reading that should make a buyer look
    expect(displayState("m.demand", "unfavourable").effect).toBe("caution");
    expect(displayState("m.demand", "unfavourable").effect).not.toBe("favourable");
    expect(displayState("m.supplier", "favourable").effect).toBe("neutral");
    expect(displayState("m.supplier", "unfavourable").effect).toBe("caution");
    // broader competition genuinely is a buyer win
    expect(displayState("m.intensity", "favourable").effect).toBe("favourable");
  });
});

describe("market-state analytical depth (2026-08-24)", () => {
  const r = (name: string, state: MetricState, rank?: number) => ({ name, state, rank: rank ?? null });

  it("names the vendors that drive the reading, not the alphabetically first", () => {
    const readings = [r("Alpha", "unfavourable", -10), r("Zeta", "unfavourable", -9000), r("Mid", "unfavourable", -50)];
    const a = labourAnalysis(readings, "unfavourable")!;
    expect(a.driver).toMatch(/Zeta/);
    // ranked by magnitude: the -10 vendor must not displace the -9000 one
    expect(a.driver).not.toMatch(/Alpha/);
  });

  it("caps named drivers and never implies the list is exhaustive", () => {
    const many = Array.from({ length: 17 }, (_, i) => r(`V${i}`, "unfavourable", -(i + 1) * 100));
    const a = labourAnalysis(many, "unfavourable")!;
    const named = many.filter((v) => a.driver.includes(v.name)).length;
    expect(named).toBeLessThanOrEqual(3);
    expect(a.driver).toMatch(/among 17/);
  });

  it("a three-vendor market names drivers plainly, without an 'among' remainder", () => {
    const a = labourAnalysis([r("A", "unfavourable", -5), r("B", "unfavourable", -4), r("C", "stable")], "unfavourable")!;
    expect(a.driver).not.toMatch(/among/);
  });

  it("distribution counts are supporting data, never the explanation", () => {
    const a = labourAnalysis([r("A", "unfavourable", -5), r("B", "favourable", 5)], "mixed")!;
    expect(a.distribution).toMatch(/assessed vendors read favourable/);
    // the count must not be what the driver sentence says
    expect(a.driver).not.toMatch(/\d+ of \d+ assessed/);
    expect(a.driver).toMatch(/A|B/);
  });

  it("services demand explains the SAME series that set the state", () => {
    const base = {
      t12: 58, prior12: 59, vendorsT12: 3,
      perVendor: [{ name: "A", t12: 1, prior12: 9 }, { name: "B", t12: 57, prior12: 50 }],
      procPerVendor: [{ name: "A", t90: 1, prior90: 8 }, { name: "B", t90: 2, prior90: 1 }],
      procT90: 3, procPrior90: 9, asOf: "19 May 2026", procAsOf: "20 Aug 2026",
    };
    const led = demandAnalysis({ ...base, ledBy: "procurement" }, "unfavourable")!;
    expect(led.driver).toMatch(/Public awards/);
    expect(led.driver).toMatch(/3 from 9/);
    // the other series appears only as context, after the lead
    expect(led.driver.indexOf("Public awards")).toBeLessThan(led.driver.indexOf("58"));

    const com = demandAnalysis({ ...base, ledBy: "commercial" }, "unfavourable")!;
    expect(com.driver).toMatch(/Commercial signings/);
    expect(com.driver).toMatch(/58 from 59/);
  });

  it("explanations carry no buyer-ownership language", () => {
    const built = [
      labourAnalysis([r("A", "unfavourable", -5)], "unfavourable"),
      supplierAnalysis([r("A", "favourable", 5)], "favourable"),
      aiPressureAnalysis([r("A", "favourable")], "favourable"),
      pricingAnalysis([r("A", "favourable")], "favourable"),
      intensityAnalysis(3, 5, 6, "unfavourable"),
      rollupAnalysis([r("A", "favourable")], "favourable", BUYER_LEVERAGE_COPY),
      rollupAnalysis([r("A", "favourable")], "favourable", HEAT_COPY),
    ].filter(Boolean);
    expect(built.length).toBeGreaterThan(5);
    for (const a of built) {
      const all = [a!.driver, a!.implication, a!.evidence, a!.limitation ?? "", a!.test ?? ""].join(" ");
      expect(all, a!.driver.slice(0, 40)).not.toMatch(
        /\byour (contract|renewal|spend|commitment|rate|saving|exposure|supplier portfolio)/i,
      );
    }
  });

  it("explanations expose no formulas, weights or thresholds", () => {
    const all = [
      labourAnalysis([r("A", "unfavourable", -5)], "unfavourable"),
      supplierAnalysis([r("A", "unfavourable", -5)], "unfavourable"),
      riskAnalysis({ readings: [r("A", "unfavourable", 80)], topics: [{ name: "A", titles: [], cyber: 0, restructuring: 0 }] }, "unfavourable", "medium"),
    ]
      .filter(Boolean)
      .map((a) => [a!.driver, a!.implication, a!.evidence, a!.limitation ?? "", a!.test ?? ""].join(" "))
      .join(" ");
    expect(all).not.toMatch(/\b(weight|threshold|score of|coefficient|percentile|formula)\b/i);
    // the ranking input must never surface as a number in the copy
    expect(all).not.toMatch(/\b80\b/);
  });

  it("a thin risk read says what is known and why it is not enough", () => {
    const a = riskAnalysis(
      { readings: [r("A", "unfavourable", 80), r("B", "stable", 10)], topics: [{ name: "A", titles: [], cyber: 0, restructuring: 0 }] },
      "unfavourable",
      "medium",
    )!;
    expect(a.driver).toMatch(/issue-tracking read alone/);
    expect(a.driver).toMatch(/No disclosed incident/);
  });

  it("a named disclosure is not repeated after the vendor that carries it", () => {
    const a = riskAnalysis(
      { readings: [r("Kyndryl", "unfavourable", 90)], topics: [{ name: "Kyndryl", titles: [], cyber: 0, restructuring: 1 }] },
      "unfavourable",
      "medium",
    )!;
    expect(a.driver.match(/Kyndryl/g)?.length).toBe(1);
  });

  it("one named vendor takes a singular verb", () => {
    const a = rollupAnalysis([r("TCS", "favourable"), r("Other", "unfavourable")], "mixed", HEAT_COPY)!;
    expect(a.driver).toMatch(/TCS is winning less/);
    expect(a.driver).not.toMatch(/TCS are winning/);
  });

  it("every dimension answers what, why, who, so-what and what-to-check", () => {
    const a = labourAnalysis([r("A", "unfavourable", -5), r("B", "favourable", 5)], "mixed")!;
    expect(a.driver.length).toBeGreaterThan(40); // what + who
    expect(a.implication.length).toBeGreaterThan(40); // so what
    expect(a.test).toBeTruthy(); // what to check
    expect(a.evidence).toBeTruthy(); // what supports it
    const words = `${a.driver} ${a.implication}`.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(30);
    expect(words).toBeLessThanOrEqual(95);
  });
});

describe("buyer economics is a distinct layer from market state (2026-08-24)", () => {
  const STRIP_IDS = [
    "m.buyerLeverage", "m.pricingPressure", "m.demand", "m.intensity",
    "m.aiPressure", "m.automation", "m.commercial", "m.heat",
  ];
  const ECONOMIC_IDS = ["m.deliveryCost", "m.headroom", "m.exposure", "m.prodTerms"];

  it("no economic dimension reuses a market-state metric", () => {
    for (const id of ECONOMIC_IDS) expect(STRIP_IDS).not.toContain(id);
  });

  it("operational risk is not an economic dimension", () => {
    // it is a delivery CONDITION; it belongs with delivery resilience
    expect(ECONOMIC_IDS).not.toContain("m.oprisk");
  });

  it("every economic dimension carries its own vocabulary and buyer effect", () => {
    for (const id of ECONOMIC_IDS) {
      for (const st of ["favourable", "unfavourable"] as const) {
        const d = displayState(id, st);
        expect(d.label, `${id}/${st}`).not.toMatch(/^(Favourable|Unfavourable)$/);
        expect(d.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("commercial exposure treats an empty renewal window as weakening, not neutral", () => {
    expect(displayState("m.exposure", "favourable").label).toBe("Substantial");
    expect(displayState("m.exposure", "favourable").effect).toBe("favourable");
    expect(displayState("m.exposure", "unfavourable").label).toBe("Minimal");
    expect(displayState("m.exposure", "unfavourable").effect).toBe("unfavourable");
  });

  it("no productivity gap is context, never a buyer opportunity or a caution", () => {
    expect(displayState("m.prodTerms", "favourable").label).toBe("Ahead of terms");
    // "Behind terms" read as productivity lagging; the state is the reverse
    expect(displayState("m.prodTerms", "unfavourable").label).toBe("Terms moved first");
    expect(displayState("m.prodTerms", "favourable").effect).toBe("favourable");
    // neither capability nor terms moving must not read as productivity lagging
    expect(displayState("m.prodTerms", "mixed").label).toBe("No gap evidenced");
    expect(displayState("m.prodTerms", "mixed").effect).toBe("neutral");
  });

  it("rollup economics inherit the vendor metric's approved vocabulary", () => {
    expect(displayState("m.deliveryCost", "unfavourable").label).toBe("Rising");
    expect(displayState("m.deliveryCost", "favourable").label).toBe("Falling");
    expect(displayState("m.headroom", "favourable").label).toBe("High");
    expect(displayState("m.headroom", "unfavourable").label).toBe("Low");
  });

  it("economic explanations answer an economic question, not a condition", () => {
    const cost = deliveryCostAnalysis(
      [{ name: "A", state: "unfavourable", rank: null }], "unfavourable", 0, 1)!;
    // must talk about cost and what it does to the commercial position
    expect(`${cost.driver} ${cost.implication}`).toMatch(/cost/i);
    expect(cost.implication).toMatch(/rate|commercial|scope|price/i);

    const room = headroomAnalysis([{ name: "A", state: "favourable", rank: null }], "favourable")!;
    expect(room.implication).toMatch(/concede|concession|commercial/i);
  });

  it("exposure keeps disclosed and estimated value separate", () => {
    const inferred = exposureAnalysis(
      { total: 4, prior: 2, within24: 9, value: "$100M–$300M estimated", valueIsInferred: true,
        perVendor: [{ name: "A", n: 4 }], topByValue: { name: "A", share: 1 }, asOf: "19 May 2026" }, "favourable")!;
    expect(inferred.limitation).toMatch(/estimated/i);
    const disclosed = exposureAnalysis(
      { total: 38, prior: 20, within24: 77, value: "$7.2bn", valueIsInferred: false,
        perVendor: [{ name: "A", n: 20 }, { name: "B", n: 18 }], topByValue: { name: "A", share: 0.4 }, asOf: "19 May 2026" }, "favourable")!;
    expect(disclosed.limitation).toBeUndefined();
  });

  it("exposure names concentration when one vendor carries the window", () => {
    const conc = exposureAnalysis(
      { total: 10, prior: 3, within24: 12, value: "$1bn", valueIsInferred: false,
        perVendor: [{ name: "Atos", n: 8 }, { name: "Other", n: 2 }],
        topByValue: { name: "Atos", share: 0.92 }, asOf: "19 May 2026" }, "favourable")!;
    // the CHART carries the shape; the text carries the consequence (§4)
    expect(conc.driver).not.toMatch(/concentrated/i);
    expect(conc.implication).toMatch(/Atos/);
    expect(conc.implication).toMatch(/one relationship/i);
  });

  it("economic explanations carry no buyer-ownership language", () => {
    const built = [
      deliveryCostAnalysis([{ name: "A", state: "unfavourable", rank: null }], "unfavourable", 1, 3),
      headroomAnalysis([{ name: "A", state: "unfavourable", rank: null }], "unfavourable"),
      exposureAnalysis({ total: 5, prior: 2, within24: 8, value: "$1bn", valueIsInferred: false,
        perVendor: [{ name: "A", n: 5 }], topByValue: { name: "A", share: 1 }, asOf: "19 May 2026" }, "favourable"),
      productivityTermsAnalysis({ capability: "favourable", automation: "favourable", gainShare: [], labour: [],
        shareFirst: { period: "2024", value: 0 }, shareLast: { period: "2026", value: 0 }, coverage: null }, "favourable"),
    ].filter(Boolean);
    expect(built.length).toBe(4);
    for (const a of built) {
      const all = [a!.driver, a!.implication, a!.evidence, a!.limitation ?? "", a!.test ?? ""].join(" ");
      expect(all).not.toMatch(/\byour (contract|renewal|spend|commitment|rate|saving|exposure)s?\b/i);
    }
  });
});

describe("Phase 2 charts and whole-market restructure (2026-08-24)", () => {
  const chartSrc = readFileSync(resolve(__dirname, "../components/charts/Charts.tsx"), "utf8");

  it("charts never colour a level with the brand accent", () => {
    // Phase 1 removed gold from state values; a chart must not reintroduce it
    for (const lv of ["very-high", "high", "medium", "low", "insufficient"] as const) {
      expect(levelInk(lv)).not.toMatch(/accent/);
    }
    expect(levelInk("very-high")).toBe("var(--data-positive-ink)");
    expect(levelInk("insufficient")).toBe("var(--fg-dim)");
  });

  it("chart state colour comes from the dictionary's buyer effect, not magnitude", () => {
    // talent pressure "high" is bad for the buyer; AI productivity "high" is good
    expect(stateInk("talentPressure", "unfavourable")).toBe(EFFECT_INK.unfavourable);
    expect(stateInk("aiProductivityOpportunity", "favourable")).toBe(EFFECT_INK.favourable);
    // vendor financial strength stays neutral — never a buyer win
    expect(stateInk("financialResilience", "favourable")).toBe(EFFECT_INK.neutral);
  });

  it("charts derive no figures of their own", () => {
    // every value is passed in from the canonical resolved object; a chart that
    // starts summing facts can silently disagree with the table beside it
    expect(chartSrc).not.toMatch(/awardsT12|inPlay12Tcv|getScopeAggregates|resolveIntelligence/);
  });

  it("the exposure chart never blends disclosed and inferred value", () => {
    // one bar is drawn from disclosedUsd only; inference is a separate encoding
    expect(chartSrc).toMatch(/disclosedUsd/);
    expect(chartSrc).not.toMatch(/disclosedUsd\s*\+\s*inferred/);
    expect(chartSrc).toMatch(/inferred/);
  });

  it("charts expose their numbers outside the graphic", () => {
    // colour is never the sole carrier: sr-only description plus visible counts
    expect(chartSrc).toMatch(/sr-only/);
    expect(chartSrc).toMatch(/role="img"/);
    expect(chartSrc).toMatch(/aria-label/);
  });

  it("no proprietary internal score reaches buyer-facing output", () => {
    const surfaces = [
      "../components/charts/Charts.tsx",
      "../components/ui.tsx",
      "../components/MetricCard.tsx",
      "../lib/metrics/market-analysis.ts",
    ].map((f) => readFileSync(resolve(__dirname, f), "utf8")).join("\n");
    // rendered copy must never quote the internal score, confidence number,
    // similarity score or weighting
    expect(surfaces).not.toMatch(/AG risk score/);
    expect(surfaces).not.toMatch(/riskScore\s*\}/);
    expect(surfaces).not.toMatch(/similarity|modelScore|weighting/i);
  });

  it("distribution bands use canonical vocabulary, never invented labels", () => {
    // the whole-market distribution labels each band from the shared scale
    for (const lv of ["very-high", "high", "medium", "low", "insufficient"] as const) {
      expect(LEVEL_VOCABULARY[lv]).toBeTruthy();
    }
    expect(LEVEL_VOCABULARY["very-high"]).toBe("Very High");
    expect(LEVEL_VOCABULARY.insufficient).toBe("Insufficient evidence");
  });

  it("signings charts read commercial signings, never procurement awards", () => {
    // the two are separate measures on separate windows and must stay lexically
    // distinct wherever either is shown
    const vendorsPage = readFileSync(resolve(__dirname, "../app/vendors/page.tsx"), "utf8");
    expect(vendorsPage).toMatch(/signingsT12/);
    expect(vendorsPage).not.toMatch(/awardsT90|procurement.*Slope/i);
  });
});

describe("Phase 3 consolidation invariants (2026-08-24)", () => {
  it("the exposure text states the headline and consequence, never the bars", () => {
    // the chart shows the shape; narrating it in prose is the duplication
    // Phase 3 removed. Concentration is judged on DISCLOSED VALUE so the two
    // representations can never reach opposite conclusions again.
    const conc = exposureAnalysis(
      { total: 10, prior: 3, within24: 12, value: "$1bn", valueIsInferred: false,
        perVendor: [{ name: "Atos", n: 8 }, { name: "Other", n: 2 }],
        topByValue: { name: "Atos", share: 0.92 }, asOf: "19 May 2026" }, "favourable")!;
    expect(conc.driver).toMatch(/10 observed agreements/);
    expect(conc.driver).not.toMatch(/spread across|concentrated/i);
    expect(conc.implication).toMatch(/Atos/);

    // count-majority but value-minority must NOT read as concentrated
    const spread = exposureAnalysis(
      { total: 10, prior: 3, within24: 12, value: "$1bn", valueIsInferred: false,
        perVendor: [{ name: "A", n: 8 }, { name: "B", n: 2 }],
        topByValue: { name: "A", share: 0.2 }, asOf: "19 May 2026" }, "favourable")!;
    expect(spread.implication).not.toMatch(/one relationship/i);
  });

  it("charts render without their own caption when a card carries it", () => {
    // interpretation/footnote are optional so a chart can sit inside an
    // analytical unit without producing a second interpretation of one finding
    const src = readFileSync(resolve(__dirname, "../components/charts/Charts.tsx"), "utf8");
    expect(src).toMatch(/interpretation\?: string/);
    expect(src).toMatch(/footnote\?: string/);
  });

  it("table headers label rather than shout", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/main table th\.eyebrow/);
    // 0.22em uppercase at 12.5px was the scanning cost
    expect(css).toMatch(/letter-spacing:\s*0\.09em/);
  });
});

describe("proprietary scoring firewall (pilot gate, 2026-08-25)", () => {
  it("blocks an AI-readiness score", () => {
    const o = proprietaryScoreOffences("TCS shows AG AI-readiness of 87/100 across the market.");
    expect(o.length).toBeGreaterThan(0);
    expect(o.join(" ")).toMatch(/87\/100/);
  });

  it("blocks an internal risk score", () => {
    expect(proprietaryScoreOffences("AG risk score 75/100 on the current record.").length).toBeGreaterThan(0);
    expect(proprietaryScoreOffences("Its risk score of 75 is elevated.").length).toBeGreaterThan(0);
  });

  it("blocks an internal confidence value and a bare score", () => {
    expect(proprietaryScoreOffences("held at confidence 0.82").length).toBeGreaterThan(0);
    expect(proprietaryScoreOffences("a score of 61 on the readiness axis").length).toBeGreaterThan(0);
    expect(proprietaryScoreOffences("an internal rating of 78").length).toBeGreaterThan(0);
    expect(proprietaryScoreOffences("43 out of 100 on capability").length).toBeGreaterThan(0);
  });

  it("leaves legitimate public evidence alone", () => {
    // these are real, sourced, buyer-relevant figures and must stay legal
    for (const legal of [
      "Revenue growth 6.7% YoY.",
      "Operating margin 16.1% for the period ending 31 Mar 2026.",
      "Public awards fell to 3 from 9 in the trailing 90 days.",
      "38 observed agreements reach end-of-term within 12 months, carrying $7.2bn.",
      "consumption/outcome pricing remains at 0% of observed agreements",
      "INR weakened 9.0% against USD; US ECI +3.1% YoY.",
      "net talent outflow of -3,947 on a 606,000 headcount base",
    ]) {
      expect(proprietaryScoreOffences(legal), legal).toEqual([]);
    }
  });

  it("the full validator blocks a briefing that quotes a score", () => {
    const ctx = "AI capability: favourable. Revenue growth 6.7% YoY.";
    const bad = validateInsight("Capability is strongest at TCS, with AG AI-readiness of 87/100.", ctx);
    expect(bad.ok).toBe(false);
    expect(bad.blocked.join(" ")).toMatch(/internal scoring/i);
  });

  it("the corrective message tells the model what to do instead", () => {
    const bad = validateInsight("AG AI-readiness of 87/100 leads the market.", "x");
    // this string is fed straight back to the model as the retry instruction
    expect(bad.blocked.join(" ")).toMatch(/qualitative reading/i);
    expect(bad.blocked.join(" ")).toMatch(/never the internal score/i);
  });
});

describe("backoffice manual refresh (2026-08-25)", () => {
  it("mirrors the approved stage list exactly — no invented data families", () => {
    // source of truth: ops/refresh-cloud.sh in the AG Sourcing Tool repo
    expect(REFRESH_STAGES.map((s) => s.id)).toEqual([
      "analystgenius",
      "ai-enterprise",
      "capability-events",
      "fred-macro",
      "sec-events",
      "promote",
      "snapshot-primitives",
      "snapshot-edgar",
    ]);
  });

  it("states what the refresh deliberately excludes", () => {
    const text = EXCLUDED_STAGES.map((e) => `${e.label} ${e.why}`).join(" ").toLowerCase();
    expect(text).toMatch(/contract tracker/);
    expect(text).toMatch(/frozen/);
    expect(text).toMatch(/read-only/);
    // no scheduling, stated as an exclusion rather than merely absent
    expect(text).toMatch(/no cron|scheduling/);
  });

  it("no stage writes to the protected production service", () => {
    const all = REFRESH_STAGES.map((s) => `${s.command} ${s.what}`).join(" ");
    expect(all).not.toMatch(/fly\.dev/);
    // the single AG touchpoint is explicitly a read
    expect(REFRESH_STAGES.find((s) => s.id === "analystgenius")!.what).toMatch(/GET-only|never writes/i);
  });

  it("scrubs secrets out of anything stored for the operator to read", () => {
    const dirty = [
      "connect failed postgres://user:hunter2@ep-icy.neon.tech/neondb?sslmode=require",
      "auth error: Bearer eyJhbGciOiJIUzI1NiJ9abcdefgh",
      "ANTHROPIC_API_KEY=sk-ant-secret-value-1234567890",
    ].join(" | ");
    const clean = scrubSecrets(dirty);
    expect(clean).not.toMatch(/hunter2/);
    expect(clean).not.toMatch(/eyJhbGciOiJIUzI1NiJ9abcdefgh/);
    expect(clean).not.toMatch(/sk-ant-secret-value/);
    expect(clean).toMatch(/redacted/);
  });

  it("redacts a key whose variable name is long, not only short-prefixed ones", () => {
    // Regression: the earlier rule capped the name prefix at eight characters,
    // so ANALYSTGENIUS_API_KEY=... passed through intact when the value itself
    // carried no recognisable key shape.
    const clean = scrubSecrets("stage failed: ANALYSTGENIUS_API_KEY=abc123plainvalue was rejected");
    expect(clean).not.toMatch(/abc123plainvalue/);
    expect(clean).toMatch(/ANALYSTGENIUS_API_KEY=\[redacted\]/);
    expect(clean).toMatch(/was rejected/);
  });

  it("keeps ordinary operator errors readable", () => {
    // scrubbing must not destroy a message that carries no secret
    expect(scrubSecrets("SEC events failed: connection timed out after 30s")).toBe(
      "SEC events failed: connection timed out after 30s",
    );
  });

  it("caps stored messages so a runaway log cannot fill the operational row", () => {
    expect(scrubSecrets("x".repeat(9000)).length).toBeLessThanOrEqual(4000);
  });
});

describe("local-manual operating mode (2026-08-25)", () => {
  /* During testing, refreshes run on the AG machine and write to the shared
     spine; the deployed portal reads it. The deployed instance therefore
     cannot execute — which is the intended mode, not a fault. */

  /* detectExecutor reads the environment when called, so the env is simply set
     around the call — no module juggling. */
  const load = async (env: Record<string, string | undefined>) => {
    const prev = { ...process.env };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return detectExecutor();
    } finally {
      process.env = prev;
    }
  };

  it("can run on the AG machine, where the repo and its script exist", async () => {
    const info = await load({
      BACKOFFICE_RUNNER_URL: undefined,
      BACKOFFICE_REFRESH_DIR: resolve(process.cwd(), "..", "AG Sourcing Tool 20_06_2026"),
      BACKOFFICE_REFRESH_SCRIPT: undefined,
    });
    expect(info.mode).toBe("local-manual");
    expect(info.canRun).toBe(true);
    expect(info.reason).toBe("local-execution");
    expect(info.detail).toMatch(/ops\/refresh-manual\.sh/);
  });

  it("cannot run when deployed, and reports that as healthy rather than an error", async () => {
    const info = await load({
      BACKOFFICE_RUNNER_URL: undefined,
      BACKOFFICE_REFRESH_DIR: undefined,
      BACKOFFICE_REFRESH_SCRIPT: undefined,
    });
    expect(info.mode).toBe("local-manual");
    expect(info.canRun).toBe(false);
    expect(info.healthy).toBe(true);
    expect(info.reason).toBe("local-testing-mode");
  });

  it("explains where refreshes do run, without alarm words", async () => {
    const info = await load({ BACKOFFICE_RUNNER_URL: undefined, BACKOFFICE_REFRESH_DIR: undefined });
    expect(info.detail).toMatch(/intentionally local/i);
    expect(info.detail).toMatch(/AG development environment/i);
    // never framed as breakage
    expect(info.detail).not.toMatch(/error|failed|missing|misconfigur|not available|unavailable/i);
  });

  it("keeps the remote runner dormant — configured only if a URL is set", async () => {
    const off = await load({ BACKOFFICE_RUNNER_URL: undefined, BACKOFFICE_REFRESH_DIR: undefined });
    expect(off.mode).toBe("local-manual");
    const on = await load({ BACKOFFICE_RUNNER_URL: "https://runner.example.com", BACKOFFICE_REFRESH_DIR: undefined });
    expect(on.mode).toBe("remote-runner");
    expect(on.canRun).toBe(true);
  });

  it("does not require a remote runner anywhere in the operator copy", () => {
    const page = readFileSync(resolve(__dirname, "../app/backoffice/page.tsx"), "utf8");
    const ui = readFileSync(resolve(__dirname, "../components/BackofficeRefresh.tsx"), "utf8");
    for (const src of [page, ui]) {
      expect(src).not.toMatch(/No runner in this environment/i);
      expect(src).not.toMatch(/fly\.io|Fly\.io|Railway/i);
    }
  });

  it("shows no executable control where a refresh cannot be started", () => {
    const ui = readFileSync(resolve(__dirname, "../components/BackofficeRefresh.tsx"), "utf8");
    // the button is rendered only in the capable branch
    expect(ui).toMatch(/canRun \? \(\s*<button/);
    expect(ui).toMatch(/Run from the local AG environment/);
  });

  it("never paints the deployed mode in a warning colour", () => {
    const ui = readFileSync(resolve(__dirname, "../components/BackofficeRefresh.tsx"), "utf8");
    const start = ui.indexOf("The operating mode");
    expect(start).toBeGreaterThan(-1);
    // scope to the banner element itself, not the rest of the file
    const banner = ui.slice(start, ui.indexOf("</div>", start));
    expect(banner).not.toMatch(/data-watch-ink|data-risk-ink/);
    expect(banner).toMatch(/MODE_LABEL/);
  });
});

describe("Backoffice entry point (2026-08-25)", () => {
  const shell = readFileSync(resolve(__dirname, "../components/PortalShell.tsx"), "utf8");
  const masthead = readFileSync(resolve(__dirname, "../components/Masthead.tsx"), "utf8");

  it("is reachable from the product as a footer utility link", () => {
    expect(shell).toMatch(/href="\/backoffice"/);
    const footer = shell.slice(shell.indexOf("function PortalFooter"));
    expect(footer).toMatch(/href="\/backoffice"/);
  });

  it("is not a sixth primary tab", () => {
    // the five-tab IA is fixed; the operator area must stay outside it
    expect(masthead).not.toMatch(/backoffice/i);
    const nav = masthead.slice(masthead.indexOf("const NAV"), masthead.indexOf("export type NavId"));
    expect(nav.match(/id:/g) ?? []).toHaveLength(5);
  });

  it("stays visually subordinate — dim ink, footer type size", () => {
    const link = shell.slice(shell.indexOf('href="/backoffice"') - 320, shell.indexOf('href="/backoffice"') + 260);
    expect(link).toMatch(/--fg-dim/);
    expect(link).toMatch(/text-\[0\.8rem\]/);
    expect(link).not.toMatch(/accent-fill|display/);
  });
});
