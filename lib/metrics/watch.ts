import "server-only";
import { getDevelopments, type Development } from "@/lib/data/facts";
import { money, shortDate, signed } from "@/lib/format";
import type { MarketIntel, WatchSignal } from "./types";

/**
 * ACT / WATCH / KNOW — the only classifications (spec §26). Maximum five.
 *
 * Deterministic rules over dated, citable events and canonical states. The
 * implication text is templated from the event's SEC-defined semantics or the
 * metric's real facts — never generated, never speculative.
 */

export const SEC_MEANING: Record<string, { headline: string; implication: string; cls: "ACT" | "WATCH" | "KNOW" }> = {
  "1.02": {
    headline: "Terminated a material agreement",
    implication: "A material contract loss changes their commercial posture — a basis for buyers to pressure-test continuity and pricing appetite.",
    cls: "ACT",
  },
  "1.05": {
    headline: "Disclosed a material cybersecurity incident",
    implication: "Disclosure-grade third-party risk — buyers using this vendor should review exposure and remediation commitments.",
    cls: "ACT",
  },
  "1.01": {
    headline: "Entered a material agreement",
    implication: "A major new commitment can absorb delivery capacity — buyers of this vendor should probe staffing assurances on their accounts.",
    cls: "WATCH",
  },
  "5.02": {
    headline: "Officer or director change",
    implication: "Leadership change at the vendor — sponsorship and escalation paths above buyer accounts may shift.",
    cls: "WATCH",
  },
  "2.05": {
    headline: "Disclosed exit or disposal costs",
    implication: "Restructuring under way — delivery teams serving buyer accounts may be affected.",
    cls: "WATCH",
  },
  "2.02": {
    headline: "Reported results of operations",
    implication: "Fresh financial context for their commercial position.",
    cls: "KNOW",
  },
  "8.01": {
    headline: "Disclosed a material event",
    implication: "The company judged this material enough to file — context worth holding.",
    cls: "KNOW",
  },
};

const CLASS_RANK = { ACT: 0, WATCH: 1, KNOW: 2 } as const;

export async function buildWatchSignals(intel: MarketIntel, tickersKey: string): Promise<WatchSignal[]> {
  const devs = await getDevelopments(tickersKey, 40);
  const nameOf = new Map(intel.vendors.map((v) => [v.ticker, v.name]));
  const signals: WatchSignal[] = [];

  /* 1 — dated, citable events (SEC filings; large awards). */
  const recent = (d: Development, days: number) => {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    return d.date >= cutoff && d.date <= today;
  };

  for (const d of devs) {
    if (d.kind === "filing" && d.itemCode && SEC_MEANING[d.itemCode]) {
      const m = SEC_MEANING[d.itemCode];
      const withinWindow = m.cls === "ACT" ? recent(d, 120) : m.cls === "WATCH" ? recent(d, 60) : recent(d, 30);
      if (!withinWindow) continue;
      signals.push({
        classification: m.cls,
        tickers: [d.ticker],
        vendors: [nameOf.get(d.ticker) ?? d.vendor],
        headline: `${nameOf.get(d.ticker) ?? d.vendor}: ${m.headline}`,
        implication: m.implication,
        opportunityType: d.itemCode === "1.02" ? "commercial-leverage" : null,
        change: `Filed ${shortDate(d.date)}`,
        confidence: "high", // a regulatory filing on a stated date
        date: d.date,
        sourceUrl: d.sourceUrl,
      });
    }
    if (d.kind === "award" && d.tcvUsd != null && d.tcvUsd >= 100_000_000 && recent(d, 180)) {
      signals.push({
        classification: "WATCH",
        tickers: [d.ticker],
        vendors: [nameOf.get(d.ticker) ?? d.vendor],
        headline: `${nameOf.get(d.ticker) ?? d.vendor} signed ${money(d.tcvUsd)}${d.detail ? ` in ${d.detail}` : ""}`,
        implication: "A win of this size shifts observed contract activity and their reference position — relevant to any live evaluation.",
        opportunityType: "market-test",
        change: `Signed ${shortDate(d.date)}`,
        confidence: "high",
        date: d.date,
        sourceUrl: d.sourceUrl,
      });
    }
  }

  /* 2 — canonical-state signals (decision windows, talent, gain-share). */
  for (const v of intel.vendors) {
    const lev = v.metrics.buyerLeverage;
    if (lev.state === "favourable" && v.coverage.inPlay12 > 0) {
      signals.push({
        classification: "ACT",
        tickers: [v.ticker],
        vendors: [v.name],
        headline: `${v.name}: observed renewal activity concentrating`,
        implication:
          (lev.basis[0]?.text ?? "Observed agreements reach end-of-term within 12 months.") +
          " Their defensive exposure strengthens the position of buyers with comparable agreements.",
        opportunityType: "commercial-leverage",
        change: lev.basis.find((b) => b.text.startsWith("Nearest"))?.text ?? null,
        confidence: lev.confidence,
        date: null,
        sourceUrl: null,
      });
    }
    const talent = v.metrics.talentPressure;
    if (talent.state === "unfavourable") {
      signals.push({
        classification: "WATCH",
        tickers: [v.ticker],
        vendors: [v.name],
        headline: `${v.name}: delivery workforce contracting`,
        implication:
          "A multi-year commitment buys this delivery workforce — capacity strain is decision-relevant for buyers of this vendor.",
        opportunityType: "gain-sharing",
        change: talent.basis[0]?.text ?? null,
        confidence: talent.confidence,
        date: talent.asOf,
        sourceUrl: null,
      });
    }
    const gain = v.metrics.gainShareOpportunity;
    if (gain.state === "favourable") {
      signals.push({
        classification: "KNOW",
        tickers: [v.ticker],
        vendors: [v.name],
        headline: `${v.name}: productivity economics have moved`,
        implication: gain.headline ?? "Capability is rising while labour dependency falls.",
        opportunityType: "gain-sharing",
        change: null,
        confidence: gain.confidence,
        date: gain.asOf,
        sourceUrl: null,
      });
    }
    if (v.claimsVsDelivery?.headline && v.claimsVsDelivery.direction) {
      signals.push({
        classification: "KNOW",
        tickers: [v.ticker],
        vendors: [v.name],
        headline: `${v.name}: claims vs delivery — ${v.claimsVsDelivery.direction.replace(/-/g, " ")}`,
        implication: v.claimsVsDelivery.headline,
        opportunityType: null,
        change: v.claimsVsDelivery.asOf ? `AG analysis as of ${shortDate(v.claimsVsDelivery.asOf)}` : null,
        confidence: "medium",
        date: v.claimsVsDelivery.asOf,
        sourceUrl: null,
      });
    }
  }

  /* Rank: ACT first, then recency, then confidence. One signal per (class, vendor). */
  const seen = new Set<string>();
  const deduped = signals.filter((s) => {
    const k = `${s.classification}:${s.tickers.join(",")}:${s.headline}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort((a, b) => {
    const c = CLASS_RANK[a.classification] - CLASS_RANK[b.classification];
    if (c !== 0) return c;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });

  /* Max five (spec §10), at most two per vendor so one vendor cannot flood the list. */
  const perVendor = new Map<string, number>();
  const out: WatchSignal[] = [];
  for (const s of deduped) {
    const k = s.tickers.join(",");
    if ((perVendor.get(k) ?? 0) >= 2) continue;
    out.push(s);
    perVendor.set(k, (perVendor.get(k) ?? 0) + 1);
    if (out.length === 5) break;
  }
  return out;
}
