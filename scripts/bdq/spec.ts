/**
 * BUYER DECISION QUALITY (BDQ) — locked specification.
 *
 * The buyer tasks, control vendors and scopes established across the manual
 * pilot audits, frozen so results stay comparable between releases. Task IDs
 * are STABLE: renaming one breaks the comparison the harness exists to make.
 *
 * Nothing here encodes a figure. Award counts, values and rankings all move
 * legitimately with the data; what must stay stable is whether a buyer can
 * still answer the question, not what the answer happens to be today.
 */

export interface BuyerTask {
  id: string;
  question: string;
  /** Which resolved evidence must exist for the question to be answerable. */
  needs: "signals" | "opportunities" | "movement" | "exposure" | "capability" | "financial" | "workforce" | "differentiation" | "limits";
  /** Persona the task belongs to. */
  persona: "CPO" | "VMO";
}

/** §6 — the locked task set. IDs must not change. */
export const BUYER_TASKS: BuyerTask[] = [
  { id: "BDQ-01", question: "Which provider should I focus on right now?", needs: "signals", persona: "CPO" },
  { id: "BDQ-02", question: "Where is the strongest potential commercial leverage?", needs: "opportunities", persona: "CPO" },
  { id: "BDQ-03", question: "What materially changed in the market?", needs: "movement", persona: "CPO" },
  { id: "BDQ-04", question: "Is this an environment where market-testing incumbents deserves consideration?", needs: "movement", persona: "CPO" },
  { id: "BDQ-05", question: "Which providers have material commercial exposure approaching end-of-term?", needs: "exposure", persona: "VMO" },
  { id: "BDQ-06", question: "Where is capability improving faster than commercial terms appear to change?", needs: "capability", persona: "CPO" },
  { id: "BDQ-07", question: "Which providers appear to have financial room to negotiate?", needs: "financial", persona: "CPO" },
  { id: "BDQ-08", question: "Where could workforce movement create delivery/continuity risk?", needs: "workforce", persona: "VMO" },
  { id: "BDQ-09", question: "Why should IBM be managed differently from Accenture?", needs: "differentiation", persona: "VMO" },
  { id: "BDQ-10", question: "What should be challenged with Capgemini in its next QBR?", needs: "differentiation", persona: "VMO" },
  { id: "BDQ-11", question: "Which provider deserves attention that might otherwise be overlooked?", needs: "differentiation", persona: "CPO" },
  { id: "BDQ-12", question: "What does AG know and explicitly NOT know?", needs: "limits", persona: "CPO" },
];

/** §7 — control vendors. Ten mandatory, plus shared-position and thin cohorts. */
export const CONTROL_VENDORS = ["ACN", "IBM", "CGEMY", "CTSH", "TTNQY", "INFY", "DXC", "GIB", "DOX", "ATO"] as const;
export const SHARED_POSITION_VENDORS = ["WIT", "HCTHY", "KD", "G", "TECHM"] as const;
export const THIN_EVIDENCE_VENDORS = ["CAYLENT", "PHDATA", "SEARCE", "DATAMATICS", "MASTEK"] as const;

/** Cross-page consistency controls (§15). */
export const CONSISTENCY_CONTROLS = ["ACN", "IBM", "CGEMY", "CTSH", "TTNQY"] as const;

export const ALL_BDQ_VENDORS = [...CONTROL_VENDORS, ...SHARED_POSITION_VENDORS, ...THIN_EVIDENCE_VENDORS];

/** §8 — reusable scopes. Composition documented so a run is reproducible. */
export interface BdqScope {
  id: string;
  label: string;
  mode: "whole_market" | "selected_vendors";
  vendors: string[];
}

export const BDQ_SCOPES: BdqScope[] = [
  { id: "whole", label: "Whole Market", mode: "whole_market", vendors: [] },
  { id: "big5", label: "Big 5", mode: "selected_vendors", vendors: ["ACN", "IBM", "CGEMY", "CTSH", "TTNQY"] },
  { id: "india", label: "India-centric", mode: "selected_vendors", vendors: ["TTNQY", "INFY", "WIT", "HCTHY", "TECHM"] },
  { id: "infra", label: "Infrastructure", mode: "selected_vendors", vendors: ["ACN", "IBM", "DXC", "KD", "ATO"] },
  { id: "bpo", label: "BPO / CX", mode: "selected_vendors", vendors: ["G", "EXLS", "WNS", "TLPFY", "CNXC"] },
  { id: "mixed", label: "Custom mixed", mode: "selected_vendors", vendors: ["BSOFT", "COFORGE", "MPHLY", "PERSISTENT"] },
];

/** Evidence families for the §18 balance diagnostic. */
export const EVIDENCE_FAMILIES: Record<string, RegExp> = {
  "AG signals": /analystgenius|ag signal|ag talent|ag places/i,
  capability: /ai (?:delivery|capability|readiness)|automation capability/i,
  workforce: /talent|headcount|workforce|delivery capacity/i,
  financial: /sec (?:edgar|xbrl)|revenue|margin|cash|financial/i,
  reputation: /reputation|tracker|sentiment|perception/i,
  procurement: /procurement|public award/i,
  "SEC/event": /8-k|filing|filed|termination/i,
  "commercial contracts": /contract tracker|contract market record|curated contract|signings?|end-of-term/i,
  macro: /fred|employment cost|cpi|\bfx\b|inflation/i,
};
