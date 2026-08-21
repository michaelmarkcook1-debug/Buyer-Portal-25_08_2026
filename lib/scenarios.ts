import type { MarketIntel, Metric, Opportunity, OpportunityType, VendorIntel } from "./metrics/types";
import { shiftLevel, levelScore } from "./metrics/types";

/**
 * Predefined scenarios (spec §16). No custom modelling environment.
 *
 * A scenario is a DECLARED transform over canonical states — it shifts bands
 * and marks every touched value as modelled. It never invents figures, never
 * touches the underlying facts, and its outputs are visibly labelled as a
 * modelled recalculation, not new evidence.
 */

export interface Scenario {
  id: string;
  label: string;
  question: string;
  /** What the scenario assumes — shown verbatim beside every output. */
  assumes: string;
  /** Which canonical values it adjusts, in plain language. */
  adjusts: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "ai-productivity-up",
    label: "AI productivity +10%",
    question: "If vendor AI delivery productivity improves a further 10%, where does buyer value move?",
    assumes: "AI-enabled delivery productivity across the selected vendors improves by ten percent.",
    adjusts: ["Automation opportunity", "Gain-sharing opportunity", "AI productivity opportunity"],
  },
  {
    id: "market-pricing-down",
    label: "Market pricing −5%",
    question: "If market pricing for comparable services falls 5%, what should be challenged?",
    assumes: "Prevailing pricing for comparable services falls five percent.",
    adjusts: ["Pricing opportunity", "Savings opportunity"],
  },
  {
    id: "delivery-costs-up",
    label: "Offshore delivery costs +8%",
    question: "If offshore delivery costs rise 8%, whose economics strain first?",
    assumes: "Delivery labour costs in major offshore hubs rise eight percent.",
    adjusts: ["Delivery cost pressure", "Provider momentum", "Gain-sharing opportunity"],
  },
  {
    id: "demand-weakens",
    label: "Supplier demand weakens",
    question: "If services demand softens, how much does buyer leverage strengthen?",
    assumes: "New-award flow across the market softens materially.",
    adjusts: ["Deal market heat", "Buyer leverage", "Pricing opportunity"],
  },
  {
    id: "intensity-up",
    label: "Competitive intensity increases",
    question: "If more credible alternatives compete for the same work, what opens up?",
    assumes: "Competitive intensity across the selected vendor market increases.",
    adjusts: ["Market-test opportunity", "Commercial leverage", "Pricing opportunity"],
  },
  {
    id: "margins-compress",
    label: "Provider margins compress",
    question: "If vendor margins compress, where do buyers gain and where do they lose?",
    assumes: "Vendor operating margins compress across the market.",
    adjusts: ["Financial resilience", "Gain-sharing opportunity", "Operational risk"],
  },
  {
    id: "automation-accelerates",
    label: "Automation accelerates",
    question: "If automation of labour-intensive delivery accelerates, which assumptions break?",
    assumes: "Automation of labour-intensive managed services accelerates across the market.",
    adjusts: ["Automation opportunity", "Talent pressure", "Gain-sharing opportunity"],
  },
  {
    id: "leverage-strengthens",
    label: "Buyer leverage strengthens",
    question: "If your negotiating position strengthens, which conversations open first?",
    assumes: "The buyer's negotiating position strengthens across the selected market.",
    adjusts: ["Commercial leverage", "Savings opportunity", "Market-test opportunity"],
  },
];

export function getScenario(id: string | undefined): Scenario | null {
  if (!id) return null;
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

const MODELLED = (s: Scenario) => `Modelled under “${s.label}” — a recalculated state, not new evidence.`;

function upState(m: Metric, s: Scenario): Metric {
  if (m.state === "insufficient") return m;
  const next = m.state === "unfavourable" ? "mixed" : m.state === "mixed" || m.state === "stable" ? "favourable" : m.state;
  return { ...m, state: next, modelled: MODELLED(s) };
}
function downState(m: Metric, s: Scenario): Metric {
  if (m.state === "insufficient") return m;
  const next = m.state === "favourable" ? "mixed" : m.state === "mixed" || m.state === "stable" ? "unfavourable" : m.state;
  return { ...m, state: next, modelled: MODELLED(s) };
}
function upOpp(o: Opportunity, s: Scenario): Opportunity {
  if (o.level === "insufficient") return o;
  return { ...o, level: shiftLevel(o.level, 1), modelled: MODELLED(s) };
}
function downOpp(o: Opportunity, s: Scenario): Opportunity {
  if (o.level === "insufficient") return o;
  return { ...o, level: shiftLevel(o.level, -1), modelled: MODELLED(s) };
}

function applyToVendor(v: VendorIntel, s: Scenario): VendorIntel {
  const m = { ...v.metrics };
  const o = { ...v.opportunities };

  switch (s.id) {
    case "ai-productivity-up":
      m.aiProductivityOpportunity = upState(m.aiProductivityOpportunity, s);
      m.automationOpportunity = upState(m.automationOpportunity, s);
      m.gainShareOpportunity = upState(m.gainShareOpportunity, s);
      o.automation = upOpp(o.automation, s);
      o["gain-sharing"] = upOpp(o["gain-sharing"], s);
      break;
    case "market-pricing-down":
      m.pricingPressure = upState(m.pricingPressure, s);
      m.savingsOpportunity = upState(m.savingsOpportunity, s);
      o.pricing = upOpp(o.pricing, s);
      break;
    case "delivery-costs-up":
      m.deliveryCostPressure = { ...m.deliveryCostPressure, state: "unfavourable", movement: "deteriorating", confidence: "low", headline: "Modelled: delivery cost pressure rises.", modelled: MODELLED(s) };
      m.providerMomentum = downState(m.providerMomentum, s);
      o["gain-sharing"] = upOpp(o["gain-sharing"], s);
      break;
    case "demand-weakens":
      m.dealMarketHeat = upState(m.dealMarketHeat, s);
      m.buyerLeverage = upState(m.buyerLeverage, s);
      o.pricing = upOpp(o.pricing, s);
      o["commercial-leverage"] = upOpp(o["commercial-leverage"], s);
      break;
    case "intensity-up":
      m.marketTestOpportunity = upState(m.marketTestOpportunity, s);
      o["market-test"] = upOpp(o["market-test"], s);
      o["commercial-leverage"] = upOpp(o["commercial-leverage"], s);
      o.pricing = upOpp(o.pricing, s);
      break;
    case "margins-compress":
      m.financialResilience = downState(m.financialResilience, s);
      m.operationalRisk = downState(m.operationalRisk, s);
      o["gain-sharing"] = upOpp(o["gain-sharing"], s);
      break;
    case "automation-accelerates":
      m.automationOpportunity = upState(m.automationOpportunity, s);
      m.talentPressure = downState(m.talentPressure, s);
      o.automation = upOpp(o.automation, s);
      o["gain-sharing"] = upOpp(o["gain-sharing"], s);
      break;
    case "leverage-strengthens":
      m.buyerLeverage = upState(m.buyerLeverage, s);
      m.savingsOpportunity = upState(m.savingsOpportunity, s);
      o["commercial-leverage"] = upOpp(o["commercial-leverage"], s);
      o["market-test"] = upOpp(o["market-test"], s);
      break;
  }

  const defined = Object.values(o).filter((x) => x.level !== "insufficient");
  const overall: Opportunity = defined.length
    ? {
        ...v.overall,
        level: (["insufficient", "low", "medium", "high", "very-high"] as const)[
          Math.min(4, Math.max(1, Math.round(
            defined.reduce((a, x) => a + levelScore(x.level), 0) / defined.length * 0.5 +
            Math.max(...defined.map((x) => levelScore(x.level))) * 0.5,
          )))
        ],
        modelled: MODELLED(s),
      }
    : v.overall;

  return { ...v, metrics: m, opportunities: o, overall };
}

export interface ScenarioResult {
  scenario: Scenario;
  vendors: VendorIntel[];
  /** Rank moves vs the baseline ordering: ticker → delta (positive = up). */
  rankMoves: Map<string, number>;
}

export function applyScenario(intel: MarketIntel, scenario: Scenario): ScenarioResult {
  const baselineOrder = intel.vendors.map((v) => v.ticker);
  const vendors = intel.vendors.map((v) => applyToVendor(v, scenario));
  vendors.sort((a, b) => levelScore(b.overall.level) - levelScore(a.overall.level));
  const rankMoves = new Map<string, number>();
  vendors.forEach((v, i) => {
    const before = baselineOrder.indexOf(v.ticker);
    rankMoves.set(v.ticker, before - i);
  });
  return { scenario, vendors, rankMoves };
}

/* ── §18 (sprint 4): what the scenario means for STRATEGY, not just scores ── */

export interface ScenarioRead {
  /** Vendor whose opportunity profile moves most under the assumption. */
  mostAffected: { ticker: string; name: string } | null;
  /** The opportunity family that moves most for that vendor. */
  familyMoved: OpportunityType | null;
  /** Whether the buyer's relative position improves, worsens, or holds. */
  position: "improves" | "worsens" | "holds";
  /** Plain-language strategy note — modelled, never evidence. */
  note: string;
}

const FAMILY_TEXT: Record<OpportunityType, string> = {
  pricing: "pricing", automation: "automation", "gain-sharing": "gain-sharing",
  "commercial-leverage": "commercial leverage", "market-test": "market-test",
};

export function scenarioRead(baseline: MarketIntel, result: ScenarioResult): ScenarioRead {
  const before = new Map(baseline.vendors.map((v) => [v.ticker, v]));
  let best: { ticker: string; name: string; delta: number; family: OpportunityType | null; dir: number } | null = null;
  let netDelta = 0;
  for (const v of result.vendors) {
    const b = before.get(v.ticker);
    if (!b) continue;
    let vendorDelta = 0;
    let famBest: { f: OpportunityType; d: number } | null = null;
    for (const f of Object.keys(FAMILY_TEXT) as OpportunityType[]) {
      const d = levelScore(v.opportunities[f].level) - levelScore(b.opportunities[f].level);
      vendorDelta += d;
      if (d !== 0 && (!famBest || Math.abs(d) > Math.abs(famBest.d))) famBest = { f, d };
    }
    netDelta += vendorDelta;
    if (!best || Math.abs(vendorDelta) > Math.abs(best.delta)) {
      best = { ticker: v.ticker, name: v.name, delta: vendorDelta, family: famBest?.f ?? null, dir: Math.sign(vendorDelta) };
    }
  }
  if (!best || best.delta === 0) {
    return {
      mostAffected: null, familyMoved: null, position: "holds",
      note: "Under this assumption, no selected vendor's opportunity profile moves a band — the modelled change is not decision-relevant at current evidence levels.",
    };
  }
  const position = netDelta > 0 ? "improves" : netDelta < 0 ? "worsens" : "holds";
  const others = result.vendors.filter((v) => v.ticker !== best!.ticker);
  const unmoved = others.filter((v) => {
    const b = before.get(v.ticker)!;
    return (Object.keys(FAMILY_TEXT) as OpportunityType[]).every(
      (f) => levelScore(v.opportunities[f].level) === levelScore(b.opportunities[f].level),
    );
  });
  const note =
    `The scenario ${best.dir > 0 ? "strengthens" : "weakens"} the ${best.family ? FAMILY_TEXT[best.family] : "commercial"} case ` +
    `${best.dir > 0 ? "against" : "with"} ${best.name}` +
    (unmoved.length > 0
      ? `, but changes little for ${unmoved.map((v) => v.name).join(" and ")} — their positions rest on different evidence`
      : "") +
    `. Modelled recalculation, not new evidence.`;
  return { mostAffected: { ticker: best.ticker, name: best.name }, familyMoved: best.family, position, note };
}
