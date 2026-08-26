/**
 * Tab-specific analytical objectives (sprint 4 §5) — each tab must answer a
 * DIFFERENT question. Pure module so tests can assert distinctness.
 *
 * TOP-LEVEL TABS (home/market/vendors/opportunities/scenarios) carry a locked
 * analytical hierarchy: market judgement first, then cross-vendor divergence,
 * then the vendor that best illustrates it, then the buyer action. The
 * selected vendors DEFINE the market, so a single vendor may be the clearest
 * example but never a substitute for the market-level judgement. Detail pages
 * are exempt — they exist to interpret one focal subject.
 */

/** The hierarchy every top-level tab hero must follow. */
export const MARKET_FIRST_HIERARCHY =
  "STRUCTURE — follow this order strictly:\n" +
  "1. MARKET JUDGEMENT: open with a decisive read on the SELECTED MARKET as a whole — what dominates it right now, and whether that condition is broad-based or concentrated. The first sentence must characterise the market, not a single vendor.\n" +
  "2. DIVERGENCE: say how the selected vendors differ on that pattern, and on what axis.\n" +
  "3. VENDOR EXAMPLE: name the vendor that most clearly expresses the pattern (and, where useful, the one that departs from it) as EVIDENCE within the market read — 'X is the clearest expression of this', 'Y differs because…' — never 'X is the opportunity'.\n" +
  "4. BUYER IMPLICATION: what the buyer should do or investigate.\n" +
  "Do NOT open with a vendor name or a single-vendor claim. Equally, do NOT retreat into generic survey language ('the market presents several opportunities across pricing, automation and gain sharing') — the market judgement itself must be specific and decisive.";

export type InsightTab =
  | "home"
  | "market"
  | "vendors"
  | "vendor-detail"
  | "opportunities"
  | "opportunity-detail"
  | "scenarios"
  | "reputation";

/** Tabs whose hero interprets the market, not one subject. */
export const TOP_LEVEL_TABS: InsightTab[] = ["home", "market", "vendors", "opportunities", "scenarios", "reputation"];

export const OBJECTIVES: Record<InsightTab, string> = {
  home:
    "Answer: what matters most across the SELECTED MARKET right now? Establish the single most important development at market level first — what it is, and why it dominates this market — and only then identify the vendor that most demands attention. A single vendor may lead ONLY if one exceptional event genuinely dominates the whole selected market, and you must say explicitly why it dominates. Do not survey everything.",
  market:
    "Answer: how are current conditions across the selected vendors changing the buyer's commercial position? Lead with the selected market's commercial condition — does this market currently favour the buyer, and what force is driving that? Then where the vendors DIVERGE, then which vendor most changes the interpretation. Never open as a vendor profile, and never offer generic macro commentary.",
  vendors:
    "Answer: which selected vendors are diverging most, and why should the buyer treat them DIFFERENTLY? Open by naming the AXIS of divergence across the market, then place the strongest and weakest examples on it, and end with who to press and who to watch.",
  "vendor-detail":
    "Answer: what is materially different about THIS vendor relative to the selected vendor market, and what specifically should the buyer challenge with them? Position every judgement relative to the other selected vendors. This is a focal-subject page: you may lead with this vendor.",
  opportunities:
    "Answer: where is buyer value changing ACROSS THE SELECTED MARKET, and what is the strongest commercial lever right now? Open with the market-level judgement: which opportunity family dominates across these vendors, whether it is broad-based or concentrated in one or two, and what changed over the period. Only then name the vendor presenting the clearest example, and say how the others differ. Do not open with a vendor.",
  "opportunity-detail":
    "Answer: for this specific vendor and opportunity type, what changed in the evidence, how strong is the case now, and what exactly should the buyer investigate or challenge in a commercial discussion? Stay on this opportunity — do not survey the vendor generally. This is a focal-subject page: you may lead with this vendor and opportunity.",
  reputation:
    "Answer: what is the reputation and delivery-perception picture across the SELECTED MARKET, and where does it diverge from what vendors claim? Open with the market-level read — is perception broadly holding, improving or eroding across these vendors, and what is driving it. Then name where the vendors DIVERGE, and identify any vendor whose stated positioning runs ahead of the delivery evidence. End with what the buyer should verify in a review or renewal conversation. Reputation is a WATCH signal about market perception, never a finding about delivery quality on the buyer's own account — say so where a reader might over-read it.",
  scenarios:
    "Answer: what does this MODELLED scenario do to the selected market, and which assumption matters most to the buyer's position? Lead with the scenario's market-level effect — what shifts across these vendors collectively and whether the shift is broad or narrow. Then say which selected vendor is most affected, which opportunity family moves most, and what the buyer would do differently. Never merely that a number moved; never open with the most-affected vendor before establishing the market effect. Modelled values are modelled; say so where it bears on the judgement.",
};

/** Scenarios tab with NO scenario selected: baseline sensitivity only. */
export const SCENARIOS_DEFAULT_OBJECTIVE =
  "No scenario is selected yet. From the current baseline evidence only, judge which market variable — demand/deal flow, delivery-cost economics, AI capability, talent capacity, renewal concentration, or vendor financial position — currently has the greatest potential to change the buyer's commercial position across the selected vendors, and why. Do not invent modelled outcomes or hypothetical numbers.";
