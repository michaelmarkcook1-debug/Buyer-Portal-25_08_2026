import type { Metric, MetricAnalysis, MetricState } from "./types";

/**
 * Market-state explanations.
 *
 * The cards already carry STATE (what the variable is doing) and COLOUR (what
 * it means for the buyer). This layer supplies the third thing a sophisticated
 * reader needs: WHY the current reading exists — which vendors drive it, what
 * evidence supports it, and what to check next.
 *
 * Nothing here calculates. Every figure and every vendor name is passed in
 * from the canonical resolved object that the cards, charts, Analyst Insight
 * and signals all read, so an explanation can never disagree with the state it
 * explains. The builders only SELECT drivers and phrase the finding.
 *
 * Scope discipline: at three vendors the explanation names them explicitly; at
 * whole-market scale it names the two or three that materially drive the
 * reading and says how many sit behind them, never implying the list is
 * exhaustive.
 */

/** One vendor's contribution to a market dimension, taken from its own metric. */
export interface VendorReading {
  name: string;
  state: MetricState;
  /**
   * Magnitude used ONLY to rank which vendors best explain the reading.
   * Never rendered — the visible figures come from canonical basis text.
   */
  rank?: number | null;
}

export const readingsFrom = (
  picks: { name: string; metric: Metric }[],
  rank?: (name: string) => number | null,
): VendorReading[] =>
  picks.map((p) => ({ name: p.name, state: p.metric.state, rank: rank ? rank(p.name) : null }));

/** "A", "A and B", "A, B and C" */
export function list(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The vendors that best exemplify `want`, strongest first, capped at `limit`. */
export function drivers(readings: VendorReading[], want: MetricState, limit = 2): VendorReading[] {
  return readings
    .filter((r) => r.state === want)
    .sort((a, b) => Math.abs(b.rank ?? 0) - Math.abs(a.rank ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const names = (rs: VendorReading[]): string => list(rs.map((r) => r.name));
const n = (readings: VendorReading[], want: MetricState) => readings.filter((r) => r.state === want).length;

/**
 * "led by X and Y" for a small market; "concentrated among X and Y, of 14"
 * where more vendors sit behind the named ones. Never implies exhaustiveness.
 */
function among(shown: VendorReading[], total: number): string {
  if (shown.length === 0) return "";
  // Only signal a remainder when one genuinely exists to signal. In a
  // three-vendor market "X and Y among 3" is noise; at whole-market scale
  // "X and Y among 17" is the thing that stops the pair reading as the set.
  return total - shown.length >= 2 ? `${names(shown)} among ${total}` : names(shown);
}

/** Same rule for plain name lists that carry their own totals. */
function amongNames(shown: string[], total: number): string {
  if (shown.length === 0) return "";
  return total - shown.length >= 2 ? `${list(shown)} among ${total}` : list(shown);
}

const assessed = (readings: VendorReading[]) => readings.filter((r) => r.state !== "insufficient").length;

/** Only surfaced when coverage is genuinely partial enough to change the read. */
function coverageLimit(readings: VendorReading[], evidence: string): string | undefined {
  const missing = readings.length - assessed(readings);
  if (missing === 0) return undefined;
  if (missing === readings.length) return `No ${evidence} is held for the selected vendors.`;
  return `${evidence} is not held for ${missing} of ${readings.length} selected vendors, so the market read rests on the remainder.`;
}

function distributionOf(readings: VendorReading[]): string | undefined {
  const f = n(readings, "favourable");
  const u = n(readings, "unfavourable");
  if (f === 0 && u === 0) return undefined;
  return `${f} of ${assessed(readings)} assessed vendors read favourable, ${u} unfavourable.`;
}

/* ────────────────────────── labour economics ──────────────────────────
   Rolls up talent pressure. "Under strain" means workforces are contracting;
   the buyer question is capacity on multi-year commitments, not price.        */

export function labourAnalysis(readings: VendorReading[], state: MetricState): MetricAnalysis | undefined {
  if (assessed(readings) === 0) return undefined;
  const strained = drivers(readings, "unfavourable", 2); // talentPressure: unfavourable = contracting
  const growing = drivers(readings, "favourable", 2);
  const nStrained = n(readings, "unfavourable");
  const nGrowing = n(readings, "favourable");

  let driver: string;
  if (strained.length && growing.length) {
    driver =
      `Delivery workforces are moving in opposite directions: contraction at ${among(strained, nStrained)}, ` +
      `while ${among(growing, nGrowing)} continue to add delivery headcount.`;
  } else if (strained.length) {
    driver =
      `Delivery headcount is contracting across the selected market, sharpest at ${among(strained, nStrained)}. ` +
      `No selected vendor is expanding its delivery base against the trend.`;
  } else if (growing.length) {
    driver =
      `Delivery workforces are expanding across the selected market, led by ${among(growing, nGrowing)}, ` +
      `with no vendor showing material contraction.`;
  } else {
    driver = `Delivery headcount is broadly flat across the selected vendors — neither contraction nor material hiring is visible in the current reading.`;
  }

  const implication =
    state === "unfavourable"
      ? "A contracting delivery base is a capacity question before it is a pricing one: it can weaken a vendor's ability to staff scale-up or transition without touching rate cards."
      : state === "favourable"
        ? "Growing delivery bases reduce near-term capacity risk, but they also weaken any scarcity argument a vendor makes for premium rates."
        : state === "mixed"
          ? "The read is not uniform, so vendor-level capacity evidence should drive the conversation rather than a market-wide staffing assumption."
          : "A stable delivery base neither adds capacity risk nor supports a scarcity argument — staffing is unlikely to be the decisive factor either way.";

  return {
    driver,
    implication,
    evidence: "Talent movement · headcount trend",
    limitation: coverageLimit(readings, "Talent evidence"),
    test:
      state === "unfavourable"
        ? "Are workforce reductions being offset by automation, or are they creating delivery-capacity risk?"
        : state === "favourable"
          ? "Is the added headcount going into the services you buy, or into growth areas elsewhere?"
          : state === "mixed"
            ? "Which side of this divergence are the vendors delivering your services actually on?"
            : "Does the stable headline hide movement in the specific delivery locations serving you?",
    distribution: distributionOf(readings),
  };
}

/* ───────────────────────── supplier economics ─────────────────────────
   Rolls up financial resilience, itself a composite of revenue growth and
   filed operating margin. "Expanding" alone says too little — name which. */

export function supplierAnalysis(readings: VendorReading[], state: MetricState): MetricAnalysis | undefined {
  if (assessed(readings) === 0) return undefined;
  const strong = drivers(readings, "favourable", 2);
  const strained = drivers(readings, "unfavourable", 2);
  const nStrong = n(readings, "favourable");
  const nStrained = n(readings, "unfavourable");

  let driver: string;
  if (strong.length && strained.length) {
    driver =
      `Financial condition is uneven: revenue growth and filed margins are improving at ${among(strong, nStrong)}, ` +
      `while ${among(strained, nStrained)} remain financially constrained on the same measures.`;
  } else if (strong.length) {
    driver =
      `Revenue growth and filed operating margins are both improving across the selected vendors, led by ${among(strong, nStrong)}. ` +
      `None is currently reading as financially constrained.`;
  } else if (strained.length) {
    driver =
      `Revenue growth and filed operating margins are under pressure across the selected market, most clearly at ${among(strained, nStrained)}.`;
  } else {
    driver = `Revenue growth and filed margins are steady across the selected vendors — neither expansion nor strain dominates the current reading.`;
  }

  const implication =
    state === "unfavourable"
      ? "Financial strain cuts both ways: it can increase appetite to defend revenue, but it also raises questions about a vendor's capacity to fund transformation or absorb transition cost."
      : "A financially strong supplier has room to fund delivery investment and equally less need to concede on price — read this alongside buyer leverage rather than as an advantage in itself.";

  return {
    driver,
    implication,
    evidence: "Revenue growth · filed operating margin (SEC XBRL where listed)",
    limitation: coverageLimit(readings, "Financial evidence"),
    test:
      state === "unfavourable"
        ? "Is financial pressure showing up as reduced delivery investment on the accounts you run?"
        : "Are stronger margins being reinvested in delivery capability, or retained?",
    distribution: distributionOf(readings),
  };
}

/* ───────────────────────── services demand ─────────────────────────────
   Commercial signings across the canonical rolling windows, with public
   procurement kept as a separate, shorter-cycle measure.                  */

export interface DemandInputs {
  /**
   * Which series set the state. The canonical rule prefers fresh public
   * procurement where it has volume and falls back to commercial signings;
   * the explanation must lead with the SAME series, or the card would explain
   * a movement its own state did not come from.
   */
  ledBy: "procurement" | "commercial";
  t12: number;
  prior12: number;
  vendorsT12: number;
  /** Per-vendor signing counts, for concentration and counter-trend. */
  perVendor: { name: string; t12: number; prior12: number }[];
  /** Per-vendor public award counts across the same 90-day windows. */
  procPerVendor: { name: string; t90: number; prior90: number }[];
  procT90: number | null;
  procPrior90: number | null;
  asOf: string;
  procAsOf: string | null;
}

export function demandAnalysis(d: DemandInputs, state: MetricState): MetricAnalysis | undefined {
  const movers = (rows: { name: string; cur: number; prev: number }[]) => {
    const moved = rows.filter((v) => v.cur !== v.prev);
    return {
      down: [...moved].filter((v) => v.cur < v.prev).sort((a, b) => (a.cur - a.prev) - (b.cur - b.prev)),
      up: [...moved].filter((v) => v.cur > v.prev).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev)),
    };
  };

  const leadRows =
    d.ledBy === "procurement"
      ? d.procPerVendor.map((v) => ({ name: v.name, cur: v.t90, prev: v.prior90 }))
      : d.perVendor.map((v) => ({ name: v.name, cur: v.t12, prev: v.prior12 }));
  const { down, up } = movers(leadRows);
  const shownDown = down.slice(0, 2).map((v) => v.name);
  const shownUp = up.slice(0, 2).map((v) => v.name);

  const cur = d.ledBy === "procurement" ? d.procT90 ?? 0 : d.t12;
  const prev = d.ledBy === "procurement" ? d.procPrior90 ?? 0 : d.prior12;
  const what = d.ledBy === "procurement" ? "Public awards to the selected vendors" : "Commercial signings";
  const window = d.ledBy === "procurement" ? "in the trailing 90 days against the prior 90" : "across the rolling 12-month windows";

  let driver: string;
  if (state === "unfavourable") {
    driver =
      `${what} fell to ${cur} from ${prev} ${window}` +
      (shownDown.length ? `, with the decline concentrated at ${amongNames(shownDown, down.length)}` : " across the selected market") +
      (shownUp.length ? `; ${amongNames(shownUp, up.length)} moved against the trend.` : ".");
  } else if (state === "favourable") {
    driver =
      `${what} rose to ${cur} from ${prev} ${window}` +
      (shownUp.length ? `, led by ${amongNames(shownUp, up.length)}` : " across the selected market") +
      (shownDown.length ? `; ${amongNames(shownDown, down.length)} moved against the trend.` : ".");
  } else {
    driver =
      `${what} are broadly flat at ${cur} against ${prev} ${window}` +
      (shownDown.length && shownUp.length
        ? `, with softer activity at ${amongNames(shownDown, down.length)} offset by ${amongNames(shownUp, up.length)}.`
        : " across the selected market.");
  }

  /* The other series is context, never the headline — and the two windows are
     never blended, which is what kept them lexically distinct in the registry. */
  const context =
    d.ledBy === "procurement"
      ? ` Curated commercial signings ran ${d.t12} against ${d.prior12} over the rolling 12 months.`
      : d.procT90 != null && d.procPrior90 != null
        ? ` Public procurement, a shorter and fresher cycle, ran ${d.procT90} awards against ${d.procPrior90} prior.`
        : "";

  const implication =
    state === "unfavourable"
      ? "Softer demand can raise a vendor's appetite to defend existing revenue, which strengthens the case for testing commercial assumptions — but only where vendor-specific evidence corroborates it."
      : state === "favourable"
        ? "Rising demand tends to reduce a vendor's need to concede, so price-led arguments are likely to land less well than scope or commercial-model ones."
        : "Flat demand supports neither a pressure narrative nor a scarcity one; leverage is more likely to come from renewal timing than from market conditions.";

  return {
    driver: driver + context,
    implication,
    evidence:
      d.ledBy === "procurement"
        ? `Public procurement, trailing 90 days${d.procAsOf ? ` to ${d.procAsOf}` : ""} · commercial signings to ${d.asOf}`
        : `Commercial signings to ${d.asOf}`,
    limitation:
      d.ledBy === "procurement"
        ? "The state follows the fresher public-award cycle; that record is public-sector only and moves on smaller numbers than the commercial spine."
        : undefined,
    test: "Is weaker signing activity translating into greater commercial flexibility, or only into slower decisions?",
  };
}

/* ───────────────────────── operational risk ────────────────────────────
   Says WHAT KIND of risk is observed and who drives it. Where evidence is
   genuinely thin, states what is known and why it is not enough.          */

export interface RiskInputs {
  readings: VendorReading[];
  /** Observed issue topics per vendor, already published in the metric basis. */
  topics: { name: string; titles: string[]; cyber: number; restructuring: number }[];
}

export function riskAnalysis(r: RiskInputs, state: MetricState, confidence: string): MetricAnalysis | undefined {
  if (assessed(r.readings) === 0) return undefined;
  const elevated = drivers(r.readings, "unfavourable", 2);
  const watch = drivers(r.readings, "mixed", 2);
  const nElevated = n(r.readings, "unfavourable");
  const nWatch = n(r.readings, "mixed");
  const lead = elevated.length ? elevated : watch;
  const leadCount = elevated.length ? nElevated : nWatch;

  const named = new Set(lead.map((x) => x.name));
  const topics = r.topics
    .filter((t) => named.has(t.name))
    .flatMap((t) => t.titles)
    .slice(0, 2);
  const cyber = r.topics.filter((t) => named.has(t.name) && t.cyber > 0).map((t) => t.name);
  const restructuring = r.topics.filter((t) => named.has(t.name) && t.restructuring > 0).map((t) => t.name);
  /* The event vendors are usually the same ones just named as the lead —
     repeating them reads as a stutter ("elevated at X, driven by ... at X"). */
  const sameAsLead = (who: string[]) =>
    who.length === lead.length && who.every((w) => named.has(w));

  let driver: string;
  if (lead.length === 0) {
    driver = `No selected vendor is carrying elevated operational risk on the current record; the reading rests on routine issue tracking rather than any specific event.`;
  } else if (cyber.length > 0) {
    driver = `Risk reads elevated mainly at ${among(lead, leadCount)}, driven by a disclosed material cybersecurity incident${sameAsLead(cyber) ? "" : ` at ${list(cyber)}`}.`;
  } else if (restructuring.length > 0) {
    driver = `Risk reads elevated mainly at ${among(lead, leadCount)}, driven by disclosed exit or restructuring cost${sameAsLead(restructuring) ? "" : ` at ${list(restructuring)}`}.`;
  } else if (topics.length > 0) {
    driver = `Risk reads elevated mainly at ${among(lead, leadCount)}, driven by observed issues around ${list(topics.map((t) => t.replace(/[.]$/, "").toLowerCase()))}.`;
  } else {
    /* §8: where evidence is genuinely thin, say what IS known and why it is
       not enough — that is more useful to a buyer than "evidence is thin". */
    driver =
      `Risk reads elevated at ${among(lead, leadCount)} on the issue-tracking read alone. ` +
      `No disclosed incident, restructuring event or named issue sits behind it, so the reading flags where to look rather than what has gone wrong.`;
  }

  const implication =
    state === "unfavourable"
      ? "Where risk is concentrated rather than market-wide, it supports scrutiny of delivery resilience at the named vendors before relying on price leverage elsewhere."
      : "This is a watch condition rather than a market-wide deterioration — it warrants monitoring at the named vendors, not a change of posture across the market.";

  return {
    driver,
    implication,
    evidence: "Issue tracking · 8-K event disclosures where filed",
    limitation:
      assessed(r.readings) < r.readings.length
        ? `Risk evidence is held for ${assessed(r.readings)} of ${r.readings.length} selected vendors, so this is not a market-wide read.`
        : confidence === "low"
          ? "The underlying issue analysis is marked stale upstream, so treat this as a prompt to look rather than a current finding."
          : undefined,
    test: "Are these issues contained to the named vendors, or symptomatic of the delivery model across the market?",
    distribution: undefined,
  };
}

/* ─────────────────────── competitive intensity ─────────────────────────
   How many scoped vendors are actively winning, against the prior window. */

export function intensityAnalysis(
  vendorsT12: number,
  vendorsPrior12: number,
  total: number,
  state: MetricState,
): MetricAnalysis {
  const driver =
    state === "favourable"
      ? `Work is spreading across more of the selected market: ${vendorsT12} of ${total} vendors won observed work in the current window, against ${vendorsPrior12} in the prior one.`
      : state === "unfavourable"
        ? `Winning is concentrating into fewer hands: ${vendorsT12} of ${total} vendors won observed work in the current window, down from ${vendorsPrior12} prior.`
        : `The spread of winners is unchanged at ${vendorsT12} of ${total} vendors, so no vendor has gained or lost ground in the observed record.`;

  const implication =
    state === "favourable"
      ? "More vendors winning work means more credible alternatives to bring to the table, which is the practical basis for competitive tension."
      : state === "unfavourable"
        ? "Fewer active winners narrows the field of credible alternatives, which weakens a market-test argument even where pricing conditions look favourable."
        : "A static field neither strengthens nor weakens a market-test case; alternatives need testing on capability rather than on recent win activity.";

  return {
    driver,
    implication,
    evidence: "Curated contract record · scoped vendors only",
    limitation: "It counts which vendors win, not what they charge or how large the work is.",
    test: "Do the vendors winning work actually cover the lines of service you buy?",
  };
}

/* ──────────────────────── AI productivity pressure ─────────────────────
   Rolls up per-vendor AI productivity opportunity.                        */

export function aiPressureAnalysis(readings: VendorReading[], state: MetricState): MetricAnalysis | undefined {
  if (assessed(readings) === 0) return undefined;
  const advanced = drivers(readings, "favourable", 2);
  const nAdvanced = n(readings, "favourable");
  const flat = drivers(readings, "unfavourable", 2);

  const driver =
    advanced.length && flat.length
      ? `AI delivery capability has advanced materially at ${among(advanced, nAdvanced)}, while ${names(flat)} shows little substantiated movement — the market is not moving as one.`
      : advanced.length
        ? `AI delivery capability has advanced materially across the selected market, most clearly at ${among(advanced, nAdvanced)}.`
        : `No selected vendor shows substantiated AI capability movement large enough to challenge existing productivity assumptions.`;

  const implication =
    state === "favourable"
      ? "Where capability has moved, productivity assumptions priced into existing commercial terms are the thing to re-test — not the vendor's headline AI narrative."
      : "Without substantiated capability movement, AI-based productivity claims are not yet supported by the delivery record.";

  return {
    driver,
    implication,
    evidence: "Substantiated AI capability events · delivery evidence",
    limitation: coverageLimit(readings, "AI capability evidence"),
    test: "Has capability actually reached the services you buy, or only the vendor's showcase accounts?",
    distribution: distributionOf(readings),
  };
}

/* ───────────────────────── pricing conditions ─────────────────────────── */

export function pricingAnalysis(readings: VendorReading[], state: MetricState): MetricAnalysis | undefined {
  if (assessed(readings) === 0) return undefined;
  const buyerSide = drivers(readings, "favourable", 2);
  const vendorSide = drivers(readings, "unfavourable", 2);
  const nBuyer = n(readings, "favourable");
  const nVendor = n(readings, "unfavourable");

  const driver =
    buyerSide.length && vendorSide.length
      ? `Observed pricing evidence leans to the buyer at ${among(buyerSide, nBuyer)} but toward the vendor at ${among(vendorSide, nVendor)} — the market does not lean one way.`
      : buyerSide.length
        ? `Observed pricing evidence leans toward the buyer across the selected market, most clearly at ${among(buyerSide, nBuyer)}.`
        : vendorSide.length
          ? `Observed pricing evidence leans toward the vendor across the selected market, most clearly at ${among(vendorSide, nVendor)}.`
          : `Observed pricing evidence is balanced across the selected vendors, with no side holding a clear advantage in the record.`;

  const implication =
    state === "favourable"
      ? "This is a direction in the observed record, not a discount: it supports opening a commercial conversation, not a target rate."
      : state === "unfavourable"
        ? "Conditions currently favour the vendor, so a price-led approach is likely to meet resistance; commercial model or scope may be the better lever."
        : "With conditions balanced, vendor-specific evidence rather than market direction should set the commercial approach.";

  return {
    driver,
    implication,
    evidence: "Observed commercial terms · pricing-model mix",
    limitation: "It is a direction of travel in the market record, never a rate benchmark and never a claim about your own pricing.",
    test: "Does the observed direction hold in the specific service lines you buy?",
    distribution: distributionOf(readings),
  };
}

/* ─────────────────── generic rollup dimensions ─────────────────────────
   Buyer leverage, automation, commercial opportunity and market heat all
   roll a per-vendor metric to market level in the same shape, so they share
   one builder and differ only in wording. Keeping them here means the band
   and the Market grid explain them identically.                            */

export interface RollupCopy {
  /** Sentence stems, completed with the driver vendors. */
  favLead: string;
  unfLead: string;
  splitLead: string;
  flatLead: string;
  /** Verb phrases used on each side of a split reading (plural form). */
  favWord: string;
  unfWord: string;
  /** Singular forms, used when exactly one vendor is named on that side. */
  favWordOne: string;
  unfWordOne: string;
  implication: Partial<Record<MetricState, string>>;
  evidence: string;
  test: string;
  limitation?: string;
  /** Distribution is noise on dimensions a buyer reads as one number. */
  showDistribution?: boolean;
}

export function rollupAnalysis(
  readings: VendorReading[],
  state: MetricState,
  copy: RollupCopy,
): MetricAnalysis | undefined {
  if (assessed(readings) === 0) return undefined;
  const fav = drivers(readings, "favourable", 2);
  const unf = drivers(readings, "unfavourable", 2);
  const nFav = n(readings, "favourable");
  const nUnf = n(readings, "unfavourable");

  // A single named vendor takes a singular verb; "TCS are winning" reads wrong.
  const favVerb = fav.length === 1 && nFav === 1 ? copy.favWordOne : copy.favWord;
  const unfVerb = unf.length === 1 && nUnf === 1 ? copy.unfWordOne : copy.unfWord;
  const driver =
    fav.length && unf.length
      ? `${copy.splitLead}: ${among(fav, nFav)} ${favVerb}, while ${among(unf, nUnf)} ${unfVerb}.`
      : fav.length
        ? `${copy.favLead}, led by ${among(fav, nFav)}.`
        : unf.length
          ? `${copy.unfLead}, most clearly at ${among(unf, nUnf)}.`
          : copy.flatLead;

  return {
    driver,
    implication: copy.implication[state] ?? copy.implication.mixed ?? "",
    evidence: copy.evidence,
    limitation: copy.limitation,
    test: copy.test,
    distribution: copy.showDistribution ? distributionOf(readings) : undefined,
  };
}

export const BUYER_LEVERAGE_COPY: RollupCopy = {
  favLead: "Renewal and decision points are open across the selected market",
  unfLead: "Little of the selected market reaches a decision point soon",
  splitLead: "Leverage is concentrated rather than market-wide",
  flatLead: "No selected vendor currently sits in a materially open or closed decision window.",
  favWord: "carry near-term decision points",
  favWordOne: "carries near-term decision points",
  unfWord: "have little coming up to negotiate against",
  unfWordOne: "has little coming up to negotiate against",
  implication: {
    favourable: "Leverage here comes from timing rather than from vendor weakness — the practical move is to sequence conversations around the open windows.",
    unfavourable: "Without near-term decision points, commercial conversations lack a natural trigger; value is more likely to come from scope or service-model change than from renegotiation.",
    mixed: "Leverage is not evenly distributed, so a market-wide negotiating posture will overreach at some vendors and underreach at others.",
    stable: "Positions are steady, so timing is unlikely to be the lever that moves a commercial conversation this cycle.",
  },
  evidence: "Observed end-of-term concentration · competitive alternatives",
  limitation: "It reads the observed market record, not your own contracts or renewal rights.",
  test: "Do the open decision points sit on the services that matter most to you?",
};

export const AUTOMATION_COPY: RollupCopy = {
  favLead: "Automation capability is running ahead of how the work is still delivered",
  unfLead: "Automation capability is not yet ahead of the delivery model",
  splitLead: "Automation readiness splits the market",
  flatLead: "No selected vendor shows an automation position materially ahead of its delivery model.",
  favWord: "show capability ahead of a labour-heavy base",
  favWordOne: "shows capability ahead of a labour-heavy base",
  unfWord: "show no such gap",
  unfWordOne: "shows no such gap",
  implication: {
    favourable: "Where capability outruns the delivery model, the unit-economics assumption behind existing pricing is the thing to re-test.",
    unfavourable: "Without a visible capability-to-delivery gap, automation is not currently a basis for challenging unit economics.",
    mixed: "The gap exists at some vendors and not others, so this is a vendor-level argument rather than a market-wide one.",
    stable: "Automation positions are steady across the market and unlikely to shift commercial assumptions this cycle.",
  },
  evidence: "Automation capability evidence · delivery labour intensity",
  test: "Has automation reached the delivery lines you buy, or only the vendor's showcase work?",
};

export const COMMERCIAL_COPY: RollupCopy = {
  favLead: "Several commercial opportunity families point the same way across the market",
  unfLead: "Commercial opportunity is limited across the selected market",
  splitLead: "Commercial opportunity is uneven",
  flatLead: "Commercial opportunity reads moderate across the selected vendors, with no vendor standing clearly apart.",
  favWord: "carry a broad-based commercial case",
  favWordOne: "carries a broad-based commercial case",
  unfWord: "offer little the evidence currently supports",
  unfWordOne: "offers little the evidence currently supports",
  implication: {
    favourable: "A broad-based reading means the case does not rest on one family alone — it is a reason to open the conversation, never a savings estimate.",
    unfavourable: "With thin support across families, commercial effort is better spent on the vendors and levers where evidence actually concentrates.",
    mixed: "Opportunity concentrates at particular vendors, which is where to start rather than running a market-wide programme.",
    stable: "Opportunity is evenly moderate, so prioritisation should follow your own spend and risk rather than market signal.",
  },
  evidence: "Opportunity families across the selected vendors",
  test: "Which of these families do your current agreements actually leave room to act on?",
};

export const HEAT_COPY: RollupCopy = {
  favLead: "Demand conditions have cooled across the selected market",
  unfLead: "Demand conditions are heating across the selected market",
  splitLead: "Demand conditions differ sharply by vendor",
  flatLead: "Demand conditions are balanced across the selected vendors.",
  favWord: "are winning less than before",
  favWordOne: "is winning less than before",
  unfWord: "are winning more",
  unfWordOne: "is winning more",
  implication: {
    favourable: "A cooler market moves demand pressure toward the buyer, which tends to widen a vendor's appetite to protect existing revenue.",
    unfavourable: "A heating market reduces a vendor's need to concede; scope and commercial model are likely to move further than price.",
    mixed: "Conditions are vendor-specific rather than market-wide, so a single negotiating narrative will not hold across the set.",
    stable: "Balanced conditions favour neither side, so leverage will have to come from something other than market temperature.",
  },
  evidence: "Public award flow · trailing 90 days against the prior 90",
  limitation: "Public awards are a fresher but narrower read than the commercial record.",
  test: "Is the cooling visible in the segments you buy, or only in public-sector work?",
};
