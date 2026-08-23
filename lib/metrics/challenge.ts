import type { VendorIntel } from "./types";

/**
 * "What to challenge" — the two or three conversations this vendor's own
 * evidence justifies, ranked by how much the evidence supports them.
 *
 * Every point is a restatement of intelligence already resolved and already
 * shown elsewhere on the page: no new metric, no new opportunity family, no
 * formula, and nothing about the reader's own contracts, spend or renewals.
 * Where the evidence supports nothing, this returns an empty list rather than
 * manufacturing a talking point.
 */

export interface ChallengePoint {
  /** The conversation to have. */
  point: string;
  /** The observation that justifies it — market evidence, never buyer-owned. */
  because: string;
}

const MAX_POINTS = 3;

function movedMaterially(movement: string): boolean {
  return movement === "materially-improving" || movement === "materially-deteriorating";
}

export function challengePoints(focal: VendorIntel, peers: VendorIntel[]): ChallengePoint[] {
  const m = focal.metrics;
  const out: ChallengePoint[] = [];

  // 1. Productivity assumptions, where capability has genuinely moved.
  if (m.aiProductivityOpportunity.state === "favourable" && movedMaterially(m.aiProductivityOpportunity.movement)) {
    out.push({
      point: "Whether productivity assumptions priced into existing commercial structures still hold",
      because: "their AI delivery capability has moved materially over the observed 12 months, and terms agreed before that movement may not reflect it",
    });
  } else if (m.automationOpportunity.state === "favourable") {
    out.push({
      point: "Whether automation of labour-intensive delivery should change the unit economics on offer",
      because: "advanced automation capability sits over a labour-heavy delivery base in the observed record",
    });
  }

  // 2. Delivery capacity — cuts both ways, so say which way it cuts.
  if (m.talentPressure.state === "unfavourable") {
    out.push({
      point: "How delivery capacity will be protected on any multi-year commitment",
      because: "their delivery workforce is contracting on the observed talent record, which is a continuity question before it is a pricing one",
    });
  } else if (m.talentPressure.state === "favourable" && m.buyerLeverage.state === "favourable") {
    out.push({
      point: "Whether stable delivery capacity should translate into firmer commercial terms",
      because: "capacity evidence is steady while the wider commercial backdrop reads favourably for buyers",
    });
  }

  // 3. Commercial structure, tested against what the market record shows.
  const rankedByPricing = peers
    .filter((v) => v.opportunities.pricing.level !== "insufficient")
    .sort((a, b) => levelRank(b.opportunities.pricing.level) - levelRank(a.opportunities.pricing.level));
  const pricingRank = rankedByPricing.findIndex((v) => v.ticker === focal.ticker) + 1;
  if (m.pricingPressure.state === "favourable") {
    out.push({
      point: "Whether current pricing structure survives comparison with the market record",
      because:
        pricingRank > 0 && rankedByPricing.length >= 2
          ? `their own pricing record leans toward the buyer, and they rank ${pricingRank} of ${rankedByPricing.length} on pricing opportunity across your selected market`
          : "their own pricing record leans toward the buyer on the observed evidence",
    });
  } else if (m.financialHeadroom.state === "favourable") {
    out.push({
      point: "Whether their margin position leaves room for commercial flexibility not yet on the table",
      because: "the filed financial position shows observed room to absorb commercial pressure",
    });
  }

  // 4. Fallback: a vendor with a dominant lever but none of the above.
  if (out.length === 0 && focal.overall.level !== "insufficient") {
    const strongest = Object.values(focal.opportunities)
      .filter((o) => o.level !== "insufficient")
      .sort((a, b) => levelRank(b.level) - levelRank(a.level))[0];
    if (strongest) {
      out.push({
        point: `Whether the ${FAMILY_PHRASE[strongest.type] ?? "commercial"} position is being tested at all`,
        because: "it is the strongest lever the observed evidence supports for this vendor",
      });
    }
  }

  return out.slice(0, MAX_POINTS);
}

const FAMILY_PHRASE: Record<string, string> = {
  pricing: "pricing",
  automation: "automation",
  "gain-sharing": "gain-sharing",
  "commercial-leverage": "commercial leverage",
  "market-test": "market-test",
};

function levelRank(level: string): number {
  return ["insufficient", "low", "medium", "high", "very-high"].indexOf(level);
}
