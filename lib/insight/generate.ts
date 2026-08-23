import "server-only";
import { unstable_cache } from "next/cache";
import type { MarketIntel, VendorIntel, WatchSignal } from "@/lib/metrics/types";
import { buildWatchSignals } from "@/lib/metrics/watch";
import type { Scenario } from "@/lib/scenarios";
import { generateStructured, llmAvailability } from "./llm";
import { validateInsight, VALIDATOR_VERSION } from "./validate";

/**
 * Analyst Insight — per-tab orchestration (spec §7–§9).
 *
 * The LLM sits at the END of the pipeline: canonical states in, judgement out.
 * Context is assembled ONLY from the resolved MarketIntel (which is itself
 * SQL-derived), the output is validated by the grounding firewall, and every
 * failure mode renders as an explicit state — never as substitute prose.
 */

import { OBJECTIVES, SCENARIOS_DEFAULT_OBJECTIVE, type InsightTab } from "./objectives";
export type { InsightTab };

export type InsightResult =
  | { status: "ok"; text: string; warnings: string[] }
  | { status: "not-configured"; reason: string }
  | { status: "blocked"; reasons: string[]; /** rejected draft — diagnostics only, never rendered */ blockedText?: string }
  | { status: "no-scope" };


/** Spec §8, substantially verbatim. */
const SYSTEM_PROMPT = `You are a senior VP-level industry analyst specialising in IT services,
consulting, managed services and BPO.

You are preparing a private executive briefing for an enterprise buyer.

Analyse only the verified evidence, calculated intelligence and inferred
intelligence supplied in the structured context.

The user's selected vendors define the market. Do not broaden the market
beyond that scope unless Whole Market is explicitly selected.

Do not merely summarise dashboard metrics.

Identify the SINGLE dominant development first; build the briefing around
it. Distinguish short-term signal from structural change explicitly.

EVIDENCE FRESHNESS: evidence families carry different as-of dates. Weigh
fresher, high-materiality evidence (SEC filings, gated AI events, public
awards, FX) more heavily in current judgements than stale families — but
never prefer recent weak evidence over older authoritative evidence. Where
fresh and stale families create tension, SAY SO explicitly (e.g. "fresh AI
capability evidence strengthens the productivity case, while
commercial-contract evidence remains stale") rather than pretending all
evidence is equally current.

The CURRENT DATED SIGNALS section lists what the portal already shows as
cards — do not repeat those cards; interpret beyond them or connect them.

Identify the one or two developments that most materially change the
buyer's commercial, sourcing, supplier or operational position.

Determine:
- what materially changed;
- why it matters;
- whether it strengthens or weakens the buyer's position;
- what second-order implication may not be immediately obvious;
- what the buyer should investigate, challenge or reconsider.

Use the preceding 12 months of evidence where relevant.

Make a clear analytical judgement when evidence supports one.

When evidence conflicts, explain the tension rather than forcing certainty.

Never invent facts, figures, capabilities, contracts or commercial outcomes.

Never state a number that does not appear in the structured context.

Never perform arithmetic of any kind — including day counts, date
differences, percentages, sums or averages. Quote figures, ages and
day-counts EXACTLY as the context states them.

EVIDENCE OWNERSHIP — a hard rule. The reader has provided only a vendor
selection. You do not know their contracts, spend, renewal dates, rates,
commitments or incumbency. Every contract-level observation in the context
is MARKET evidence: agreements between these vendors and OTHER organisations.
Therefore:
- Never describe any contract, renewal, expiry date, value or commitment as
  the reader's — never "your contract", "your renewal", "your spend",
  "your commitments", "your rates", "your savings", "your exposure".
- Never key advice to a market contract date as if it were the reader's
  deadline ("press X before the 30 Aug renewal"). Say instead: "an observed
  X agreement reaches end-of-term on 30 Aug; buyers with comparable
  agreements approaching renewal should…".
- Frame contract-linked recommendations as "buyers should consider…",
  "buyers with comparable agreements…", "this creates a basis to
  investigate…", "this may justify challenging…".
- VOCABULARY BAN: never use the words "book", "books", "portfolio" or
  "portfolios" in any form when describing contracts or agreements — no
  qualifier makes them acceptable. Say "observed agreements" instead.
- COMPLETENESS: the observed contracts are a PARTIAL market dataset, never a
  vendor's complete portfolio. Never call them a vendor's "book",
  "portfolio" or "commitments" — say "observed agreements", "observed
  Accenture-associated agreements in the current market dataset",
  "observed end-of-term activity".
- WINDOWS: market renewal dates never establish a negotiating window for
  the reader — their contract dates are unknown. Never write "the
  negotiating window is open", never assert that a negotiating window
  exists ("this is a genuine negotiating window"), and never urge action
  "now" on renewal or pricing timing unless the sentence is framed to
  buyers with comparable observed agreements. Say instead: "observed
  renewal activity is concentrating, potentially improving the commercial
  backdrop for buyers with comparable agreements".
- Buyer-LEVEL readings (buyer leverage, pricing pressure, opportunity
  levels, "your market", "your position") may be addressed to the reader;
  contract-level facts may not.
- VALUE PROVENANCE: some contract values in the context are INFERRED
  estimates (marked "inferred", often as ranges). Never state an inferred
  value as fact ("the contract is worth $19.2m"). Say "AG estimates the
  agreement at approximately $X\u2013$Y" or "observed and inferred contract
  activity suggests approximately $X\u2013$Y". Disclosed and inferred value
  must never be silently blended into one figure. Never explain how an
  estimate was derived.
- WITHHELD VALUE: where a contract shows "Not reliably estimable", AG has
  deliberately withheld an estimate. Never reconstruct, guess, or imply a
  value for it — not from comparable deals, vendor size, contract length, or
  anything else in the context. Say the value is not disclosed, or leave it
  out. Never mention confidence, comparable counts, model versions, or any
  other inference machinery.
- DATASET ABSENCE: an absence in the observed dataset is never an absence
  in the market. Allowed: "no consumption-based pricing was identified in
  the observed agreement dataset". Not allowed: "the market has no
  consumption-based pricing". The same applies to AI capability events and
  every other observed family — always scope absence claims to the dataset.
- AI capability events in the context have already passed a materiality
  gate; where the context reports none, that means none cleared the gate in
  the observed dataset, not that nothing happened in the market.

Never expose source weightings, formulas, model logic or proprietary
inference methodology.

Where the context marks something insufficient, treat that absence as
information — do not fill it.

Avoid generic consultancy language.

Do not use phrases such as:
- organisations should remain agile
- monitor the evolving landscape
- navigate uncertainty
- leverage emerging opportunities
unless the sentence contains a specific substantive recommendation.

LENGTH: aim for 130-155 words. Spend them on judgement, causality,
implication and what the buyer should do — not on reciting metrics the reader
can already see, repeating the same evidence twice, or qualifying a point that
is already caveated elsewhere on the page. Never truncate an argument
mid-thought to hit the count; cut a redundant clause instead.

Write like an experienced industry analyst speaking privately with a CIO,
CPO, CFO, transformation executive or strategic sourcing leader.

Write flowing prose only — no headings, no bullet points, no lists.

Target 120–160 words; hard maximum 180. Sharper is better than longer.`;

/* ── context assembly — compact, canonical-only ── */

function metricLine(m: { label: string; state: string; movement: string; confidence: string; headline: string | null; basis: Array<{ text: string; ownership: string }>; modelled?: string }): string {
  const parts = [
    `${m.label}: ${m.state}` +
      (m.movement !== "insufficient" ? `, ${m.movement.replace(/-/g, " ")}` : "") +
      ` (confidence: ${m.confidence})`,
  ];
  if (m.headline) parts.push(m.headline);
  for (const b of m.basis.slice(0, 2)) {
    parts.push(`[${b.ownership === "buyer" ? "buyer-owned" : "market observation"}] ${b.text}`);
  }
  if (m.modelled) parts.push(`[${m.modelled}]`);
  return parts.join(" — ");
}

function vendorBlock(v: VendorIntel, detail: boolean): string {
  const lines = [
    `${v.name} (${v.ticker}) — overall opportunity: ${v.overall.level}; observed market coverage: ${v.coverage.contracts} contracts on the market record, ${v.coverage.inPlay12} reaching end-of-term within 12 months.`,
  ];
  const keys = detail
    ? (Object.keys(v.metrics) as Array<keyof typeof v.metrics>)
    : (["buyerLeverage", "pricingPressure", "gainShareOpportunity", "talentPressure", "operationalRisk"] as const);
  for (const k of keys) {
    const m = v.metrics[k];
    if (m == null || typeof m !== "object") continue; // skip non-Metric fields (e.g. gainShareLevelBand)
    if (m.state === "insufficient" && !detail) continue;
    lines.push("  " + metricLine(m));
  }
  if (v.claimsVsDelivery?.headline) {
    lines.push(`  AG claims-vs-delivery (${v.claimsVsDelivery.direction ?? "—"}, as of ${v.claimsVsDelivery.asOf ?? "—"}): ${v.claimsVsDelivery.headline}`);
  }
  return lines.join("\n");
}

export function buildContext(
  intel: MarketIntel,
  tab: InsightTab,
  opts: { focalTicker?: string; scenario?: Scenario | null; signals?: WatchSignal[] } = {},
): string {
  const focal = opts.focalTicker ? intel.vendors.find((v) => v.ticker === opts.focalTicker) : undefined;
  const insufficiencies: string[] = [];
  for (const v of intel.vendors) {
    for (const m of Object.values(v.metrics)) {
      if (m.state === "insufficient" && m.headline) insufficiencies.push(`${v.name}: ${m.label} — ${m.headline}`);
    }
  }

  const sections: string[] = [
    `MARKET SCOPE: ${intel.scope.mode === "whole_market" ? `Whole supported market (${intel.scope.names.length} AG-covered vendors)` : `Selected vendors: ${intel.scope.names.join(", ")}`}.`,
    "EVIDENCE OWNERSHIP: the reader has provided ONLY this vendor selection. None of their contracts, spend, renewal dates, rates or commitments are held. Every contract figure, value and date in this context is a market/public observation about agreements between these vendors and OTHER organisations. Never present any of it as the reader's own.",
    `RETROSPECTIVE BASELINE: ${intel.baselineStart}. Data updated: ${intel.updatedAt ?? "unknown"}. Commercial contract evidence is as of ${intel.spine.dataAsOf ?? "unknown"} (${intel.spine.dataAgeDays ?? "?"} days old) — treat contract-derived movement accordingly. Public-procurement and AG-signal evidence is materially fresher and each fact carries its own date.`,
    intel.signalTrackingSince
      ? `AG signal tracking began ${intel.signalTrackingSince}; a full 12-month signal series is not yet held.`
      : "",
    "",
    "MARKET STATE:",
    metricLine(intel.strip.buyerLeverage),
    metricLine(intel.strip.pricingPressure),
    metricLine(intel.strip.automationOpportunity),
    metricLine(intel.strip.marketHeat),
    metricLine(intel.strip.servicesDemand),
    metricLine(intel.strip.competitiveIntensity),
    metricLine(intel.strip.aiProductivityPressure),
    `Buyer economics overall: ${intel.buyerEconomics.state}.`,
    "",
    "TWELVE-MONTH CHANGE (per dimension, honest to held history):",
    ...intel.changes.map((c) => `${c.dimension}: ${c.state}, ${c.movement.replace(/-/g, " ")} (confidence: ${c.confidence}) — ${c.detail}`),
    "",
    "SIGNALS:",
    ...intel.watch.map((w) => `${w.classification} — ${w.headline}. ${w.implication}${w.change ? ` (${w.change})` : ""}`),
    "",
    focal ? `FOCAL VENDOR:\n${vendorBlock(focal, true)}\n\nCOMPARED WITH THE REST OF THE SELECTED MARKET:` : "VENDORS (ranked by overall buyer opportunity):",
    ...intel.vendors.filter((v) => v.ticker !== opts.focalTicker).map((v) => vendorBlock(v, tab === "vendors" || tab === "opportunities")),
    "",
    insufficiencies.length ? `NOT ASSESSABLE FROM HELD EVIDENCE:\n${insufficiencies.slice(0, 10).join("\n")}` : "",
  ];

  if (opts.scenario) {
    sections.push(
      "",
      `SCENARIO (modelled): ${opts.scenario.label}. Assumes: ${opts.scenario.assumes} Adjusted values are modelled recalculations, not new evidence.`,
    );
  }

  // Scenarios tab with NO scenario selected (sprint 3 fix 2): interpret the
  // baseline's scenario SENSITIVITY only — never invent modelled results.
  const objective = tab === "scenarios" && !opts.scenario ? SCENARIOS_DEFAULT_OBJECTIVE : OBJECTIVES[tab];
  {
    const fam: string[] = [];
    fam.push(`commercial contract spine data-as-of ${intel.spine.dataAsOf ?? "unknown"} (${intel.spine.dataAgeDays ?? "?"} days old — STALE evidence family; constrain current-conclusions accordingly)`);
    if (intel.updatedAt) fam.push(`freshest evidence families (SEC, AI events, procurement, FX, talent, reputation) run to ${intel.updatedAt}`);
    sections.push("", "EVIDENCE FRESHNESS BY FAMILY: " + fam.join("; ") + ".");
  }

  if (opts.signals?.length) {
    sections.push("", "CURRENT DATED SIGNALS (deterministic, evidence-gated — the freshest developments in this market):");
    for (const sg of opts.signals.slice(0, 5)) {
      sections.push(
        `  ${sg.classification}: ${sg.headline}${sg.change ? ` (${sg.change})` : ""} — ${sg.implication}`,
      );
    }
  }

  sections.push("", `ANALYTICAL OBJECTIVE FOR THIS BRIEFING: ${objective}`);
  return sections.filter((s) => s !== "").join("\n");
}

/* ── generation, cached per (tab, scope, data-version) ── */

/** Carries a non-ok result out of the cached scope so failures are never cached. */
class InsightFailure extends Error {
  constructor(public readonly result: InsightResult) {
    super("insight-failure");
  }
}

async function generateUncached(context: string): Promise<InsightResult> {
  const availability = llmAvailability();
  if (!availability.ok) return { status: "not-configured", reason: availability.reason };

  const result = await generateStructured<{ insight: string }>(availability.config, {
    system: SYSTEM_PROMPT,
    user: context,
    maxTokens: 700,
    tool: {
      name: "submit_insight",
      description: "Submit the analyst insight for this briefing.",
      input_schema: {
        type: "object",
        properties: {
          insight: {
            type: "string",
            description:
              "The private executive briefing: 130–155 words of flowing prose. Every figure must appear in the supplied context.",
          },
        },
        required: ["insight"],
      },
    },
  });

  if (!result.ok) return { status: "blocked", reasons: [result.reason] };

  let validation = validateInsight(result.value.insight ?? "", context);
  if (!validation.ok) {
    // One corrective retry (sprint 4 §4): the rules never soften — the model
    // gets the exact violations and one chance to rewrite. Still-blocked
    // output renders the refusal state as before.
    const retry = await generateStructured<{ insight: string }>(availability.config, {
      system: SYSTEM_PROMPT,
      user:
        context +
        "\n\nYOUR PREVIOUS DRAFT WAS BLOCKED by the grounding firewall for the following violations — rewrite the briefing avoiding them exactly, without weakening the analysis:\n" +
        validation.blocked.map((b) => `- ${b}`).join("\n"),
      maxTokens: 700,
      tool: {
        name: "submit_insight",
        description: "Submit the corrected analyst insight for this briefing.",
        input_schema: {
          type: "object",
          properties: { insight: { type: "string", description: "The corrected private executive briefing: 130-155 words of flowing prose. Every figure must appear in the supplied context." } },
          required: ["insight"],
        },
      },
    });
    if (!retry.ok) return { status: "blocked", reasons: validation.blocked, blockedText: result.value.insight ?? "" };
    validation = validateInsight(retry.value.insight ?? "", context);
    if (!validation.ok) return { status: "blocked", reasons: validation.blocked, blockedText: retry.value.insight ?? "" };
  }
  return { status: "ok", text: validation.text, warnings: validation.warnings };
}

/**
 * Cached wrapper. The key includes the scope, tab, scenario and the data
 * version (latest ingest dates), so changing vendors regenerates immediately
 * while repeat loads of an unchanged view spend nothing.
 */
export async function getInsight(
  intel: MarketIntel,
  tab: InsightTab,
  opts: { focalTicker?: string; scenario?: Scenario | null } = {},
): Promise<InsightResult> {
  if (intel.scope.tickers.length === 0) return { status: "no-scope" };

  // Availability is checked OUTSIDE the cache: a missing key is an environment
  // state, not an analysis, and must never be stored as one.
  const availability = llmAvailability();
  if (!availability.ok) return { status: "not-configured", reason: availability.reason };

  // Freshest dated signals ground the briefing (freeze directive §4/§8) —
  // deterministic, evidence-gated, computed with the runtime's own rules.
  const signals = await buildWatchSignals(intel, [...intel.scope.tickers].sort().join(","));
  const context = buildContext(intel, tab, { ...opts, signals });
  const dataVersion = `${intel.updatedAt ?? ""}|${intel.spine.lastIngest}`;
  const scopeSig = intel.scope.mode === "whole_market" ? "whole" : [...intel.scope.tickers].sort().join(",");
  // v9 + validator version (sprint 3 fix 1): any ruleset change invalidates
  // every cached insight, so nothing validated by an older ruleset survives.
  const key = ["insight", "v15", `val${VALIDATOR_VERSION}`, tab, opts.focalTicker ?? "", opts.scenario?.id ?? "", scopeSig, dataVersion];

  // Only DELIVERED briefings are cached. Blocked or failed generations are
  // thrown out of the cached scope so a transient error cannot be served for
  // six hours as though it were the analysis.
  const cached = unstable_cache(
    async () => {
      const result = await generateUncached(context);
      if (result.status !== "ok") throw new InsightFailure(result);
      return result;
    },
    key,
    { revalidate: 6 * 60 * 60 },
  );

  try {
    const result = await cached();
    // Defence in depth (sprint 3 fix 1): re-validate on EVERY read with the
    // validator compiled into THIS runtime. A cache entry written by a stale
    // runtime (the Sprint 2 incident) is caught here and never rendered.
    const recheck = validateInsight(result.text, context);
    if (!recheck.ok) {
      logInsightBlock({ stage: "stale-cache-recheck", reasons: recheck.blocked, text: result.text, tab, opts, scopeSig, key });
      return { status: "blocked", reasons: recheck.blocked };
    }
    return result;
  } catch (e) {
    if (e instanceof InsightFailure) {
      if (e.result.status === "blocked") {
        logInsightBlock({ stage: "generation", reasons: e.result.reasons, text: e.result.blockedText, tab, opts, scopeSig, key });
      }
      return e.result;
    }
    const message = `Insight generation failed: ${(e as Error).message}`;
    logInsightBlock({ stage: "exception", reasons: [message], tab, opts, scopeSig, key });
    return { status: "blocked", reasons: [message] };
  }
}

/**
 * Diagnostic record of a withheld briefing — server logs only, never rendered.
 * Buyers see a calm unavailable state; engineers need the exact rule, the
 * offending sentence and the scope to reproduce it. No inference internals or
 * proprietary methodology are written here.
 */
function logInsightBlock(input: {
  stage: "generation" | "stale-cache-recheck" | "exception";
  reasons: string[];
  text?: string;
  tab: InsightTab;
  opts: { focalTicker?: string; scenario?: Scenario | null };
  scopeSig: string;
  key: string[];
}): void {
  const offending = input.text ? firstOffendingSentence(input.text, input.reasons) : null;
  console.warn(
    "[analyst-insight:blocked] " +
      JSON.stringify({
        stage: input.stage,
        tab: input.tab,
        focalTicker: input.opts.focalTicker ?? null,
        scenario: input.opts.scenario?.id ?? null,
        scope: input.scopeSig,
        validatorVersion: VALIDATOR_VERSION,
        cacheKey: input.key.join("|"),
        rules: input.reasons,
        offendingSentence: offending,
        at: new Date().toISOString(),
      }),
  );
}

/** Best-effort: the sentence a numeric/ownership rule most likely fired on. */
function firstOffendingSentence(text: string, reasons: string[]): string | null {
  const quoted = reasons.map((r) => /["“']([^"”']{6,})["”']/.exec(r)?.[1]).find(Boolean);
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (quoted) {
    const hit = sentences.find((s) => s.includes(quoted));
    if (hit) return hit.trim().slice(0, 300);
  }
  const token = reasons.map((r) => /\b(\d[\d,.]*)\b/.exec(r)?.[1]).find(Boolean);
  if (token) {
    const hit = sentences.find((s) => s.includes(token));
    if (hit) return hit.trim().slice(0, 300);
  }
  return sentences[0]?.trim().slice(0, 300) ?? null;
}
