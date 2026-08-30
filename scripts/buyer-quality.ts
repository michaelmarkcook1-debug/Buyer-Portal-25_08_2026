/**
 * BUYER DECISION QUALITY GATE — internal release harness.
 *
 * Answers one question: has this release made buyer decision quality better,
 * worse or unchanged? It is QA infrastructure, never a product surface — no
 * route, no tab, no table, nothing rendered to a buyer.
 *
 *   pnpm test:buyer-quality            deterministic only (no LLM)
 *   pnpm test:buyer-quality:insight    adds Analyst Insight scoring
 *
 * MODE A (deterministic) grades the canonical resolved intelligence. It needs
 * the database but never the model, so an API outage cannot manufacture a
 * false product regression.
 *
 * MODE B (insight) generates briefings and scores them on the existing
 * seven-point standard. When the provider is unavailable it reports SKIPPED
 * and leaves the deterministic verdict untouched.
 *
 * Exit codes: 0 pass (reviews allowed), 1 material failure, 2 harness error.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolveIntelligence } from "../lib/metrics/resolve.ts";
import { displayState, movementEffect } from "../lib/metrics/dictionary.ts";
import type { MarketIntel, Metric, VendorIntel } from "../lib/metrics/types.ts";
import { BDQ_SCOPES, BUYER_TASKS, CONSISTENCY_CONTROLS, ALL_BDQ_VENDORS, type BdqScope } from "./bdq/spec.ts";
import {
  actionExists, actionQuality, contentlessAct, crossPageConsistency, crossCategoryRanking,
  datePresent, emptyHeadline, evidenceBalance, fourQuestionChain, freshnessSemantics,
  headlineQuality, honestInsufficiency, ownershipFirewall, provenancePresent,
  movementPolarity, rawFormNumberFinding, scoreFirewall, scoreInsight, topIssuesSupportingOnly,
  type BdqAction, type BdqFinding, type BdqSignal, type CheckResult, type InsightScore,
} from "./bdq/checks.ts";

/* Pinned frame — see the scope key below. */
const BDQ_SELECTED_AT = "2026-01-01T00:00:00.000Z";
const BDQ_FIRST_USE_AT = "2025-01-01T00:00:00.000Z";
const BDQ_BASELINE_START = "2025-01-01";

const VERBOSE = process.argv.includes("--verbose");
const WITH_INSIGHT = process.argv.includes("--insight");

/* ── flattening: MarketIntel → the plain shapes the detectors grade ──────── */

function metricFinding(surface: string, idPrefix: string, m: Metric): BdqFinding {
  return {
    id: `${idPrefix}.${m.id}`,
    surface,
    label: m.label,
    state: m.state,
    movement: m.movement,
    headline: m.headline ?? undefined,
    analysis: m.analysis ?? null,
    basis: (m.basis ?? []).map((b) => ({ text: b.text, source: b.source, asOf: b.asOf ?? null, ownership: b.ownership })),
    confidence: m.confidence,
    insufficient: m.state === "insufficient" || m.confidence === "insufficient",
  };
}

function flatten(intel: MarketIntel, scope: BdqScope) {
  const findings: BdqFinding[] = [];
  for (const [k, m] of Object.entries(intel.strip)) findings.push(metricFinding("strip", `${scope.id}.strip.${k}`, m as Metric));
  for (const m of intel.buyerEconomics.dimensions) findings.push(metricFinding("buyer-economics", `${scope.id}.econ`, m));
  for (const v of intel.vendors) {
    for (const m of Object.values(v.metrics)) {
      if (m && typeof m === "object" && "id" in m) findings.push(metricFinding("vendor", `${scope.id}.${v.ticker}`, m as Metric));
    }
  }

  const actions: BdqAction[] = [];
  const vendorActionCounts: { ticker: string; actions: number; insufficient: boolean }[] = [];
  for (const v of intel.vendors) {
    let n = 0;
    for (const o of Object.values(v.opportunities)) {
      for (const t of o.investigate ?? []) { actions.push({ vendor: v.ticker, text: t }); n++; }
    }
    const allThin = Object.values(v.opportunities).every((o) => o.level === "insufficient");
    vendorActionCounts.push({ ticker: v.ticker, actions: n, insufficient: allThin });
  }

  const signals: BdqSignal[] = intel.watch.map((w) => ({
    classification: w.classification, headline: w.headline, implication: w.implication,
    date: w.date, sourceUrl: w.sourceUrl, vendors: w.vendors,
  }));

  /* Ranked rows must name the family they rank within. `overall` is the
     portal's single cross-vendor ladder and carries its own type. */
  const rankedRows = intel.vendors.map((v) => ({ label: v.name, family: v.overall?.type ?? "" }));

  const topIssues = intel.vendors
    .filter((v) => v.perception?.topIssue)
    .map((v) => ({ title: v.perception!.topIssue!.name, sourceUrl: null, promoted: false }));

  /* Every buyer-facing string this scope would render, for the two firewalls. */
  const texts: { id: string; text: string }[] = [];
  for (const f of findings) {
    const parts = [f.headline ?? "", f.analysis?.driver ?? "", f.analysis?.implication ?? "",
      f.analysis?.limitation ?? "", f.analysis?.test ?? "", f.analysis?.evidence ?? "",
      ...f.basis.map((b) => b.text)];
    texts.push({ id: f.id, text: parts.join(" · ") });
  }
  for (const a of actions) texts.push({ id: `${a.vendor}.action`, text: a.text });
  for (const s of signals) texts.push({ id: `signal.${s.classification}`, text: `${s.headline} ${s.implication}` });
  for (const c of intel.changes) texts.push({ id: `change.${c.dimension}`, text: `${c.detail} ${c.source}` });

  return { findings, actions, vendorActionCounts, signals, rankedRows, topIssues, texts };
}

/* ── buyer tasks: is the evidence a task needs actually resolvable? ──────── */

function taskAnswerable(intel: MarketIntel, needs: string): { ok: boolean; note: string } {
  const vendors = intel.vendors;
  const anyMetric = (pick: (v: VendorIntel) => Metric | undefined) =>
    vendors.filter((v) => { const m = pick(v); return m && m.state !== "insufficient"; }).length;
  switch (needs) {
    case "signals": return { ok: intel.watch.length > 0, note: `${intel.watch.length} classified signals` };
    case "opportunities": {
      const n = vendors.filter((v) => v.overall && v.overall.level !== "insufficient").length;
      return { ok: n > 0, note: `${n} vendors carry a ranked opportunity` };
    }
    case "movement": {
      const n = intel.changes.filter((c) => c.movement !== "insufficient").length;
      return { ok: n > 0, note: `${n} retrospective dimensions assert direction` };
    }
    case "exposure": {
      const n = vendors.filter((v) => v.coverage.inPlay12 > 0).length;
      return { ok: n > 0, note: `${n} vendors with observed end-of-term exposure` };
    }
    case "capability": return { ok: anyMetric((v) => v.metrics.aiProductivityOpportunity) > 0, note: `${anyMetric((v) => v.metrics.aiProductivityOpportunity)} vendors with a capability reading` };
    case "financial": return { ok: anyMetric((v) => v.metrics.financialHeadroom) > 0, note: `${anyMetric((v) => v.metrics.financialHeadroom)} vendors with a headroom reading` };
    case "workforce": return { ok: anyMetric((v) => v.metrics.talentPressure) > 0, note: `${anyMetric((v) => v.metrics.talentPressure)} vendors with a talent reading` };
    case "differentiation": {
      const n = vendors.filter((v) => v.differentiation?.strongest || v.overall?.reason).length;
      return { ok: n > 0, note: `${n} vendors carry a differentiating reading` };
    }
    case "limits": {
      // The product must be able to say what it does NOT know.
      const thin = vendors.filter((v) => Object.values(v.opportunities).some((o) => o.level === "insufficient")).length;
      const dated = Boolean(intel.spine.dataAsOf);
      return { ok: dated, note: `evidence dated${thin ? `, ${thin} vendors declare insufficiency` : ""}` };
    }
    default: return { ok: false, note: "unknown requirement" };
  }
}

/* ── semantic colour controls (locked by 072596c) ────────────────────────── */

function semanticColour(): CheckResult {
  const offenders: string[] = [];
  const expect = (label: string, got: string, want: string) => { if (got !== want) offenders.push(`${label}: expected ${want}, got ${got}`); };
  // A supplier weakening is favourable to the buyer; strengthening is a caution.
  expect("providerMomentum weakening", displayState("providerMomentum", "unfavourable").effect, "favourable");
  expect("providerMomentum strengthening", displayState("providerMomentum", "favourable").effect, "caution");
  // Delivery and risk deterioration stay adverse.
  expect("talentPressure high", displayState("talentPressure", "unfavourable").effect, "unfavourable");
  expect("operationalRisk high", displayState("operationalRisk", "unfavourable").effect, "unfavourable");
  expect("financialResilience weak", displayState("financialResilience", "unfavourable").effect, "caution");
  // Neutral and unknown movement remain expressible.
  expect("stable movement", movementEffect("buyerLeverage", "stable"), "neutral");
  expect("insufficient movement", movementEffect("buyerLeverage", "insufficient"), "unknown");
  expect("unmapped variable", movementEffect("no-such-metric", "deteriorating"), "neutral");
  // No single rule may govern every variable's direction. Shared with the
  // mutation suite so the harness and its own tests grade identically.
  const down = ["talentPressure", "m.demand", "providerMomentum", "buyerLeverage"]
    .map((id) => ({ metric: id, effect: movementEffect(id, "deteriorating") }));
  const polarity = movementPolarity(down, []);
  offenders.push(...polarity.offenders);
  return { id: "colour", title: "Semantic colour model", status: offenders.length ? "fail" : "pass", detail: "buyer effect stays separate from raw direction", offenders };
}

/* ── demand vs market heat: each internally consistent with its definition ─ */

function demandVsHeat(): CheckResult {
  const offenders: string[] = [];
  // They may legitimately differ. What must hold is that each agrees with its
  // OWN definition: softening demand is m.demand's caution, a cool market is
  // dealMarketHeat's favourable.
  if (displayState("m.demand", "unfavourable").effect === "favourable") offenders.push("m.demand softening now reads favourable — contradicts its own caveat");
  if (displayState("dealMarketHeat", "favourable").effect !== "favourable") offenders.push("dealMarketHeat cool no longer reads favourable to the buyer");
  if (displayState("m.demand", "unfavourable").label.toLowerCase() === displayState("dealMarketHeat", "favourable").label.toLowerCase()) {
    offenders.push("demand and heat now share a label — the distinction has collapsed");
  }
  return { id: "demand-heat", title: "Demand vs market heat", status: offenders.length ? "fail" : "pass", detail: "each metric stays consistent with its own definition", offenders };
}

/* ── reporting ───────────────────────────────────────────────────────────── */

const ICON: Record<string, string> = { pass: "PASS", fail: "FAIL", review: "REVIEW", skip: "SKIP" };

async function main(): Promise<number> {
  const started = Date.now();
  const commit = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();

  const checks: CheckResult[] = [];
  const scopeSummaries: { id: string; label: string; vendors: number; findings: number; actions: number }[] = [];
  const taskResults: { id: string; question: string; scopes: number; answerable: number; note: string }[] = [];
  const consistencyReadings: { vendor: string; metric: string; surface: string; state: string }[] = [];
  let allFindings: BdqFinding[] = [];
  let allActions: BdqAction[] = [];
  let allTexts: { id: string; text: string }[] = [];
  let balanceDist: Record<string, number> = {};
  const resolved: { scope: BdqScope; intel: MarketIntel }[] = [];

  for (const scope of BDQ_SCOPES) {
    /* MarketScope shape, fixed so a run is reproducible: the baseline window
       is pinned rather than taken from "today", so a rerun compares like with
       like. Data may move; the frame must not. */
    const key = JSON.stringify({
      mode: scope.mode,
      vendorIds: scope.mode === "whole_market" ? [] : scope.vendors,
      selectionTimestamp: BDQ_SELECTED_AT,
      baselineStart: BDQ_BASELINE_START,
      firstUseAt: BDQ_FIRST_USE_AT,
    });
    const intel = await resolveIntelligence(key);
    resolved.push({ scope, intel });
    const flat = flatten(intel, scope);
    allFindings = allFindings.concat(flat.findings);
    allActions = allActions.concat(flat.actions);
    allTexts = allTexts.concat(flat.texts);
    scopeSummaries.push({ id: scope.id, label: scope.label, vendors: intel.vendors.length, findings: flat.findings.length, actions: flat.actions.length });

    // Per-scope structural checks that need this scope's own objects.
    checks.push({ ...contentlessAct(flat.signals), id: `act-content:${scope.id}` });
    checks.push({ ...actionExists(flat.vendorActionCounts), id: `action-exists:${scope.id}` });
    checks.push({ ...crossCategoryRanking(flat.rankedRows), id: `ranking:${scope.id}` });
    checks.push({ ...topIssuesSupportingOnly(flat.topIssues), id: `top-issues:${scope.id}` });
    checks.push({ ...datePresent(flat.findings, intel.spine.dataAsOf), id: `dates:${scope.id}` });
    checks.push({ ...freshnessSemantics(intel.spine), id: `freshness:${scope.id}` });

    // Control vendors are read on every surface that shows them; the canonical
    // object is the single source, so a divergence here is a real defect.
    for (const v of intel.vendors.filter((x) => (CONSISTENCY_CONTROLS as readonly string[]).includes(x.ticker))) {
      for (const surface of ["home", "vendors", "vendor-detail", "opportunities", "reputation"]) {
        consistencyReadings.push({ vendor: `${scope.id}.${v.ticker}`, metric: "buyerLeverage", surface, state: v.metrics.buyerLeverage.state });
        consistencyReadings.push({ vendor: `${scope.id}.${v.ticker}`, metric: "reputationMovement", surface, state: v.metrics.reputationMovement.state });
      }
    }
  }

  // Cross-scope checks.
  checks.push(ownershipFirewall(allTexts));
  checks.push(scoreFirewall(allTexts));
  checks.push(provenancePresent(allFindings));
  checks.push(fourQuestionChain(allFindings));
  checks.push(actionQuality(allActions));
  checks.push(emptyHeadline(allFindings));
  checks.push(rawFormNumberFinding(allFindings));
  checks.push(honestInsufficiency(allFindings));
  checks.push(crossPageConsistency(consistencyReadings));
  checks.push(semanticColour());
  checks.push(demandVsHeat());
  const bal = evidenceBalance(allFindings);
  checks.push(bal.result);
  balanceDist = bal.distribution;

  // Buyer tasks across every scope.
  for (const t of BUYER_TASKS) {
    let answerable = 0; const notes: string[] = [];
    for (const { scope, intel } of resolved) {
      const r = taskAnswerable(intel, t.needs);
      if (r.ok) answerable++; else notes.push(`${scope.id}: ${r.note}`);
    }
    taskResults.push({ id: t.id, question: t.question, scopes: resolved.length, answerable, note: notes.join("; ") });
  }
  const unanswerable = taskResults.filter((t) => t.answerable === 0);
  checks.push({
    id: "buyer-tasks", title: "Buyer tasks answerable",
    status: unanswerable.length ? "fail" : "pass",
    detail: `${taskResults.length} tasks across ${resolved.length} scopes`,
    offenders: unanswerable.map((t) => `${t.id} unanswerable in every scope — ${t.note}`),
  });

  const deterministicMs = Date.now() - started;

  /* ── MODE B ────────────────────────────────────────────────────────────── */
  let insightStatus: "PASS" | "REVIEW" | "SKIPPED" = "SKIPPED";
  let insightNote = "not requested (pass --insight to run)";
  const insightScores: InsightScore[] = [];
  let insightMs = 0; let apiCalls = 0;

  if (WITH_INSIGHT) {
    const t0 = Date.now();
    let unavailable = "";
    // Loaded only in Mode B: the deterministic gate must never depend on the
    // generation path, so an LLM-side fault cannot fail a canonical run. Even
    // failing to LOAD the generator degrades to SKIPPED rather than erroring —
    // Mode B is additive, and must never turn an outage into a regression.
    let getInsight: undefined | ((i: MarketIntel, tab: "home") => Promise<{ status: string; text?: string; reason?: string }>);
    try {
      ({ getInsight } = (await import("../lib/insight/generate.ts")) as never);
    } catch (e) {
      getInsight = undefined;
      unavailable = e instanceof Error ? e.message.slice(0, 110) : String(e).slice(0, 110);
    }
    const headlineItems: { id: string; headline: string | null | undefined }[] = [];
    for (const { scope, intel } of resolved) {
      if (!getInsight) break;
      try {
        const r = await getInsight(intel, "home");
        apiCalls++;
        if (r.status === "ok" && r.text) {
          const text = r.text.trim();
          insightScores.push(scoreInsight(scope.id, text));
          const cut = text.search(/(?<=[.!?])\s+(?=[A-Z])/);
          headlineItems.push({ id: scope.id, headline: cut > 0 ? text.slice(0, cut) : text });
        } else if (r.status === "not-configured" || r.status === "blocked") {
          unavailable = r.status === "not-configured" ? (r as { reason: string }).reason : "generation blocked or provider unavailable";
        }
      } catch (e) {
        unavailable = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
      }
    }
    insightMs = Date.now() - t0;
    if (insightScores.length === 0) {
      insightStatus = "SKIPPED";
      insightNote = `PROVIDER UNAVAILABLE${unavailable ? ` (${unavailable})` : ""}`;
    } else {
      const mean = insightScores.reduce((a, s) => a + s.total, 0) / insightScores.length;
      const weak = insightScores.filter((s) => s.total < 4);
      checks.push(headlineQuality(headlineItems));
      insightStatus = weak.length ? "REVIEW" : "PASS";
      insightNote = `${insightScores.length} briefings, mean ${mean.toFixed(2)}/7` + (weak.length ? `; ${weak.length} below 4/7` : "");
    }
  }

  /* ── verdict ───────────────────────────────────────────────────────────── */
  const failures = checks.filter((c) => c.status === "fail");
  const reviews = checks.filter((c) => c.status === "review");
  const overall = failures.length ? "FAIL" : reviews.length || insightStatus === "REVIEW" ? "PASS WITH REVIEW" : "PASS";

  const line = (k: string, v: string) => console.log(`  ${k.padEnd(26)}${v}`);
  console.log("\nBUYER DECISION QUALITY GATE");
  console.log(`  commit ${commit} · ${new Date().toISOString()}\n`);
  line("Deterministic:", failures.length ? "FAIL" : "PASS");
  line("Scopes tested:", String(scopeSummaries.length));
  line("Vendors tested:", String(new Set(allFindings.map((f) => f.id.split(".")[1])).size) + ` (controls: ${ALL_BDQ_VENDORS.length})`);
  line("Buyer tasks:", `${BUYER_TASKS.length} (${taskResults.filter((t) => t.answerable === t.scopes).length} answerable in every scope)`);
  line("Findings graded:", String(allFindings.length));
  line("Actions graded:", String(allActions.length));
  const st = (id: string) => { const c = checks.find((x) => x.id === id || x.id.startsWith(`${id}:`)); return c ? ICON[c.status]! : "n/a"; };
  line("Trust / provenance:", st("provenance"));
  line("Ownership firewall:", st("ownership"));
  line("Score firewall:", st("scores"));
  line("Semantic colour:", st("colour"));
  line("Demand vs heat:", st("demand-heat"));
  line("Four-question chain:", st("chain"));
  line("Action quality:", st("actions"));
  line("Cross-page consistency:", st("consistency"));
  line("Honest insufficiency:", st("insufficiency"));
  const balTotal = Object.values(balanceDist).reduce((a, b) => a + b, 0) || 1;
  const topFams = Object.entries(balanceDist).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${((v / balTotal) * 100).toFixed(0)}%`).join(" · ");
  line("AG evidence balance:", `diagnostic — ${topFams}`);
  line("Analyst Insight:", `${insightStatus} — ${insightNote}`);
  console.log(`\n  Overall: ${overall}\n`);

  if (failures.length || reviews.length) {
    console.log("  ── failures and reviews ──");
    for (const c of [...failures, ...reviews]) {
      console.log(`  ${ICON[c.status]}  ${c.title} [${c.id}] — ${c.detail}`);
      for (const o of c.offenders.slice(0, VERBOSE ? 12 : 4)) console.log(`        · ${o}`);
      if (!VERBOSE && c.offenders.length > 4) console.log(`        · …${c.offenders.length - 4} more (--verbose)`);
    }
    console.log("");
  }
  if (VERBOSE) {
    console.log("  ── all checks ──");
    for (const c of checks) console.log(`  ${ICON[c.status]}  ${c.title} [${c.id}] — ${c.detail}`);
    console.log("");
  }

  mkdirSync("scripts/bdq/out", { recursive: true });
  const json = {
    runAt: new Date().toISOString(), commit,
    mode: WITH_INSIGHT ? "deterministic+insight" : "deterministic",
    status: overall,
    scopes: scopeSummaries,
    vendors: ALL_BDQ_VENDORS,
    tasks: taskResults,
    checks: checks.map((c) => ({ id: c.id, title: c.title, status: c.status, detail: c.detail, offenders: c.offenders })),
    reviews: reviews.map((c) => c.id),
    failures: failures.map((c) => c.id),
    evidenceBalance: balanceDist,
    insight: { status: insightStatus, note: insightNote, scores: insightScores, apiCalls },
    timingMs: { deterministic: deterministicMs, insight: insightMs },
  };
  writeFileSync("scripts/bdq/out/last-run.json", JSON.stringify(json, null, 2));
  console.log(`  machine-readable: scripts/bdq/out/last-run.json`);
  console.log(`  timing: deterministic ${(deterministicMs / 1000).toFixed(1)}s` + (WITH_INSIGHT ? ` · insight ${(insightMs / 1000).toFixed(1)}s · ${apiCalls} API calls` : "") + "\n");

  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("\nBDQ harness error:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
