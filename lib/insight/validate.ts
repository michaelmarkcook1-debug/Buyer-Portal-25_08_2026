/**
 * Grounding firewall for Analyst Insight (spec §24) — portal-owned validation
 * at the prompt/context boundary.
 *
 * The hard rule: a model asked to write about money will eventually produce a
 * plausible figure no source contains. Prompting against it is not a control;
 * comparing every numeric token in the output against the supplied context is.
 * A violation BLOCKS the insight — the surface renders the refusal state, and
 * never silently repairs or substitutes.
 */

/**
 * Version of the validation ruleset. Part of the insight cache key, so any
 * rule change invalidates every previously cached insight — an insight
 * validated by an older ruleset can never be served again (sprint 3 fix 1).
 * Bump on EVERY rule change.
 */
export const VALIDATOR_VERSION = 3;

export interface InsightValidation {
  ok: boolean;
  text: string;
  blocked: string[];
  warnings: string[];
}

/** Money, plain numbers, percentages, magnitudes: "$2.4M", "47", "3.0", "12%", "14.2bn". */
const NUMERIC = /\$?\d[\d,]*(?:\.\d+)?\s*(?:bn|billion|million|[bmk]\b|%)?/gi;

function normalise(token: string): string {
  return token
    .toLowerCase()
    .replace(/[$,\s]/g, "")
    .replace(/billion$/, "bn")
    .replace(/million$/, "m");
}

/** Every number the context asserts, plus suffix-stripped variants. */
export function allowedNumbers(contextJson: string): Set<string> {
  const allowed = new Set<string>();
  for (const m of contextJson.match(NUMERIC) ?? []) {
    const norm = normalise(m);
    allowed.add(norm);
    allowed.add(norm.replace(/(bn|m|k|%)$/, ""));
  }
  return allowed;
}

const BANNED_PHRASES = [
  "remain agile",
  "monitor the evolving landscape",
  "navigate uncertainty",
  "leverage emerging opportunities",
];

/* ── ownership firewall (correction pass 2026-08-21) ─────────────────────────
   The reader has provided ONLY a vendor selection. Every contract-level
   observation in the portal is market/public evidence about agreements between
   the vendors and OTHER organisations. Prose that converts a market fact into
   buyer ownership — "your contract", "your renewal", "your spend" — is a
   truth violation and BLOCKS the output. Buyer-LEVEL readings ("your market",
   "your position", "buyer leverage is strong") remain legitimate. */

/** Contract-ownership nouns that must never follow a second-person possessive. */
const OWNED_NOUN =
  "(?:contract|contracts|renewal|renewals|commitment|commitments|spend|spending|rate|rates|rate\\s?card|pricing|savings|agreement|agreements|exposure|exposures|book|deal|deals|sow|sows|statements?\\s+of\\s+work|invoice|invoices|incumbent|incumbents|estate|wallet|portfolio)";

/** Buyer-level nouns a second-person possessive MAY own (spec correction §6). */
const ALLOWED_YOUR = new Set([
  "market", "markets", "position", "leverage", "scope", "selection", "selections",
  "shortlist", "advantage", "briefing", "side", "organisation", "organization",
  "selected", "tracked", "negotiating", "buying", "vendor", "vendors", "team", "sourcing",
]);

const OWNERSHIP_BLOCKERS: Array<{ re: RegExp; message: string }> = [
  // ── completeness hardening: observed market data is a partial dataset,
  //    never a vendor's authoritative "book"/"portfolio"/"commitments". ──
  {
    re: /\b(?:their|its|the vendor'?s?)\s+(?:own\s+)?(?:[\w$.,%-]+\s+){0,3}?(?:book|portfolio)\b/i,
    message: "observed market contracts are described as a vendor's complete “book/portfolio” — the dataset is partial market observation",
  },
  {
    re: /\b[A-Z][\w&.-]*['’]s\s+(?:own\s+)?(?:[\w$.,%-]+\s+){0,3}?(?:book|portfolio)\b/,
    message: "observed market contracts are described as a named vendor's “book/portfolio” — the dataset is partial market observation",
  },
  {
    re: /\bthe\s+(?:\w+\s+){0,1}?(?:expiring|renewal|contract)\s+(?:book|portfolio)\b/i,
    message: "observed market contracts are described as a complete “book/portfolio” — the dataset is partial market observation",
  },
  {
    // Possessive-less variants too: "defending large expiring books",
    // "starved order books" — no complete book of any kind is held.
    re: /\b(?:expiring|renewal|contract|order)\s+(?:books?|portfolios?)\b/i,
    message: "observed market contracts are described as vendors' “books/portfolios” — the dataset is partial market observation",
  },
  {
    // The whole variant class (v3): in this domain a plural "books" — with ANY
    // modifier ("renewal-heavy books") — means vendors' contract/order books,
    // which the partial dataset can never substantiate. "book-to-bill" (a
    // published financial ratio) remains legal; "book of business" does not.
    re: /\bbooks\b|\bbook\s+of\s+business\b/i,
    message: "vendors' “books” are asserted — the dataset is partial market observation, never a vendor's complete book",
  },
  {
    re: /\b(?:total|vendor|their|its)\s+commitments\b/i,
    message: "observed market contracts are described as authoritative vendor commitments",
  },
  // ── window hardening: market renewal dates never establish the READER's
  //    negotiating window — their contract dates are unknown. ──
  {
    re: /\b(?:negotiating|negotiation)\s+window\s+(?:is|now|stands)\s+(?:wide\s+)?open\b/i,
    message: "market renewal timing is converted into an open negotiating window for the reader",
  },
  {
    // Positive assertions that a window EXISTS ("this is a genuine negotiating
    // window") — the reader's contract dates are unknown, so no window can be
    // asserted, only the market backdrop described.
    re: /\b(?:is|represents|creates?|opens?|offers?)\s+a\s+(?:\w+\s+){0,2}?(?:negotiating|negotiation)\s+window\b/i,
    message: "a negotiating window is asserted to exist — market timing never establishes the reader's window; describe the commercial backdrop instead",
  },
  {
    re: /\byour\s+(?:negotiating|negotiation|renewal)\s+(?:window|timing|deadline)\b/i,
    message: "a buyer-specific negotiation window/timing is asserted without buyer-owned contract data",
  },
  {
    re: /\b(?:renegotiate|act)\s+now\b/i,
    message: "the reader is instructed to act now on market-observed timing",
  },
  {
    re: new RegExp(`\\byour\\s+(?:own\\s+)?(?:\\w+\\s+){0,2}?${OWNED_NOUN}\\b`, "i"),
    message: "a market/public contract observation is described with buyer-ownership language (“your …”)",
  },
  {
    re: /\byour\s+\$?\d/i,
    message: "a figure is attributed to the reader (“your $…”) — no buyer-owned values are held",
  },
  {
    re: new RegExp(`\\byou(?:r team)?\\s+(?:currently\\s+)?(?:have|hold|own|owe)\\s+(?:\\w+\\s+){0,3}?${OWNED_NOUN}\\b`, "i"),
    message: "the reader is asserted to hold contracts/commitments the portal does not know about",
  },
  {
    re: /\byou\s+(?:are\s+)?(?:pay|pays|paying|spend|spends|spending|signed|renew|renewing)\b/i,
    message: "the reader's payments, spend or signings are asserted — none are held",
  },
];

/* ── completeness firewall (Sprint 2 §10): absence in OUR dataset is never
      absence in THE MARKET. Dataset-scoped phrasing is required. ── */
const COMPLETENESS_BLOCKERS: Array<{ re: RegExp; message: string }> = [
  {
    re: /\b(?:the\s+)?(?:market|industry)\s+has\s+no\b/i,
    message: "dataset absence is asserted as market-wide absence — say “none identified in the observed dataset”",
  },
  {
    re: /\bno[^.;!?]{0,40}\bexists?\s+in\s+the\s+(?:market|industry)\b/i,
    message: "dataset absence is asserted as market-wide absence — say “none identified in the observed dataset”",
  },
  {
    re: /\bnowhere\s+in\s+the\s+(?:market|industry)\b/i,
    message: "dataset absence is asserted as market-wide absence",
  },
];

/** Buyer-directed timing keyed to a market contract date, without market framing. */
const TIMED_IMPERATIVE =
  /\b(?:press|approach|renegotiate|challenge|act|move|engage)\b[^.;!?]{0,60}\b(?:before|by|ahead of)\b[^.;!?]{0,40}\b(?:renewal|expiry|end-of-term|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i;
/** Reader-directed "…now" urgency on renewal/pricing timing (sprint 2 tightening). */
const URGENT_NOW =
  /\b(?:press|pressure-test|renegotiate|challenge|move|engage|push|act)\b[^.;!?]{0,60}\bnow\b/i;
const TIMING_TOPIC = /\b(?:renewal|expiry|end-of-term|window|pricing|rates?)\b/i;
const MARKET_FRAMING = /\b(?:observed|market|comparable|buyers?\s+with|public record)\b/i;

export function validateOwnership(text: string): { blocked: string[]; warnings: string[] } {
  const blocked: string[] = [];
  const warnings: string[] = [];

  for (const rule of OWNERSHIP_BLOCKERS) {
    const m = text.match(rule.re);
    if (m) blocked.push(`Ownership violation: ${rule.message} (“${m[0].trim()}”).`);
  }

  for (const rule of COMPLETENESS_BLOCKERS) {
    const m = text.match(rule.re);
    if (m) blocked.push(`Completeness violation: ${rule.message} (“${m[0].trim()}”).`);
  }

  // Sentence-wise: advice timed to a renewal/expiry must carry market framing.
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const m = sentence.match(TIMED_IMPERATIVE);
    if (m && !MARKET_FRAMING.test(sentence)) {
      blocked.push(
        `Ownership violation: buyer-directed timing is keyed to a market contract date without market framing (“${m[0].trim()}”).`,
      );
    }
    const u = sentence.match(URGENT_NOW);
    if (u && TIMING_TOPIC.test(sentence) && !MARKET_FRAMING.test(sentence)) {
      blocked.push(
        `Ownership violation: reader-directed “now” urgency on renewal/pricing timing without market framing (“${u[0].trim()}”).`,
      );
    }
  }

  // Unrecognised "your <noun>" — not blocked, but surfaced for review.
  for (const m of text.matchAll(/\byour\s+([a-z][a-z-]*)\b/gi)) {
    const noun = m[1].toLowerCase();
    if (!ALLOWED_YOUR.has(noun) && !new RegExp(`^${OWNED_NOUN}$`, "i").test(noun)) {
      warnings.push(`Ownership review: “your ${noun}” is outside the allowed buyer-level vocabulary.`);
    }
  }

  return { blocked, warnings };
}

const WORD_CAP = 200;

export function validateInsight(text: string, contextJson: string): InsightValidation {
  const blocked: string[] = [];
  const warnings: string[] = [];
  let out = text.trim();

  /* Numeric firewall. */
  const allowed = allowedNumbers(contextJson);
  const offenders = (out.match(NUMERIC) ?? [])
    .map(normalise)
    .filter((tok) => tok.length > 0 && !allowed.has(tok) && !allowed.has(tok.replace(/(bn|m|k|%)$/, "")));
  if (offenders.length > 0) {
    blocked.push(
      `Generated insight states figure(s) absent from the supplied context: ${[...new Set(offenders)].join(", ")}. ` +
        "The model may interpret canonical intelligence; it may not produce arithmetic.",
    );
  }

  /* Word cap — trim to the last full sentence under the cap. */
  const words = out.split(/\s+/);
  if (words.length > WORD_CAP) {
    const capped = words.slice(0, WORD_CAP).join(" ");
    const lastStop = Math.max(capped.lastIndexOf(". "), capped.lastIndexOf(".\n"), capped.endsWith(".") ? capped.length - 1 : -1);
    out = lastStop > 40 ? capped.slice(0, lastStop + 1) : capped;
    warnings.push(`Insight exceeded ${WORD_CAP} words and was trimmed at a sentence boundary.`);
  }

  /* Generic-consultancy phrases — warn (spec §8). */
  const lower = out.toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (lower.includes(p)) warnings.push(`Contains a proscribed generic phrase: “${p}”.`);
  }

  /* Ownership firewall — market evidence must never become buyer-owned language. */
  const ownership = validateOwnership(out);
  blocked.push(...ownership.blocked);
  warnings.push(...ownership.warnings);

  return { ok: blocked.length === 0, text: out, blocked, warnings };
}
