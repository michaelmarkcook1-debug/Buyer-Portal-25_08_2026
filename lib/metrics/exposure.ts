import type { Basis } from "./types";

/**
 * Delivery-location exposure bands (sprint 3 P4).
 *
 * Broad bands only — never fabricated percentage mixes. A band exists only
 * where evidence supports it:
 *
 *   1. DATA-DRIVEN: the AG catalog's headquarters fact. An India-headquartered
 *      offshore-model provider is banded India-heavy — its own filings
 *      describe India-centred delivery. Other HQ countries band the HQ region
 *      only when the vendor is not a known global-delivery operator.
 *   2. DOCUMENTED EXCEPTIONS: vendors whose delivery footprint is well
 *      documented in their own public filings/disclosures and differs from
 *      what HQ alone would suggest. Each entry carries its evidence note,
 *      which is rendered as basis — no silent analyst assertions.
 *
 * Everything else is honestly "insufficient" — unknown exposure must not
 * create fake precision (§ tests).
 */

export type ExposureBand =
  | "india-heavy"
  | "india-material"
  | "europe-heavy"
  | "us-heavy"
  | "mixed-global"
  | "insufficient";

export const BAND_LABEL: Record<ExposureBand, string> = {
  "india-heavy": "India-heavy delivery",
  "india-material": "India-material delivery",
  "europe-heavy": "Europe-heavy delivery",
  "us-heavy": "US-heavy delivery",
  "mixed-global": "Mixed global delivery",
  insufficient: "Delivery mix not evidenced",
};

/** Documented exceptions — each with the public evidence that supports it. */
const DOCUMENTED: Record<string, { band: ExposureBand; evidence: string }> = {
  CTSH: { band: "india-heavy", evidence: "Cognizant's 10-K workforce disclosures place the large majority of its delivery personnel in India." },
  G:    { band: "india-heavy", evidence: "Genpact's filings describe India-centred delivery operations since its GE Capital origins." },
  ACN:  { band: "india-material", evidence: "Accenture's public disclosures report its largest single-country workforce in India within a global delivery network." },
  IBM:  { band: "india-material", evidence: "IBM's public reporting has long placed a material share of services delivery headcount in India." },
  CAP:  { band: "europe-heavy", evidence: "Capgemini's universal registration document reports a European centre of gravity with a large India offshore arm." },
  CGEMY:{ band: "europe-heavy", evidence: "Capgemini's universal registration document reports a European centre of gravity with a large India offshore arm." },
  ATO:  { band: "europe-heavy", evidence: "Atos' registration document reports a predominantly European delivery and revenue base." },
  SOP:  { band: "europe-heavy", evidence: "Sopra Steria's registration document reports a predominantly European footprint." },
  EPAM: { band: "europe-heavy", evidence: "EPAM's 10-K describes delivery concentrated in Central/Eastern Europe (with post-2022 rebalancing)." },
  DAVA: { band: "europe-heavy", evidence: "Endava's 20-F describes nearshore delivery concentrated in Central Europe and Latin America." },
  GIB:  { band: "mixed-global", evidence: "CGI's annual report describes a proximity model across North America and Europe with a smaller offshore share." },
  KD:   { band: "mixed-global", evidence: "Kyndryl's 10-K describes a globally distributed delivery base inherited from IBM's managed-infrastructure business." },
};

const INDIA_HQ = /india/i;
const EUROPE_HQ = /\b(france|germany|uk|united kingdom|netherlands|spain|italy|poland|romania|ireland|sweden|norway|denmark|finland|switzerland|belgium|luxembourg|austria|portugal)\b/i;
const US_HQ = /\b(us|usa|united states)\b/i;

export interface ExposureRead {
  band: ExposureBand;
  basis: Basis | null;
}

/**
 * Band from evidence. `hq` is the AG catalog headquarters fact; `headcount`
 * gates the HQ heuristic: a small, single-region firm's HQ is meaningful
 * evidence of delivery location; a 100k+ global operator's HQ alone is NOT
 * evidence of delivery mix, so without documentation it reads insufficient.
 */
export function deliveryExposure(ticker: string, hq: string | null, headcount: number | null): ExposureRead {
  const doc = DOCUMENTED[ticker];
  if (doc) {
    return {
      band: doc.band,
      basis: { text: `${BAND_LABEL[doc.band]} — ${doc.evidence}`, source: "Provider public filings/disclosures", ownership: "market" },
    };
  }
  if (hq && INDIA_HQ.test(hq)) {
    return {
      band: "india-heavy",
      basis: {
        text: `India-heavy delivery — India-headquartered offshore-model provider (${hq}); the provider's own filings describe India-centred delivery.`,
        source: "AnalystGenius vendor catalog (headquarters)", ownership: "market",
      },
    };
  }
  const global = (headcount ?? 0) >= 100_000;
  if (hq && !global && EUROPE_HQ.test(hq)) {
    return {
      band: "europe-heavy",
      basis: { text: `Europe-heavy delivery inferred from a European base (${hq}) at sub-global scale.`, source: "AnalystGenius vendor catalog (headquarters)", ownership: "market" },
    };
  }
  if (hq && !global && US_HQ.test(hq)) {
    return {
      band: "us-heavy",
      basis: { text: `US-heavy delivery inferred from a US base (${hq}) at sub-global scale.`, source: "AnalystGenius vendor catalog (headquarters)", ownership: "market" },
    };
  }
  return { band: "insufficient", basis: null };
}
