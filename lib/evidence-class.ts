/**
 * EVIDENCE CLASS — what kind of statement each evidence line is.
 *
 * The product grounding requires every item to say whether it is an observed
 * fact, a finding derived from other readings, AnalystGenius's own
 * interpretation, or a modelled value. The metric layer already names each
 * line's SOURCE precisely; the class follows from the source and, for
 * contract values, from whether the line carries estimated value. Derived
 * here from what the line already states, so no resolver has to be rewritten
 * and a new source without a rule falls back to "observed" only when it is
 * not one of the recognised derived or interpretive families.
 */

export type EvidenceClass = "observed" | "derived" | "interpretation" | "modelled" | "mixed";

export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  observed: "Observed",
  derived: "Derived",
  interpretation: "AG interpretation",
  modelled: "Modelled",
  mixed: "Observed + modelled",
};

/** Sources whose lines summarise other readings rather than observing anything. */
const DERIVED = /derived from canonical metrics|canonical vendor snapshots|vendor readings/i;
/** AnalystGenius's own analytical judgements, as opposed to its measurements. */
const INTERPRETATION = /top issues|reputation tracker|claims vs delivery|AG analysis/i;
/** Lines that exist to explain coverage carry no evidence class of their own. */
const UNCLASSED = /^coverage note$/i;

export function evidenceClassOf(b: { text: string; source: string }): EvidenceClass | null {
  if (UNCLASSED.test(b.source.trim())) return null;
  if (DERIVED.test(b.source)) return "derived";
  if (INTERPRETATION.test(b.source)) return "interpretation";
  const estimated = /\b(inferred|estimat(?:e|es|ed)|modelled)\b/i.test(b.text);
  if (estimated) return /\bdisclosed\b/i.test(b.text) ? "mixed" : "modelled";
  return "observed";
}
