import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  actionExists, actionQuality, classifyHeadline, contentlessAct, crossPageConsistency,
  crossCategoryRanking, datePresent, emptyHeadline, evidenceBalance, fourQuestionChain,
  freshnessSemantics, headlineQuality, honestInsufficiency, movementPolarity,
  ownershipFirewall, provenancePresent, rawFormNumberFinding, scoreFirewall, scoreInsight,
  topIssuesSupportingOnly, type BdqFinding,
} from "@/scripts/bdq/checks";
import { BUYER_TASKS, BDQ_SCOPES, CONTROL_VENDORS, THIN_EVIDENCE_VENDORS } from "@/scripts/bdq/spec";

/**
 * Tests for the BDQ harness itself.
 *
 * A gate nobody has tried to break is not a gate. Every detector is handed a
 * healthy fixture (must pass) and then the same fixture with one defect
 * introduced (must fail). Mutation happens HERE, on fixtures — never against
 * production data.
 *
 * These run inside the ordinary `pnpm test` suite: no database, no network,
 * no model, so the harness stays verifiable even when the portal's own
 * dependencies are unavailable.
 */

/* ── healthy fixtures ─────────────────────────────────────────────────────── */

const healthyFinding = (): BdqFinding => ({
  id: "whole.ACN.buyerLeverage",
  surface: "vendor",
  label: "Buyer leverage",
  state: "favourable",
  movement: "improving",
  headline: "Renewal concentration is building",
  analysis: {
    driver: "17 observed agreements reach end-of-term within 12 months.",
    implication: "Buyers with comparable agreements may have unusual room to press on structure.",
    test: "Whether pricing structure survives comparison with the market record.",
    evidence: "Curated contract record · scoped vendors only",
  },
  basis: [{ text: "17 agreements reach end-of-term in the next 12 months.", source: "Curated contract tracker (market record)", asOf: "2026-05-19" }],
  confidence: "medium",
  insufficient: false,
});

const clean = [{ id: "f1", text: "Observed end-of-term activity is concentrated. This is market evidence only." }];

describe("BDQ harness — locked specification", () => {
  it("encodes the twelve buyer tasks with stable ids", () => {
    expect(BUYER_TASKS).toHaveLength(12);
    const ids = BUYER_TASKS.map((t) => t.id);
    expect(ids).toEqual(["BDQ-01","BDQ-02","BDQ-03","BDQ-04","BDQ-05","BDQ-06","BDQ-07","BDQ-08","BDQ-09","BDQ-10","BDQ-11","BDQ-12"]);
    expect(new Set(ids).size).toBe(12);
    for (const t of BUYER_TASKS) expect(t.question.length).toBeGreaterThan(15);
  });

  it("covers the mandated vendors and six scopes", () => {
    for (const v of ["ACN","IBM","CGEMY","CTSH","TTNQY","INFY","DXC","GIB","DOX","ATO"]) {
      expect(CONTROL_VENDORS as readonly string[]).toContain(v);
    }
    expect(THIN_EVIDENCE_VENDORS.length).toBeGreaterThanOrEqual(5);
    expect(BDQ_SCOPES).toHaveLength(6);
    expect(BDQ_SCOPES.map((s) => s.id)).toContain("whole");
    // every selected scope documents its composition
    for (const s of BDQ_SCOPES.filter((x) => x.mode === "selected_vendors")) {
      expect(s.vendors.length, `${s.id} has no documented composition`).toBeGreaterThan(0);
    }
  });

  it("hardcodes no moving figure", () => {
    // Data legitimately moves; a harness pinned to today's numbers rots.
    // Comments may quote a figure to explain why figures must not be pinned;
    // what matters is that none is used as a VALUE in logic.
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const src = ["../scripts/bdq/spec.ts", "../scripts/bdq/checks.ts", "../scripts/buyer-quality.ts"]
      .map((f) => stripComments(readFileSync(resolve(__dirname, f), "utf8"))).join("\n");
    for (const figure of [/\b143\b/, /\b270\b/, /\b206\b/, /7\.3bn/, /14\.1bn/, /\b164\b/]) {
      expect(src, `harness pins a moving figure: ${figure}`).not.toMatch(figure);
    }
  });
});

describe("BDQ mutation — each detector catches its own regression", () => {
  it("ownership violation", () => {
    expect(ownershipFirewall(clean).status).toBe("pass");
    // disclaimed mention stays a pass — the firewall working, not breaching
    expect(ownershipFirewall([{ id: "f", text: "It does not mean the portal knows your contracts or spend." }]).status).toBe("pass");
    const mutated = ownershipFirewall([{ id: "f", text: "Your contract with this vendor is priced above the market." }]);
    expect(mutated.status).toBe("fail");
    expect(mutated.offenders[0]).toContain("f:");
  });

  it("proprietary-score leak", () => {
    expect(scoreFirewall(clean).status).toBe("pass");
    // a disclosed market quantity containing digits must NOT trip it
    expect(scoreFirewall([{ id: "f", text: "17 agreements worth $7.3bn, revenue +6.7% YoY." }]).status).toBe("pass");
    for (const leak of ["AG risk score 72", "readiness of 84/100", "AI-readiness score is high", "internal weighting applied"]) {
      expect(scoreFirewall([{ id: "f", text: leak }]).status, `missed: ${leak}`).toBe("fail");
    }
  });

  it("missing action", () => {
    const healthy = [{ ticker: "ACN", actions: 3, insufficient: false }];
    expect(actionExists(healthy).status).toBe("pass");
    // thin evidence may legitimately offer nothing
    expect(actionExists([{ ticker: "SEARCE", actions: 0, insufficient: true }]).status).toBe("pass");
    expect(actionExists([{ ticker: "ACN", actions: 0, insufficient: false }]).status).toBe("fail");
  });

  it("hollow action text", () => {
    expect(actionQuality([{ vendor: "ACN", text: "Whether current pricing structure survives comparison with the market record." }]).status).toBe("pass");
    // real phrasing that an earlier, narrower detector wrongly flagged
    expect(actionQuality([{ vendor: "ACN", text: "Which labour-intensive processes in scope are now automatable on their platform." }]).status).toBe("pass");
    for (const hollow of ["Monitor the vendor.", "Review the situation.", "Consider this provider.", ""]) {
      expect(actionQuality([{ vendor: "ACN", text: hollow }]).status, `missed: "${hollow}"`).toBe("fail");
    }
  });

  it("contentless ACT item", () => {
    const good = [{ classification: "ACT", headline: "Terminated a material agreement", implication: "A material contract loss changes their commercial posture — a basis to pressure-test continuity.", vendors: ["EXLS"] }];
    expect(contentlessAct(good).status).toBe("pass");
    expect(contentlessAct([{ classification: "ACT", headline: "8-K", implication: "", vendors: ["X"] }]).status).toBe("fail");
    expect(contentlessAct([{ classification: "ACT", headline: "Results of operations", implication: "Filed.", vendors: ["X"] }]).status).toBe("fail");
    // a WATCH item is not held to the ACT bar
    expect(contentlessAct([{ classification: "WATCH", headline: "8-K", implication: "", vendors: ["X"] }]).status).toBe("pass");
  });

  it("movement-colour polarity regression", () => {
    const varied = [
      { metric: "talentPressure", effect: "unfavourable" },
      { metric: "m.demand", effect: "caution" },
      { metric: "providerMomentum", effect: "favourable" },
      { metric: "buyerLeverage", effect: "unfavourable" },
    ];
    expect(movementPolarity(varied, []).status).toBe("pass");
    // the regression: every variable maps the same direction to one effect
    const collapsed = varied.map((v) => ({ ...v, effect: "unfavourable" }));
    const mutated = movementPolarity(collapsed, []);
    expect(mutated.status).toBe("fail");
    expect(mutated.offenders.join(" ")).toMatch(/collapsed into raw direction/);
    // and an inverted control is caught
    expect(movementPolarity(varied, [{ label: "supplier weakening", got: "unfavourable", want: "favourable" }]).status).toBe("fail");
  });

  it("missing provenance", () => {
    expect(provenancePresent([healthyFinding()]).status).toBe("pass");
    const noSource = { ...healthyFinding(), basis: [{ text: "17 agreements reach end-of-term.", source: "" }] };
    expect(provenancePresent([noSource]).status).toBe("fail");
    // an insufficient reading is exempt — it asserts nothing to source
    expect(provenancePresent([{ ...noSource, insufficient: true }]).status).toBe("pass");
  });

  it("missing date", () => {
    expect(datePresent([healthyFinding()], "2026-05-19").status).toBe("pass");
    const undatedPrimary: BdqFinding = {
      ...healthyFinding(),
      analysis: { driver: "Leverage is concentrated.", implication: "x", test: "y", evidence: "Curated contract record" },
      basis: [{ text: "29 vendors favourable.", source: "Curated contract tracker", asOf: null }],
    };
    expect(datePresent([undatedPrimary], "2026-05-19").status).toBe("fail");
    // an undated ROLLUP of dated readings is raised for review, not failed
    const rollup: BdqFinding = { ...undatedPrimary, basis: [{ text: "29 of 51 assessed vendors favourable.", source: "Derived from canonical metrics", asOf: null }] };
    expect(datePresent([rollup], "2026-05-19").status).toBe("review");
    // no spine date at all is a hard failure
    expect(datePresent([healthyFinding()], null).status).toBe("fail");
  });

  it("broken four-question chain", () => {
    expect(fourQuestionChain([healthyFinding()]).status).toBe("pass");
    for (const drop of ["driver", "implication", "test", "evidence"] as const) {
      const f = healthyFinding();
      f.analysis = { ...f.analysis!, [drop]: "" };
      expect(fourQuestionChain([f]).status, `missed a dropped ${drop}`).toBe("fail");
    }
  });

  it("empty headline and raw form-number finding", () => {
    expect(emptyHeadline([healthyFinding()]).status).toBe("pass");
    expect(emptyHeadline([{ ...healthyFinding(), headline: "   " }]).status).toBe("fail");
    expect(rawFormNumberFinding([healthyFinding()]).status).toBe("pass");
    expect(rawFormNumberFinding([{ ...healthyFinding(), headline: "8-K" }]).status).toBe("fail");
  });

  it("cross-page contradiction", () => {
    const consistent = ["home", "vendors", "opportunities"].map((surface) => ({ vendor: "ACN", metric: "buyerLeverage", surface, state: "favourable" }));
    expect(crossPageConsistency(consistent).status).toBe("pass");
    const contradictory = [...consistent, { vendor: "ACN", metric: "buyerLeverage", surface: "reputation", state: "unfavourable" }];
    const mutated = crossPageConsistency(contradictory);
    expect(mutated.status).toBe("fail");
    expect(mutated.offenders[0]).toContain("ACN.buyerLeverage");
  });

  it("cross-category pseudo-ranking", () => {
    expect(crossCategoryRanking([{ label: "Accenture", family: "pricing" }]).status).toBe("pass");
    expect(crossCategoryRanking([{ label: "Accenture", family: "" }]).status).toBe("fail");
  });

  it("unsourced Top Issue promoted to fact", () => {
    expect(topIssuesSupportingOnly([{ title: "Delivery strain", sourceUrl: null, promoted: false }]).status).toBe("pass");
    expect(topIssuesSupportingOnly([{ title: "Delivery strain", sourceUrl: null, promoted: true }]).status).toBe("fail");
  });

  it("freshness semantics", () => {
    expect(freshnessSemantics({ lastIngest: "2026-08-25", dataAsOf: "2026-05-19", dataAgeDays: 103 }).status).toBe("pass");
    expect(freshnessSemantics({ lastIngest: "2026-08-25", dataAsOf: null, dataAgeDays: null }).status).toBe("fail");
    // refresh time standing in for the evidence date
    expect(freshnessSemantics({ lastIngest: "2026-08-25", dataAsOf: "2026-08-25", dataAgeDays: 0 }).status).toBe("fail");
  });

  it("honest insufficiency is permitted, over-claiming is not", () => {
    const thin: BdqFinding = { ...healthyFinding(), insufficient: true, analysis: { driver: "No contracts on record.", implication: "Evidence is insufficient to place this vendor.", test: "Verify directly.", evidence: "Curated contract record" } };
    expect(honestInsufficiency([thin]).status).toBe("pass");
    const overclaim = { ...thin, analysis: { ...thin.analysis!, implication: "This proves the vendor will concede on price." } };
    expect(honestInsufficiency([overclaim]).status).toBe("fail");
  });
});

describe("BDQ grading behaviour", () => {
  it("classifies headlines without failing on length alone", () => {
    expect(classifyHeadline("A tight judgement about this market.")).toBe("EXECUTIVE-SCANNABLE");
    expect(classifyHeadline("x".repeat(250))).toBe("LONG BUT USABLE");
    expect(classifyHeadline("x".repeat(460))).toBe("REVIEW — EXTREME LENGTH");
    expect(classifyHeadline("")).toBe("MISSING");
    expect(classifyHeadline(null)).toBe("MISSING");
    // extreme length is a REVIEW; a missing headline is a FAIL
    expect(headlineQuality([{ id: "a", headline: "x".repeat(460) }]).status).toBe("review");
    expect(headlineQuality([{ id: "a", headline: "" }]).status).toBe("fail");
  });

  it("scores an insight on the unchanged seven-point standard", () => {
    const strong = "IBM's dominant differentiator is a widening gap between weakening deal momentum and strengthening delivery economics. Public award flow cooled to 1 from 8 in the trailing 90 days, yet revenue is expanding 7.9% YoY while headcount holds at 282,200. With 9 observed agreements reaching end-of-term, buyers should challenge whether pricing reflects the deal-flow deterioration rather than IBM's financial strength.";
    const s = scoreInsight("ibm", strong);
    expect(s.total).toBeGreaterThanOrEqual(6);
    expect(s.judgement).toBe(1);
    expect(s.evidenceBound).toBe(1);
    const weak = scoreInsight("x", "This vendor is worth watching.");
    expect(weak.total).toBeLessThanOrEqual(2);
  });

  it("reports evidence-family balance as a diagnostic, never a gate", () => {
    const f = healthyFinding();
    const { result, distribution } = evidenceBalance([f]);
    expect(result.status).toBe("pass");
    expect(Object.keys(distribution).length).toBeGreaterThan(5);
    // a contract-only corpus still passes — it is reported, not failed
    const contractOnly = evidenceBalance([{ ...f, basis: [{ text: "signings", source: "Curated contract tracker" }] }]);
    expect(contractOnly.result.status).toBe("pass");
  });
});
