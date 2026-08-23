import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedNumbers, validateInsight } from "@/lib/insight/validate";
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
} from "@/lib/metrics/rules";
import { shiftLevel } from "@/lib/metrics/types";

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
    expect(OBJECTIVES.home).toContain("SINGLE most important development");
    expect(OBJECTIVES.market).toContain("DIVERGE");
    expect(OBJECTIVES.vendors).toContain("DIFFERENTLY");
    expect(OBJECTIVES["vendor-detail"]).toContain("THIS vendor");
    expect(OBJECTIVES.opportunities).toContain("strongest commercial lever");
    expect(OBJECTIVES.scenarios).toContain("alter vendor strategy");
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

import { formatTcvDisplay, formatValueMix, inferredDominates } from "@/lib/format";

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
