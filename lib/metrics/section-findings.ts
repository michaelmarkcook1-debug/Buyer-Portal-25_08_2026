/**
 * SECTION FINDINGS — the sentence each Market section opens with.
 *
 * The Market tab showed lists and cards and left the buyer to work out what
 * they said. Each section now leads with its finding, computed from exactly
 * the rows it shows, so the prose can never claim more than the evidence
 * beneath it. Deterministic templates only: no model, no invented figures,
 * and no finding at all where the rows cannot support one.
 *
 * Ownership firewall: these describe the external market. They never speak
 * of the reader's contracts, spend or renewals.
 */
import { displayState } from "./dictionary";
import type { Metric, MetricState } from "./types";

export interface SectionFinding {
  finding: string;
  /** One thing worth investigating or challenging, where the finding supports one. */
  action?: string;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

/** "A, B and C" / "A, B, C and 2 more" — names stay readable in a wide market. */
export function nameList(names: string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** Buyer economics: which forces are working for buyers and which against. */
export function economicsFinding(dimensions: readonly Metric[]): SectionFinding | null {
  const assessed = dimensions.filter((m) => m.state !== "insufficient");
  if (assessed.length === 0) return null;
  const forBuyers = assessed.filter((m) => displayState(m.id, m.state).effect === "favourable").map((m) => m.label);
  const against = assessed.filter((m) => displayState(m.id, m.state).effect === "unfavourable").map((m) => m.label);
  if (forBuyers.length === 0 && against.length === 0) {
    return { finding: "No economic force has clearly moved for or against buyers in this market." };
  }
  const parts = [
    forBuyers.length ? `Working in buyers' favour: ${nameList(forBuyers, 4).toLowerCase()}.` : null,
    against.length ? `Working against buyers: ${nameList(against, 4).toLowerCase()}.` : null,
  ].filter(Boolean);
  return {
    finding: parts.join(" "),
    action: forBuyers.length
      ? "Bring the favourable forces into the next commercial discussion; the cards below carry the evidence for each."
      : undefined,
  };
}

/** Service families: where the observed work concentrates. */
export function familyFinding(lines: readonly { line: string; contracts: number; inPlay24: number }[]): SectionFinding | null {
  const total = lines.reduce((a, l) => a + l.contracts, 0);
  if (total === 0) return null;
  const [top, next] = [...lines].sort((a, b) => b.contracts - a.contracts);
  const share = pct(top!.contracts, total);
  return {
    finding:
      `${top!.line} carries the most observed work in this market — ${share}% of classified contracts` +
      (next && next.contracts > 0 ? `, ahead of ${next.line} at ${pct(next.contracts, total)}%` : "") +
      (top!.inPlay24 > 0 ? `. ${top!.inPlay24} of its agreements reach end-of-term inside 24 months.` : "."),
  };
}

/** Geography: where agreements are signed. Never where work is delivered. */
export function geographyFinding(
  rows: readonly { country: string; contracts: number; inPlay12: number }[],
): SectionFinding | null {
  const total = rows.reduce((a, r) => a + r.contracts, 0);
  if (total === 0) return null;
  const [top, next] = [...rows].sort((a, b) => b.contracts - a.contracts);
  const topPct = pct(top!.contracts, total);
  const nextPct = next ? pct(next.contracts, total) : 0;
  /* A dead heat is not a leader: two countries at the same rounded share are
     named together rather than one being called the place "most" signing
     happens. */
  const lead =
    next && nextPct === topPct
      ? `${top!.country} and ${next.country} lead where this market signs — ${topPct}% each of agreements that name a signing country`
      : `${top!.country} leads where this market signs — ${topPct}% of agreements that name a signing country` +
        (next && next.contracts > 0 ? `, then ${next.country} at ${nextPct}%` : "");
  return {
    finding: lead + (top!.inPlay12 > 0 ? `. ${top!.inPlay12} signed in ${top!.country} reach end-of-term within 12 months.` : "."),
  };
}

interface VendorReading {
  name: string;
  metric: Metric;
}

/** AI productivity: where capability should be changing what buyers pay for. */
export function aiProductivityFinding(vendors: readonly VendorReading[]): SectionFinding | null {
  const assessed = vendors.filter((v) => v.metric.state !== "insufficient");
  if (assessed.length === 0) return null;
  const moving = assessed.filter((v) => v.metric.state === "favourable");
  const label = displayState("aiProductivityOpportunity", "favourable").label.toLowerCase();
  if (moving.length === 0) {
    return { finding: `No selected vendor yet reads ${label} for AI productivity opportunity — capability has not moved far enough to reprice effort-based work.` };
  }
  return {
    finding: `AI productivity opportunity reads ${label} at ${moving.length} of ${assessed.length} assessed vendors: ${nameList(moving.map((v) => v.name))}.`,
    action: "Where these vendors price by effort, ask what share of the work is now automated and where that shows in rates.",
  };
}

/** Labour and delivery: whose delivery workforce is contracting. */
export function workforceFinding(vendors: readonly VendorReading[]): SectionFinding | null {
  const assessed = vendors.filter((v) => v.metric.state !== "insufficient");
  if (assessed.length === 0) return null;
  const contracting = assessed.filter((v) => v.metric.state === "unfavourable");
  if (contracting.length === 0) {
    return { finding: `No assessed vendor shows its delivery workforce contracting (${assessed.length} assessed).` };
  }
  return {
    finding: `Delivery workforce is contracting at ${contracting.length} of ${assessed.length} assessed vendors: ${nameList(contracting.map((v) => v.name))}.`,
    action: "Before extending term or scope with them, ask for capacity plans and key-person commitments.",
  };
}

/** Financial position: how the market's financial condition is spread. */
export function financialFinding(vendors: readonly VendorReading[]): SectionFinding | null {
  const assessed = vendors.filter((v) => v.metric.state !== "insufficient");
  if (assessed.length === 0) return null;
  const order: MetricState[] = ["favourable", "stable", "mixed", "unfavourable"];
  const counts = order
    .map((st) => ({ st, n: assessed.filter((v) => v.metric.state === st).length }))
    .filter((c) => c.n > 0);
  const weak = assessed.filter((v) => displayState("financialResilience", v.metric.state).effect === "caution" && v.metric.state === "unfavourable");
  return {
    finding:
      `Financial resilience across ${assessed.length} assessed vendors: ` +
      counts.map((c) => `${c.n} ${displayState("financialResilience", c.st).label.toLowerCase()}`).join(", ") +
      ". Read it as market context — it describes the vendors, not buyer advantage.",
    action: weak.length
      ? `For ${nameList(weak.map((v) => v.name))}, check continuity commitments before signing multi-year terms.`
      : undefined,
  };
}
