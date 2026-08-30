/**
 * BDQ detectors — PURE functions over plain shapes.
 *
 * Nothing here reads a file, opens a socket or touches the database, so the
 * same detector that grades a live resolve can be driven by a fixture in a
 * unit test. That is what makes the mutation suite possible: each detector is
 * handed a deliberately broken finding and must fail on it.
 *
 * Detectors judge STRUCTURE, never wording, and never a figure. "$7.3bn" and
 * "146 → 12" both move with the data; whether a finding still carries a
 * source, a date and something to challenge does not.
 */

import { EVIDENCE_FAMILIES } from "./spec.ts";

export type Status = "pass" | "fail" | "review" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  detail: string;
  offenders: string[];
}

export interface BdqBasis {
  text: string;
  source?: string;
  asOf?: string | null;
  ownership?: string;
}

export interface BdqAnalysis {
  driver?: string;
  implication?: string;
  limitation?: string;
  test?: string;
  evidence?: string;
}

/** One resolved reading, flattened out of MarketIntel by the runner. */
export interface BdqFinding {
  id: string;
  surface: string;
  label: string;
  state?: string;
  movement?: string;
  headline?: string | null;
  analysis?: BdqAnalysis | null;
  basis: BdqBasis[];
  confidence?: string;
  /** True where the reading itself declares insufficiency. */
  insufficient?: boolean;
}

export interface BdqAction {
  vendor: string;
  text: string;
  because?: string;
}

export interface BdqSignal {
  classification: string;
  headline: string;
  implication: string;
  date?: string | null;
  sourceUrl?: string | null;
  vendors: string[];
}

const bad = (id: string, title: string, detail: string, offenders: string[]): CheckResult =>
  ({ id, title, status: offenders.length ? "fail" : "pass", detail, offenders: offenders.slice(0, 12) });
const rev = (id: string, title: string, detail: string, offenders: string[]): CheckResult =>
  ({ id, title, status: offenders.length ? "review" : "pass", detail, offenders: offenders.slice(0, 12) });

/* ─────────────────────────── ownership firewall ─────────────────────────── */

const OWNERSHIP = /\byour (contract|contracts|spend|rate|rates|saving|savings|renewal|renewals|supplier performance|pricing)\b/gi;
/** An explicit denial is the firewall working, not breaching. */
const DISCLAIMER =
  /\b(not|never|no|none|does not|doesn't|do not|is not|are not|holds no|hold none|nothing here|market evidence only|rather than|without buyer-owned|no claim)\b/i;

export function ownershipFirewall(texts: { id: string; text: string }[]): CheckResult {
  const offenders: string[] = [];
  for (const { id, text } of texts) {
    for (const m of text.matchAll(OWNERSHIP)) {
      const window = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 120);
      if (!DISCLAIMER.test(window)) offenders.push(`${id}: …${window.slice(-130).replace(/\s+/g, " ").trim()}`);
    }
  }
  return bad("ownership", "Ownership firewall", "no unsupported claim about the reader's own commercials", offenders);
}

/* ──────────────────────── proprietary score firewall ────────────────────── */

/**
 * Internal scales only. A disclosed market quantity may legitimately contain
 * digits ("$7.3bn", "17 agreements", "+3.1% YoY"), so these patterns match a
 * SCALE being published, never the presence of a number.
 */
const SCORES: [RegExp, string][] = [
  [/\b\d{1,3}\s*\/\s*100\b/, "N/100 scale"],
  [/\b(?:ag\s+)?risk score\b/i, "risk score"],
  [/\bai[- ]readiness score\b/i, "AI-readiness score"],
  [/\bsentiment score\b/i, "sentiment score"],
  [/\binternal (?:rating|weighting|index)\b/i, "internal rating/weighting"],
  [/\bconfidence index\b/i, "confidence index"],
  [/\bscored \d+(?:\.\d+)?\s*(?:out of|\/)/i, "explicit score-out-of"],
];

export function scoreFirewall(texts: { id: string; text: string }[]): CheckResult {
  const offenders: string[] = [];
  for (const { id, text } of texts) {
    for (const [re, name] of SCORES) {
      const m = re.exec(text);
      if (m) offenders.push(`${id}: ${name} — "${text.slice(Math.max(0, m.index - 60), m.index + 70).replace(/\s+/g, " ").trim()}"`);
    }
  }
  return bad("scores", "Proprietary score firewall", "no internal scale reaches buyer-facing output", offenders);
}

/* ──────────────────────────── provenance / trust ────────────────────────── */

export function provenancePresent(findings: BdqFinding[]): CheckResult {
  const offenders = findings
    .filter((f) => !f.insufficient && f.basis.length > 0 && !f.basis.some((b) => b.source && b.source.trim().length > 2))
    .map((f) => `${f.id} (${f.label}) — basis carries no source`);
  return bad("provenance", "Provenance present", "every asserted finding names a source family", offenders);
}

export function datePresent(findings: BdqFinding[], spineAsOf: string | null): CheckResult {
  if (!spineAsOf) {
    return { id: "dates", title: "Evidence dating", status: "fail", detail: "spine carries no data-as-of", offenders: ["intel.spine.dataAsOf is null"] };
  }
  /* A date must be REACHABLE, not stored in one particular field. The metric
     layer keeps the source family in analysis.evidence ("Talent movement ·
     headcount trend") and the date in basis[].asOf or in the driver prose
     ("in the trailing 90 days", "to 19 May 2026"). Requiring the date inside
     analysis.evidence tested the wrong field and failed a product that dates
     its evidence correctly. */
  const DATED = /\b(19|20)\d{2}\b|\b\d{1,2}\s\w{3,9}\s(19|20)\d{2}\b|trailing|rolling|prior (?:window|period|90|12)|\bwindow\b|\bYoY\b|as of|to \d/i;
  const undated = findings
    .filter((f) => !f.insufficient && f.analysis)
    .filter((f) => {
      const fromBasis = f.basis.some((b) => b.asOf && String(b.asOf).trim().length > 3);
      /* The window is frequently carried by the basis LINE the reader sees
         ("31 vendors won work in the current window vs 36 in the prior",
         "0% (2022) → 0% (2026)"), not by a structured asOf. Scan everything
         the buyer can actually read. */
      const fromText = DATED.test(
        [f.analysis!.evidence ?? "", f.analysis!.driver ?? "", ...f.basis.map((b) => b.text)].join(" "),
      );
      return !fromBasis && !fromText;
    });

  /* A ROLLUP counts other readings ("29 of 51 assessed vendors favourable")
     and carries no observation date of its own; the readings beneath it are
     dated, and the page states the evidence window in the masthead and the
     provenance table. Whether that page-level dating is enough for a summary
     is a judgement, so an undated rollup is raised for REVIEW.
     A PRIMARY finding asserting a change with no date anywhere is a failure —
     there the reader has nothing to reach for. */
  const isRollup = (f: BdqFinding) => f.basis.every((b) => /derived from canonical metrics/i.test(b.source ?? ""));
  const rollups = undated.filter(isRollup);
  const primaries = undated.filter((f) => !isRollup(f));

  if (primaries.length) {
    return bad("dates", "Evidence dating", "a date or window is reachable for every primary finding",
      primaries.map((f) => `${f.id} — primary finding, no date reachable`));
  }
  return rev("dates", "Evidence dating", `${findings.length} findings checked; ${rollups.length} undated rollups`,
    rollups.map((f) => `${f.id} (${f.label}) — rollup of dated readings, undated itself; page carries the window`));
}

/* ─────────────────────────── freshness semantics ────────────────────────── */

export function freshnessSemantics(spine: { lastIngest: string; dataAsOf: string | null; dataAgeDays: number | null }): CheckResult {
  const offenders: string[] = [];
  if (!spine.dataAsOf) offenders.push("no data-as-of — evidence date cannot be distinguished from ingest");
  if (spine.dataAsOf && spine.dataAsOf === spine.lastIngest && (spine.dataAgeDays ?? 0) === 0) {
    offenders.push("data-as-of equals last ingest — refresh time may be standing in for evidence date");
  }
  if (spine.dataAsOf && spine.dataAgeDays == null) offenders.push("data-as-of present but its age is not carried");
  return bad("freshness", "Freshness semantics", "evidence date is held separately from ingest time", offenders);
}

/* ────────────────────────────── action quality ──────────────────────────── */

/** Forms that name no object of challenge. Deliberately short — a detector
    overfitted to today's wording stops catching tomorrow's hollow phrasing. */
const HOLLOW = [
  /^\s*monitor\b/i,
  /^\s*review the situation/i,
  /^\s*consider (?:this|the) (?:provider|vendor|supplier)\b/i,
  /^\s*keep (?:an eye|watching)/i,
  /^\s*stay (?:close|aware)/i,
  /^\s*watch (?:this|the) (?:space|vendor|provider)\b/i,
];
/**
 * A usable challenge points at something. Matched on STEMS across the whole
 * commercial vocabulary rather than a whitelist of today's phrasing — an
 * earlier narrow list flagged "…now automatable on their platform" and
 * "staffing assumptions in agreements priced before these changes", both of
 * which name a perfectly concrete object. The blacklist above is the real
 * detector; this is a floor against genuinely contentless text.
 */
const OBJECT =
  /\b(pric|rate|term|capacit|headcount|workforce|staff|gain[- ]shar|automat|productivit|renewal|end-of-term|commit|margin|continuit|deliver|commercial|structur|assumption|exposure|leverag|position|unit economics|process|platform|agreement|alternativ|market test|scope|scoped|contract|resourc|servic|SLA|volume|discount|benchmark)/i;

export function actionQuality(actions: BdqAction[]): CheckResult {
  const offenders: string[] = [];
  for (const a of actions) {
    const t = a.text.trim();
    if (!t) { offenders.push(`${a.vendor}: empty challenge`); continue; }
    if (HOLLOW.some((h) => h.test(t))) { offenders.push(`${a.vendor}: hollow form — "${t.slice(0, 90)}"`); continue; }
    if (!OBJECT.test(t)) offenders.push(`${a.vendor}: names no object of challenge — "${t.slice(0, 90)}"`);
  }
  return bad("actions", "Buyer action quality", "every challenge names something specific to press on", offenders);
}

export function actionExists(vendors: { ticker: string; actions: number; insufficient: boolean }[]): CheckResult {
  // A vendor with genuinely thin evidence is allowed to offer nothing.
  const offenders = vendors
    .filter((v) => !v.insufficient && v.actions === 0)
    .map((v) => `${v.ticker} — no challenge offered despite sufficient evidence`);
  return bad("action-exists", "Buyer action exists", "every sufficiently-evidenced vendor offers a challenge", offenders);
}

/* ──────────────────────── four-question chain ───────────────────────────── */

export function fourQuestionChain(findings: BdqFinding[]): CheckResult {
  const withAnalysis = findings.filter((f) => f.analysis);
  const offenders: string[] = [];
  for (const f of withAnalysis) {
    const a = f.analysis!;
    const missing: string[] = [];
    if (!a.driver?.trim()) missing.push("WHAT CHANGED");
    if (!a.implication?.trim()) missing.push("WHY IT MATTERS");
    if (!a.test?.trim()) missing.push("WHAT TO CHALLENGE");
    if (!a.evidence?.trim()) missing.push("EVIDENCE");
    if (missing.length) offenders.push(`${f.id} (${f.label}) — missing ${missing.join(", ")}`);
  }
  return bad("chain", "Four-question chain", `${withAnalysis.length} analytical findings carry the full chain`, offenders);
}

/* ───────────────────────── structural hygiene ───────────────────────────── */

export function emptyHeadline(findings: BdqFinding[]): CheckResult {
  const offenders = findings
    .filter((f) => f.headline !== undefined && f.headline !== null && f.headline.trim().length === 0)
    .map((f) => `${f.id} — headline present but empty`);
  return bad("headline", "No empty headline", "no finding renders a blank headline", offenders);
}

/** A finding whose whole content is a filing form number tells a buyer nothing. */
const FORM_ONLY = /^\s*(?:8-K|10-K|10-Q|6-K|20-F|S-1|SEC filing|Form \d+-?[A-Z]?)\s*\.?\s*$/i;

export function rawFormNumberFinding(findings: BdqFinding[]): CheckResult {
  const offenders = findings
    .filter((f) => FORM_ONLY.test(f.headline ?? "") || FORM_ONLY.test(f.analysis?.driver ?? ""))
    .map((f) => `${f.id} — finding is a bare filing form number`);
  return bad("form-number", "No raw form-number finding", "no finding is only a filing form number", offenders);
}

/** An ACT signal must carry a consequence, not just a filing title. */
export function contentlessAct(signals: BdqSignal[]): CheckResult {
  const acts = signals.filter((s) => s.classification === "ACT");
  const offenders = acts
    .filter((s) => !s.implication?.trim() || s.implication.trim().length < 25 || FORM_ONLY.test(s.headline))
    .map((s) => `ACT "${s.headline.slice(0, 70)}" — no buyer consequence stated`);
  return bad("act-content", "ACT items carry consequence", `${acts.length} ACT signals reviewed`, offenders);
}

/** Levels from different opportunity families must not be presented as one
    ranked ladder without naming the family they rank within. */
export function crossCategoryRanking(rows: { label: string; family?: string }[]): CheckResult {
  const offenders = rows.filter((r) => !r.family || !r.family.trim()).map((r) => `${r.label} — ranked without naming its family`);
  return bad("ranking", "No cross-category pseudo-ranking", "ranked rows name the family they rank within", offenders);
}

/* ───────────────────── honest insufficiency is allowed ──────────────────── */

export function honestInsufficiency(findings: BdqFinding[]): CheckResult {
  const thin = findings.filter((f) => f.insufficient);
  // Absence of a strong finding is never itself a failure. What IS a failure
  // is a thin reading that quietly asserts a conclusion anyway.
  const offenders = thin
    .filter((f) => /\b(will|guarantees?|proves?|confirms?|demonstrates?)\b/i.test(f.analysis?.implication ?? ""))
    .map((f) => `${f.id} — insufficient evidence but asserts a conclusion`);
  return bad("insufficiency", "Honest insufficiency preserved", `${thin.length} readings declare insufficiency without over-claiming`, offenders);
}

/* ───────────────────────── evidence-family balance ──────────────────────── */

export function evidenceBalance(findings: BdqFinding[]): { result: CheckResult; distribution: Record<string, number> } {
  const dist: Record<string, number> = {};
  for (const k of Object.keys(EVIDENCE_FAMILIES)) dist[k] = 0;
  let total = 0;
  for (const f of findings) {
    for (const b of f.basis) {
      const hay = `${b.source ?? ""} ${b.text}`;
      for (const [fam, re] of Object.entries(EVIDENCE_FAMILIES)) {
        if (re.test(hay)) { dist[fam]!++; total++; }
      }
    }
  }
  const contractShare = total > 0 ? (dist["commercial contracts"] ?? 0) / total : 0;
  // Diagnostic, not a gate — reported so drift toward a contract database
  // with commentary becomes visible before it becomes structural.
  const result: CheckResult = {
    id: "balance",
    title: "AG / contract evidence balance",
    status: "pass",
    detail: `${total} basis attributions · commercial contracts ${(contractShare * 100).toFixed(1)}%`,
    offenders: [],
  };
  return { result, distribution: dist };
}

/* ─────────────────────── cross-page consistency ─────────────────────────── */

/**
 * A contradiction is the SAME metric on the SAME vendor resolving to
 * incompatible states. Different lenses reaching different conclusions about
 * different variables is the product working, not a fault.
 */
export function crossPageConsistency(
  readings: { vendor: string; metric: string; surface: string; state: string }[],
): CheckResult {
  const byKey = new Map<string, Map<string, string[]>>();
  for (const r of readings) {
    const k = `${r.vendor}.${r.metric}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const m = byKey.get(k)!;
    if (!m.has(r.state)) m.set(r.state, []);
    m.get(r.state)!.push(r.surface);
  }
  const offenders: string[] = [];
  for (const [k, states] of byKey) {
    if (states.size > 1) {
      const parts = [...states.entries()].map(([s, surf]) => `${s} on ${surf.join("/")}`);
      offenders.push(`${k} — ${parts.join(" vs ")}`);
    }
  }
  return bad("consistency", "Cross-page consistency", `${byKey.size} vendor/metric pairs compared across surfaces`, offenders);
}

/* ──────────────────────── Top Issues supporting-only ────────────────────── */

export function topIssuesSupportingOnly(items: { title: string; sourceUrl?: string | null; promoted: boolean }[]): CheckResult {
  const offenders = items
    .filter((i) => i.promoted && !i.sourceUrl)
    .map((i) => `"${i.title.slice(0, 70)}" — unsourced issue promoted to an established finding`);
  return bad("top-issues", "Top Issues supporting-only", `${items.length} issues reviewed`, offenders);
}

/* ─────────────────────────── headline classing ──────────────────────────── */

export type HeadlineClass = "EXECUTIVE-SCANNABLE" | "LONG BUT USABLE" | "REVIEW — EXTREME LENGTH" | "MISSING";

export function classifyHeadline(h: string | null | undefined): HeadlineClass {
  if (h === null || h === undefined || !h.trim()) return "MISSING";
  const n = h.trim().length;
  if (n <= 200) return "EXECUTIVE-SCANNABLE";
  if (n <= 300) return "LONG BUT USABLE";
  return "REVIEW — EXTREME LENGTH";
}

export function headlineQuality(items: { id: string; headline: string | null | undefined }[]): CheckResult {
  const missing = items.filter((i) => classifyHeadline(i.headline) === "MISSING").map((i) => `${i.id} — no headline`);
  if (missing.length) return bad("headlines", "Headline present", "every briefing renders a headline", missing);
  // Length alone is never a hard failure — it is raised for human judgement.
  const extreme = items
    .filter((i) => classifyHeadline(i.headline) === "REVIEW — EXTREME LENGTH")
    .map((i) => `${i.id} — ${i.headline!.trim().length} ch`);
  return rev("headlines", "Headline quality", `${items.length} headlines classified`, extreme);
}

/* ────────────────────── seven-point insight standard ────────────────────── */

export interface InsightScore {
  id: string;
  judgement: 0 | 1;
  multiSignal: 0 | 1;
  whyItMatters: 0 | 1;
  buyerImplication: 0 | 1;
  action: 0 | 1;
  evidenceBound: 0 | 1;
  nonGeneric: 0 | 1;
  total: number;
  families: number;
}

const JUDGEMENT = /dominant|stands? apart|diverge|is dominated by|differentiator|distinguishing|outlier|defined right now|signal is|sets? .{0,20}apart/i;
const CONNECTIVE = /\bwhich\b|\bbecause\b|meaning|leaving|rather than|\byet\b|\bwhile\b|even as|against|\bbut\b/gi;
const BUYER = /buyer|leverage|negotiat|commercial terms|pricing|concede|renegotiat|\bterms\b/i;
const ACTION = /challenge|test|probe|press|verify|question|substantiate|should/i;
const DATED = /20\d\d|trailing|rolling|YoY|observed|filed|prior (?:window|period|90|12)/i;

export function scoreInsight(id: string, text: string): InsightScore {
  const families = Object.values(EVIDENCE_FAMILIES).filter((re) => re.test(text)).length;
  const judgement = (JUDGEMENT.test(text) ? 1 : 0) as 0 | 1;
  const multiSignal = (families >= 3 ? 1 : 0) as 0 | 1;
  const whyItMatters = ((text.match(CONNECTIVE) ?? []).length >= 3 ? 1 : 0) as 0 | 1;
  const buyerImplication = (BUYER.test(text) ? 1 : 0) as 0 | 1;
  const action = (ACTION.test(text) ? 1 : 0) as 0 | 1;
  const evidenceBound = (/\d/.test(text) && DATED.test(text) ? 1 : 0) as 0 | 1;
  const nonGeneric = ((text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? []).length >= 4 && /\d/.test(text) ? 1 : 0) as 0 | 1;
  const total = judgement + multiSignal + whyItMatters + buyerImplication + action + evidenceBound + nonGeneric;
  return { id, judgement, multiSignal, whyItMatters, buyerImplication, action, evidenceBound, nonGeneric, total, families };
}

/* ─────────────── movement-colour polarity (locked by 072596c) ───────────── */

/**
 * Buyer effect must stay a property of the VARIABLE. Handed the effect each
 * variable assigns to the same raw direction, this fails when they collapse
 * into one answer — the signature of colour being derived from the direction
 * word again rather than from canonical buyer effect.
 */
export function movementPolarity(
  down: { metric: string; effect: string }[],
  controls: { label: string; got: string; want: string }[],
): CheckResult {
  const offenders = controls.filter((c) => c.got !== c.want).map((c) => `${c.label}: expected ${c.want}, got ${c.got}`);
  if (new Set(down.map((d) => d.effect)).size < 2) {
    offenders.push(
      `every variable now maps "deteriorating" to "${down[0]?.effect ?? "?"}" — buyer effect has collapsed into raw direction`,
    );
  }
  return { id: "polarity", title: "Movement polarity", status: offenders.length ? "fail" : "pass", detail: "buyer effect stays variable-specific", offenders };
}
