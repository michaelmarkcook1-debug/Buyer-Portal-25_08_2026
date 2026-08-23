import Link from "next/link";
import { Panel } from "@/components/ui";
import type { VendorIntel } from "@/lib/metrics/types";

/**
 * Curated entry points for a large market (§13/§14).
 *
 * At Whole Market scale a 66-row table is a data dump, not a briefing. These
 * lenses surface the vendors worth attention first, using readings the portal
 * already resolves — no new taxonomy, no new metric, no new route. The full
 * universe stays one disclosure away.
 *
 * A lens with nothing to show is omitted rather than padded.
 */

interface Lens {
  title: string;
  hint: string;
  rows: Array<{ ticker: string; name: string; note: string }>;
}

function buildLenses(vendors: VendorIntel[]): Lens[] {
  const byOpportunity = vendors
    .filter((v) => v.overall.level === "very-high" || v.overall.level === "high")
    .slice(0, 5)
    .map((v) => ({ ticker: v.ticker, name: v.name, note: v.overall.reason ?? "" }));

  const movers = vendors
    .filter((v) => {
      const m = v.metrics.providerMomentum.movement;
      return m === "materially-improving" || m === "materially-deteriorating";
    })
    .slice(0, 5)
    .map((v) => ({
      ticker: v.ticker,
      name: v.name,
      note:
        v.metrics.providerMomentum.movement === "materially-improving"
          ? "Commercial momentum strengthening"
          : "Commercial momentum weakening — demand pressure moving toward the buyer",
    }));

  const risks = vendors
    .filter((v) => v.metrics.talentPressure.state === "unfavourable" || v.metrics.operationalRisk.state === "unfavourable")
    .slice(0, 5)
    .map((v) => ({
      ticker: v.ticker,
      name: v.name,
      note:
        v.metrics.talentPressure.state === "unfavourable"
          ? "Delivery workforce contracting — capacity question on multi-year commitments"
          : "Operational risk reading is unfavourable",
    }));

  const gainShare = vendors
    .filter((v) => v.opportunities["gain-sharing"].level === "very-high")
    .slice(0, 5)
    .map((v) => ({ ticker: v.ticker, name: v.name, note: "Productivity gains may not yet be priced into commercial terms" }));

  return [
    { title: "Strongest commercial opportunity", hint: "Where buyer value concentrates", rows: byOpportunity },
    { title: "Biggest movers", hint: "Where the position changed most", rows: movers },
    { title: "Highest delivery risk", hint: "Where capacity deserves scrutiny", rows: risks },
    { title: "Strongest gain-sharing case", hint: "Where productivity is outpacing commercial terms", rows: gainShare },
  ].filter((l) => l.rows.length > 0);
}

export function WholeMarketLenses({ vendors }: { vendors: VendorIntel[] }) {
  const lenses = buildLenses(vendors);
  if (lenses.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {lenses.map((lens) => (
        <Panel key={lens.title} className="px-5 py-4">
          <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
            {lens.title}
          </div>
          <p className="mt-1 mb-0 text-[0.78rem]" style={{ color: "var(--fg-dim)" }}>
            {lens.hint}
          </p>
          <ul className="mt-3 mb-0 list-none space-y-2.5 pl-0">
            {lens.rows.map((r) => (
              <li key={r.ticker}>
                <Link
                  href={`/vendors/${r.ticker.toLowerCase()}`}
                  className="font-medium underline-offset-4 hover:underline"
                  style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                >
                  {r.name}
                </Link>
                <span className="ml-2 text-[0.8rem]" style={{ color: "var(--fg-muted)" }}>
                  {r.note}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
