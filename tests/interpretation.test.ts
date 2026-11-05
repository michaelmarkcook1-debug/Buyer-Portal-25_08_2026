import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceClassOf } from "@/lib/evidence-class";
import {
  aiProductivityFinding,
  economicsFinding,
  familyFinding,
  geographyFinding,
  nameList,
  workforceFinding,
} from "@/lib/metrics/section-findings";
import type { Metric, MetricState } from "@/lib/metrics/types";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const m = (id: string, label: string, state: MetricState): Metric => ({
  id, label, state, movement: "stable", confidence: "medium", headline: null, basis: [], asOf: null,
});

describe("section findings lead with a conclusion the rows support", () => {
  it("names a single leader, and a dead heat as a dead heat", () => {
    expect(geographyFinding([
      { country: "India", contracts: 30, inPlay12: 4 },
      { country: "UK", contracts: 10, inPlay12: 0 },
    ])!.finding).toMatch(/^India leads where this market signs — 75%/);
    expect(geographyFinding([
      { country: "US", contracts: 19, inPlay12: 2 },
      { country: "UK", contracts: 19, inPlay12: 1 },
    ])!.finding).toMatch(/^US and UK lead where this market signs — 50% each/);
  });

  it("says nothing where there is nothing to conclude", () => {
    expect(familyFinding([])).toBeNull();
    expect(geographyFinding([{ country: "US", contracts: 0, inPlay12: 0 }])).toBeNull();
    expect(workforceFinding([{ name: "A", metric: m("talentPressure", "Talent", "insufficient") }])).toBeNull();
  });

  it("only offers an action where the finding supports one", () => {
    const none = workforceFinding([{ name: "A", metric: m("talentPressure", "Talent", "stable") }])!;
    expect(none.action).toBeUndefined();
    const some = workforceFinding([
      { name: "A", metric: m("talentPressure", "Talent", "unfavourable") },
      { name: "B", metric: m("talentPressure", "Talent", "stable") },
    ])!;
    expect(some.finding).toMatch(/1 of 2 assessed vendors: A\./);
    expect(some.action).toBeTruthy();
  });

  it("counts only assessed vendors, never the insufficient ones", () => {
    const f = aiProductivityFinding([
      { name: "A", metric: m("aiProductivityOpportunity", "AI", "favourable") },
      { name: "B", metric: m("aiProductivityOpportunity", "AI", "insufficient") },
    ])!;
    expect(f.finding).toMatch(/at 1 of 1 assessed vendors/);
  });

  it("economics names no force it cannot classify", () => {
    expect(economicsFinding([m("x", "X", "insufficient")])).toBeNull();
  });

  it("keeps long vendor lists readable", () => {
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
    expect(nameList(["A", "B"])).toBe("A and B");
  });

  it("never speaks of the reader's own contracts", () => {
    const text = src("lib/metrics/section-findings.ts");
    expect(text).not.toMatch(/\byour (contract|spend|renewal|agreement)/i);
  });
});

describe("evidence classes", () => {
  it("classes lines by what they are", () => {
    expect(evidenceClassOf({ text: "3 of 4 present.", source: "Derived from canonical metrics" })).toBe("derived");
    expect(evidenceClassOf({ text: "Top issue: delivery.", source: "AnalystGenius top issues" })).toBe("interpretation");
    expect(evidenceClassOf({ text: "Filed 8-K 1.02.", source: "SEC 8-K" })).toBe("observed");
    expect(evidenceClassOf({ text: "$420m disclosed + $110–160m inferred.", source: "Curated contract tracker (market record)" })).toBe("mixed");
    expect(evidenceClassOf({ text: "AG estimates $10–15m.", source: "Curated contract tracker (market record)" })).toBe("modelled");
    expect(evidenceClassOf({ text: "Coverage is partial.", source: "Coverage note" })).toBeNull();
  });
});

describe("signal cards lead with the judgement", () => {
  it("every signal rule states a judgement and an action", () => {
    const watch = src("lib/metrics/watch.ts");
    const pushes = watch.split("signals.push({").slice(1);
    expect(pushes.length).toBeGreaterThanOrEqual(6);
    for (const p of pushes) {
      const body = p.slice(0, p.indexOf("});"));
      expect(body).toMatch(/judgement/);
      expect(body).toMatch(/action/);
    }
  });

  it("the card renders judgement first and the event as evidence", () => {
    const card = src("components/SignalCard.tsx");
    expect(card.indexOf("{s.judgement}")).toBeGreaterThan(-1);
    expect(card.indexOf("{s.judgement}")).toBeLessThan(card.indexOf("Evidence: {s.headline}"));
  });
});

describe("one type scale", () => {
  it("no call site sets its own text size outside the scale", () => {
    const out = execSync(
      `grep -rnoE 'text-\\[[0-9.]+(rem|px)\\]' app components || true`,
      { cwd: resolve(__dirname, ".."), encoding: "utf8" },
    );
    /* The brand wordmark (Masthead) and the info-icon glyph are sized to
       their artwork, not to reading; they are the only permitted exceptions. */
    const offenders = out
      .split("\n")
      .filter(Boolean)
      .filter((l) => !/components\/Masthead\.tsx:\d+:text-\[(17|21)px\]/.test(l))
      .filter((l) => !/components\/InfoTip\.tsx:\d+:text-\[11px\]/.test(l));
    expect(offenders).toEqual([]);
  });
});

describe("briefing headline length", () => {
  it("asks for one rewrite when the first sentence runs past the headline limit", async () => {
    const { headlineViolation, HEADLINE_MAX_CHARS } = await import("@/lib/insight/generate");
    const short = "Renewal exposure is concentrating across the selected market. Accenture leads it.";
    expect(headlineViolation(short)).toBeNull();
    const long = "A".repeat(HEADLINE_MAX_CHARS + 40) + ". Second sentence.";
    expect(headlineViolation(long)).toMatch(/runs to \d+ characters/);
  });
});
