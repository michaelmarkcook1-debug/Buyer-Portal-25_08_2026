import "server-only";
import { unstable_cache } from "next/cache";
import type { MarketIntel, VendorIntel } from "@/lib/metrics/types";
import type { Scenario } from "@/lib/scenarios";
import { generateStructured, llmAvailability } from "./llm";
import { validateInsight } from "./validate";

/**
 * Analyst Insight — per-tab orchestration (spec §7–§9).
 *
 * The LLM sits at the END of the pipeline: canonical states in, judgement out.
 * Context is assembled ONLY from the resolved MarketIntel (which is itself
 * SQL-derived), the output is validated by the grounding firewall, and every
 * failure mode renders as an explicit state — never as substitute prose.
 */

export type InsightTab = "home" | "market" | "vendors" | "vendor-detail" | "opportunities" | "scenarios";

export type InsightResult =
  | { status: "ok"; text: string; warnings: string[] }
  | { status: "not-configured"; reason: string }
  | { status: "blocked"; reasons: string[] }
  | { status: "no-scope" };

const OBJECTIVES: Record<InsightTab, string> = {
  home: "Identify what matters most today across the buyer's selected vendor market — the one or two developments that most change their commercial, sourcing or supplier position.",
  market:
    "Judge how services economics are changing across the selected vendors: whether current conditions favour the buyer, why, and which one or two economic forces matter most.",
  vendors:
    "Compare the selected vendors: where they are diverging, which divergence most changes the buyer's position, and what that implies about who to press and who to watch.",
  "vendor-detail":
    "Judge how the focal vendor is changing relative to the buyer's selected market, and what that does to the buyer's position with them specifically.",
  opportunities:
    "Identify where buyer value has increased most across the selected vendors during the retrospective window, and which opportunity types deserve investigation first.",
  scenarios:
    "Judge the commercial implications of the stated scenario for the buyer's position across the selected market. Modelled values are modelled — say so where it bears on the judgement.",
};

/** Spec §8, substantially verbatim. */
const SYSTEM_PROMPT = `You are a senior VP-level industry analyst specialising in IT services,
consulting, managed services and BPO.

You are preparing a private executive briefing for an enterprise buyer.

Analyse only the verified evidence, calculated intelligence and inferred
intelligence supplied in the structured context.

The user's selected vendors define the market. Do not broaden the market
beyond that scope unless Whole Market is explicitly selected.

Do not merely summarise dashboard metrics.

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

Write like an experienced industry analyst speaking privately with a CIO,
CPO, CFO, transformation executive or strategic sourcing leader.

Write flowing prose only — no headings, no bullet points, no lists.

Maximum 200 words.`;

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
  opts: { focalTicker?: string; scenario?: Scenario | null } = {},
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

  sections.push("", `ANALYTICAL OBJECTIVE FOR THIS BRIEFING: ${OBJECTIVES[tab]}`);
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
              "The private executive briefing: 120–200 words of flowing prose. Every figure must appear in the supplied context.",
          },
        },
        required: ["insight"],
      },
    },
  });

  if (!result.ok) return { status: "blocked", reasons: [result.reason] };

  const validation = validateInsight(result.value.insight ?? "", context);
  if (!validation.ok) return { status: "blocked", reasons: validation.blocked };
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

  const context = buildContext(intel, tab, opts);
  const dataVersion = `${intel.updatedAt ?? ""}|${intel.spine.lastIngest}`;
  const scopeSig = intel.scope.mode === "whole_market" ? "whole" : [...intel.scope.tickers].sort().join(",");
  // v5: data-engine sprint 1 — procurement flow, EDGAR financials, observed
  // snapshots and data-as-of framing entered the context.
  const key = ["insight", "v8", tab, opts.focalTicker ?? "", opts.scenario?.id ?? "", scopeSig, dataVersion];

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
    return await cached();
  } catch (e) {
    if (e instanceof InsightFailure) return e.result;
    return { status: "blocked", reasons: [`Insight generation failed: ${(e as Error).message}`] };
  }
}
