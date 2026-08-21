import { describe, expect, it } from "vitest";
import { allowedNumbers, validateInsight } from "@/lib/insight/validate";
import { baselineFrom, parseCookieValue, scopedTickers, tickersFromParam } from "@/lib/scope-core";
import {
  allowedAiEnterprisePillar,
  assertHistoryMode,
  capConfidenceByAge,
  headroomState,
  historyModeLabel,
  isAllowedPricingSource,
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
    expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(200);
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
    expect(historyModeLabel("reconstructed")).toContain("reconstructed");
    expect(historyModeLabel("observed_snapshot")).toContain("observed");
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
