/**
 * Tab-specific analytical objectives (sprint 4 §5) — each tab must answer a
 * DIFFERENT question. Pure module so tests can assert distinctness.
 */

export type InsightTab =
  | "home"
  | "market"
  | "vendors"
  | "vendor-detail"
  | "opportunities"
  | "opportunity-detail"
  | "scenarios";

export const OBJECTIVES: Record<InsightTab, string> = {
  home:
    "Answer: what is the SINGLE most important development across the selected vendor market today, and what should the buyer pay attention to first? Lead with that one development — do not survey everything.",
  market:
    "Answer: how are current conditions across the selected vendors changing the buyer's commercial position? Focus on how the selected vendors are collectively changing and where they DIVERGE — never generic macro commentary. Call out unevenness explicitly (e.g. broadly buyer-favourable, but the strongest leverage sits with one vendor while another's financial strength blunts conventional discount pressure).",
  vendors:
    "Answer: which selected vendors are diverging most, and why should the buyer treat them DIFFERENTLY? Compare, contrast, and end with who to press and who to watch.",
  "vendor-detail":
    "Answer: what is materially different about THIS vendor relative to the selected vendor market, and what specifically should the buyer challenge with them? Position every judgement relative to the other selected vendors.",
  opportunities:
    "Answer: where has buyer value increased MOST across the selected vendors, and what is the strongest commercial lever right now? Name the opportunity family and the vendor it applies to — do not re-narrate the market backdrop.",
  "opportunity-detail":
    "Answer: for this specific vendor and opportunity type, what changed in the evidence, how strong is the case now, and what exactly should the buyer investigate or challenge in a commercial discussion? Stay on this opportunity — do not survey the vendor generally.",
  scenarios:
    "Answer: which assumption matters most to the buyer's position, and how does the MODELLED scenario alter vendor strategy? Say which selected vendor is most affected, which opportunity family moves most, and what the buyer would do differently — never merely that a number moved. Modelled values are modelled; say so where it bears on the judgement.",
};

/** Scenarios tab with NO scenario selected: baseline sensitivity only. */
export const SCENARIOS_DEFAULT_OBJECTIVE =
  "No scenario is selected yet. From the current baseline evidence only, judge which market variable — demand/deal flow, delivery-cost economics, AI capability, talent capacity, renewal concentration, or vendor financial position — currently has the greatest potential to change the buyer's commercial position across the selected vendors, and why. Do not invent modelled outcomes or hypothetical numbers.";
