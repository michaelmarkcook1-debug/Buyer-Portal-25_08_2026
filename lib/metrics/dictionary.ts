import type { MetricState, Movement, OpportunityLevel } from "./types";

/**
 * Metric dictionary — the single source of buyer-facing meaning.
 *
 * Three things are deliberately kept apart:
 *   MAGNITUDE        how much of the thing there is (High / Low)
 *   DIRECTION        which way it is moving (Improving / Deteriorating)
 *   BUYER EFFECT     what it means for the reader (favourable / caution / …)
 *
 * The canonical layer computes one `MetricState` per metric. What that state
 * MEANS differs by variable: "favourable" on operational risk means low risk,
 * while "favourable" on provider momentum means the VENDOR is strengthening —
 * which reduces the buyer's room, not increases it. So every metric maps its
 * own state vocabulary AND its own buyer effect here, rather than inheriting a
 * single favourable/unfavourable scale that fits only some variables.
 *
 * Nothing here recalculates anything. It translates canonical meaning into
 * correct language, tone and explanation.
 */

/** What a reading means for the reader — drives colour, never the wording. */
export type BuyerEffect = "favourable" | "caution" | "unfavourable" | "neutral" | "unknown";

export interface MetricSemantics {
  /** Buyer-facing name. */
  name: string;
  /** Plain-English definition — "what is this?" */
  definition: string;
  /** How to read the scale for THIS variable. */
  interpretation: string;
  /** What it does not mean. Omitted where nothing important is at stake. */
  caveat?: string;
  /** Period/scope note where the window is not obvious. */
  window?: string;
  /** State vocabulary for this variable. */
  labels: Record<MetricState, string>;
  /** Buyer effect per state — never assumed from the label's tone. */
  effect: Record<MetricState, BuyerEffect>;
}

const SCOPE_NOTE = "Scoped to your selected vendors.";

/** Opportunity families share magnitude vocabulary — high opportunity is good. */
function opportunity(name: string, definition: string, interpretation: string, caveat?: string): MetricSemantics {
  return {
    name,
    definition,
    interpretation,
    caveat,
    labels: { favourable: "High", stable: "Medium", unfavourable: "Low", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "neutral", mixed: "caution", insufficient: "unknown" },
  };
}

export const METRIC_DICTIONARY: Record<string, MetricSemantics> = {
  buyerLeverage: {
    name: "Buyer leverage",
    definition:
      "The strength of the buyer's negotiating position relative to these vendors within the selected market.",
    interpretation:
      "Strong means current market, competitive and vendor conditions give buyers more room to challenge commercial terms.",
    caveat:
      "It does not mean the portal knows your contracts, spend or negotiating rights — this is market evidence only.",
    labels: { favourable: "Strong", stable: "Balanced", unfavourable: "Weak", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  pricingPressure: {
    name: "Pricing conditions",
    definition: "Which side of the table current observed pricing evidence favours.",
    interpretation:
      "Buyer favourable means the observed record leans toward the buyer on price. This is a direction, not a discount.",
    caveat: "It is not a rate benchmark and never a claim about your own pricing.",
    labels: { favourable: "Buyer favourable", stable: "Balanced", unfavourable: "Supplier favourable", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  pricingOpportunity: opportunity(
    "Pricing opportunity",
    "Where vendor and market economics may give buyers greater scope to challenge current commercial assumptions.",
    "Very High means the evidence supports a strong case to investigate pricing or commercial structure.",
    "It does not mean a guaranteed saving, and it is not a rate benchmark.",
  ),
  savingsOpportunity: opportunity(
    "Savings opportunity",
    "Where market and vendor economics suggest commercial value may exist.",
    "High means the evidence supports investigating commercial terms. It is directional, never a guaranteed monetary saving.",
    "It is not a calculation of your savings — the portal holds no buyer spend.",
  ),
  automationOpportunity: opportunity(
    "Automation opportunity",
    "Automation capability set against a labour-heavy delivery base.",
    "High means capability is advanced relative to how the work is still delivered — a basis to challenge unit economics.",
    "Capability is not deployment — it does not mean your own work is being automated today.",
  ),
  aiProductivityOpportunity: opportunity(
    "AI productivity opportunity",
    "Whether AI delivery capability has moved enough to challenge productivity assumptions.",
    "High means capability has advanced materially, so assumptions priced in earlier may be out of date.",
    "It is a reason to re-test assumptions, not evidence that the vendor's costs have fallen.",
  ),
  gainShareOpportunity: opportunity(
    "Gain-sharing opportunity",
    "Whether delivery productivity is improving faster than commercial terms have followed.",
    "High means productivity gains exist that current commercial structures may not yet reflect.",
    "It does not size a gain-share, and it says nothing about what your current contract already allows.",
  ),
  marketTestOpportunity: opportunity(
    "Market-test opportunity",
    "The strength of the case for testing alternative suppliers or creating competitive tension.",
    "High means credible alternatives are active in the same lines of work.",
    "Active in the market is not the same as suitable for you — it is a prompt to look, not a shortlist.",
  ),

  /* ── vendor condition: strength here is the VENDOR's, not the buyer's ── */
  financialResilience: {
    name: "Financial resilience",
    definition: "The vendor's own financial condition, held separate from your negotiating position.",
    interpretation:
      "Very strong describes the vendor, not your leverage. A financially strong vendor is a more dependable delivery partner and usually has less need to concede.",
    caveat: "Strength here is neither good nor bad for the buyer on its own — read it alongside buyer leverage.",
    labels: { favourable: "Very strong", stable: "Moderate", unfavourable: "Weak", mixed: "Mixed", insufficient: "Insufficient evidence" },
    // deliberately NOT buyer-positive: vendor health is context, not advantage
    effect: { favourable: "neutral", stable: "neutral", unfavourable: "caution", mixed: "caution", insufficient: "unknown" },
  },

  financialHeadroom: {
    name: "Financial headroom",
    definition: "Observed room in the vendor's margin position to absorb commercial pressure.",
    interpretation: "High means the filed position shows room to fund concessions or investment.",
    caveat: "Room to concede is not willingness to concede.",
    labels: { favourable: "High", stable: "Moderate", unfavourable: "Low", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  providerMomentum: {
    name: "Provider momentum",
    definition: "The direction of the vendor's own commercial momentum.",
    interpretation:
      "Strengthening describes the vendor winning more, which generally reduces a buyer's room to press. Weakening generally moves demand pressure toward the buyer.",
    caveat:
      "The colour reflects what the movement means for you, not whether it is good news for the vendor.",
    labels: { favourable: "Strengthening", stable: "Stable", unfavourable: "Weakening", mixed: "Mixed", insufficient: "Insufficient evidence" },
    // inverted on purpose: a strengthening supplier is a caution for the buyer
    effect: { favourable: "caution", stable: "neutral", unfavourable: "favourable", mixed: "caution", insufficient: "unknown" },
  },

  talentPressure: {
    name: "Talent pressure",
    definition: "Whether the delivery workforce behind this vendor is growing or contracting.",
    interpretation: "High pressure means the workforce is contracting — a capacity question on multi-year commitments.",
    caveat: "This is a continuity signal before it is a pricing one.",
    labels: { favourable: "Low", stable: "Moderate", unfavourable: "High", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "neutral", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  deliveryCostPressure: {
    name: "Delivery cost pressure",
    definition: "The macro direction of delivery costs behind these services.",
    interpretation: "Falling costs generally favour buyers; rising costs give vendors a cost argument.",
    caveat: "Macro evidence only — never enterprise pricing.",
    labels: { favourable: "Falling", stable: "Stable", unfavourable: "Rising", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  dealMarketHeat: {
    name: "Deal market heat",
    definition: "How competitive the observed demand environment is for these vendors.",
    interpretation: "Cool means vendors are winning less, which moves demand pressure toward the buyer. Hot means the opposite.",
    caveat: "It reads the public award record for these vendors — not their full pipeline, and not your own demand.",
    window: "Public procurement award flow, trailing 90 days against the prior 90.",
    labels: { favourable: "Cool", stable: "Balanced", unfavourable: "Hot", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  operationalRisk: {
    name: "Operational risk",
    definition: "Evidence of conditions that may increase delivery or supplier-management risk.",
    interpretation: "High means more scrutiny is warranted before or during a commitment.",
    caveat: "High risk is never a buyer advantage — it is styled as caution, not opportunity.",
    labels: { favourable: "Low", stable: "Moderate", unfavourable: "High", mixed: "Elevated", insufficient: "Insufficient evidence" },
    effect: { favourable: "favourable", stable: "neutral", unfavourable: "unfavourable", mixed: "caution", insufficient: "unknown" },
  },

  reputationMovement: {
    name: "Reputation movement",
    definition: "Movement in the AnalystGenius reputation tracker for this vendor.",
    interpretation: "Deteriorating reputation often precedes commercial or delivery strain worth watching.",
    caveat: "Reputation is a watch signal, not a finding about delivery quality on your own account.",
    labels: { favourable: "Improving", stable: "Stable", unfavourable: "Deteriorating", mixed: "Mixed", insufficient: "Insufficient evidence" },
    effect: { favourable: "neutral", stable: "neutral", unfavourable: "caution", mixed: "caution", insufficient: "unknown" },
  },

  commercialOpportunity: opportunity(
    "Commercial opportunity",
    "The overall strength of the commercial case across the opportunity families for this vendor.",
    "Very high means several families point the same way on evidence that holds up.",
    "It ranks where to look first — it is not a savings estimate.",
  ),

  /* ── Market dimensions that are NOT a vendor metric rolled up ──────────────
     These measure the market itself, so they carry their own vocabulary rather
     than borrowing a vendor scale that would read wrongly at market level
     (e.g. "Labour economics: High" says nothing; "Under strain" does). ── */

  "m.demand": {
    name: "Services demand",
    definition: "Whether award activity across your market is growing or softening.",
    interpretation:
      "Expanding means more work is being awarded than in the prior window; softening means less.",
    caveat:
      "Softening demand is not automatically your gain — it can widen a vendor's appetite to defend revenue, or signal instability worth understanding first.",
    window: "Current window vs the prior equivalent window.",
    /* "Contracting" was ambiguous in a portal about contracting: read as a
       noun it means signing activity, which is a different measure entirely.
       "Softening" is unambiguous, and stays clear of the Hot/Cool vocabulary
       market heat already owns. */
    labels: {
      favourable: "Expanding", stable: "Steady", unfavourable: "Softening",
      mixed: "Mixed", insufficient: "Insufficient evidence",
    },
    /* Growth is ordinary market context and stays neutral. A softening market
       is not: it is the reading that should make a buyer look, which is what
       amber means here — attention, not advantage. */
    effect: {
      favourable: "neutral", stable: "neutral", unfavourable: "caution",
      mixed: "caution", insufficient: "unknown",
    },
  },

  "m.intensity": {
    name: "Competitive intensity",
    definition: "How many of your vendors are actively winning work, versus the prior window.",
    interpretation:
      "Broadening means work is spreading across more of your vendors — more credible alternatives at the table.",
    caveat: "It counts which vendors win, not what they charge.",
    window: "Current window vs the prior equivalent window.",
    labels: {
      favourable: "Broadening", stable: "Steady", unfavourable: "Narrowing",
      mixed: "Mixed", insufficient: "Insufficient evidence",
    },
    effect: {
      favourable: "favourable", stable: "neutral", unfavourable: "unfavourable",
      mixed: "caution", insufficient: "unknown",
    },
  },

  "m.supplier": {
    name: "Supplier economics",
    definition: "The financial direction of the vendors in your market, taken together.",
    interpretation: "Strained means vendor finances are tightening across the market.",
    caveat: "Vendor health is context for delivery continuity — not a bargaining advantage either way.",
    labels: {
      favourable: "Expanding", stable: "Steady", unfavourable: "Strained",
      mixed: "Mixed", insufficient: "Insufficient evidence",
    },
    effect: {
      favourable: "neutral", stable: "neutral", unfavourable: "caution",
      mixed: "caution", insufficient: "unknown",
    },
  },

  "m.labour": {
    name: "Labour economics",
    definition: "Whether the delivery workforces behind your vendors are growing or contracting.",
    interpretation: "Under strain means workforces are contracting across the market.",
    caveat: "A continuity signal before it is a pricing one.",
    labels: {
      favourable: "Expanding", stable: "Steady", unfavourable: "Under strain",
      mixed: "Mixed", insufficient: "Insufficient evidence",
    },
    effect: {
      favourable: "neutral", stable: "neutral", unfavourable: "unfavourable",
      mixed: "caution", insufficient: "unknown",
    },
  },

  "m.buyerEconomics": {
    name: "Buyer economics",
    definition:
      "The combined read across the market dimensions below — pricing, labour, competition, supplier health, AI and demand.",
    interpretation:
      "Buyer favourable means most dimensions point your way at once. Balanced means they pull in different directions.",
    caveat: "A summary of the dimensions shown beneath it — not a separate measurement.",
    labels: {
      favourable: "Buyer favourable", stable: "Balanced", unfavourable: "Vendor favourable",
      mixed: "Balanced", insufficient: "Insufficient evidence",
    },
    /* "Balanced" here always means the dimensions disagree, so it carries the
       same caution tone from either state — the one reading must never change
       colour between refreshes. */
    effect: {
      favourable: "favourable", stable: "caution", unfavourable: "unfavourable",
      mixed: "caution", insufficient: "unknown",
    },
  },
};

/** Opportunity magnitude vocabulary — shared by every family. */
export const LEVEL_VOCABULARY: Record<OpportunityLevel, string> = {
  "very-high": "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
  insufficient: "Insufficient evidence",
};

/** Opportunity magnitude → buyer effect. High opportunity IS buyer-favourable. */
export function levelEffect(level: OpportunityLevel): BuyerEffect {
  if (level === "very-high" || level === "high") return "favourable";
  if (level === "medium" || level === "low") return "neutral";
  return "unknown";
}


/* Market-level rollups carry "m."-prefixed ids but describe the SAME variables
   as their vendor-level counterparts, so they inherit the same vocabulary,
   buyer effects and explanations rather than falling back to the generic
   favourable/unfavourable scale. */
const ROLLUP_ALIASES: Record<string, string> = {
  "m.buyerLeverage": "buyerLeverage",
  "m.pricingPressure": "pricingPressure",
  "m.automation": "automationOpportunity",
  "m.commercial": "commercialOpportunity",
  "m.heat": "dealMarketHeat",
  "m.oprisk": "operationalRisk",
  "m.aiPressure": "aiProductivityOpportunity",
};

/** Resolve an id through the rollup aliases before dictionary lookup. */
export function canonicalMetricId(metricId: string): string {
  return ROLLUP_ALIASES[metricId] ?? metricId;
}

export interface ResolvedDisplay {
  label: string;
  effect: BuyerEffect;
  semantics?: MetricSemantics;
}

/**
 * Translate a canonical state into the wording and tone correct for THIS
 * metric. Metrics with no dictionary entry fall back to the generic scale so
 * nothing can render blank.
 */
export function displayState(metricId: string, state: MetricState): ResolvedDisplay {
  const s = METRIC_DICTIONARY[canonicalMetricId(metricId)];
  if (!s) {
    const generic: Record<MetricState, string> = {
      favourable: "Favourable", stable: "Stable", unfavourable: "Unfavourable",
      mixed: "Mixed", insufficient: "Insufficient evidence",
    };
    const genericEffect: Record<MetricState, BuyerEffect> = {
      favourable: "favourable", stable: "neutral", unfavourable: "unfavourable",
      mixed: "caution", insufficient: "unknown",
    };
    return { label: generic[state], effect: genericEffect[state] };
  }
  return { label: s.labels[state], effect: s.effect[state], semantics: s };
}

/** Movement wording is variable-independent — it always describes direction. */
export const MOVEMENT_VOCABULARY: Record<Movement, string> = {
  "materially-improving": "Materially improving",
  improving: "Improving",
  stable: "Stable",
  deteriorating: "Deteriorating",
  "materially-deteriorating": "Materially deteriorating",
  insufficient: "No direction held",
};

/** The classification system, explained once. */
export const SIGNAL_CLASS_HELP = {
  name: "Act / Watch / Know",
  definition: "How AnalystGenius rates what a development asks of you.",
  interpretation:
    "ACT — a material development with a credible basis for buyer action. WATCH — meaningful movement worth following, but not yet an action trigger. KNOW — useful context that does not currently warrant action.",
  caveat: "Classification reflects the strength of the evidence, not urgency invented for effect.",
} satisfies Pick<MetricSemantics, "name" | "definition" | "interpretation" | "caveat">;

export const SCOPE_HELP = SCOPE_NOTE;
