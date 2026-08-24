import Link from "next/link";
import { COLOUR_KEY, InfoTip, type InfoContent } from "@/components/InfoTip";
import { Panel } from "@/components/ui";
import { count, signed } from "@/lib/format";
import type { VendorIntel } from "@/lib/metrics/types";

/**
 * 12-month change comparison. Extracted so the curated default and the full
 * covered universe render from ONE definition — the Whole Market view shows
 * movers first and keeps every remaining vendor one disclosure away, without
 * a second copy of this markup drifting out of step.
 *
 * Sorting is the caller's: rows render in the order given, which is the
 * portal-wide "greatest buyer opportunity first".
 */

export interface RetrospectiveDeltas {
  aiReadinessDelta?: number | null;
  netFlowDelta?: number | null;
  gapScoreDelta?: number | null;
}

export interface RetrospectiveDeals {
  awardsT12: number;
  awardsPrior12: number;
}

/* Change dimensions carry their own explanation: a bare "Claims-vs-delivery Δ"
   header tells a buyer nothing, and these are movements over a window rather
   than the levels described in the metric dictionary. */
const CHANGE_COLOUR =
  "Teal marks movement that improves the buyer's position over the window; red marks movement against it. A flat reading is stated in words, not colour.";

const DIMENSIONS: { key: string; heading: string; info: InfoContent }[] = [
  {
    key: "ai",
    heading: "AI readiness Δ",
    info: {
      name: "AI readiness change",
      definition: "The change in how much substantiated AI delivery capability this vendor has shown over the window.",
      interpretation:
        "A rise means the vendor has demonstrably built capability — productivity assumptions priced in earlier deserve re-testing.",
      caveat: "It measures evidence of capability, not the price you are charged for it.",
      window: "Movement across the observed 12 months.",
      colour: CHANGE_COLOUR,
    },
  },
  {
    key: "flow",
    heading: "Net talent flow Δ",
    info: {
      name: "Net talent flow change",
      definition: "The change in the vendor's delivery headcount direction — joiners against leavers.",
      interpretation: "A fall means the delivery workforce is contracting faster than before — a continuity question on long commitments.",
      caveat: "Workforce direction is not a statement about the quality of delivery you receive.",
      window: "Movement across the observed 12 months.",
      colour: CHANGE_COLOUR,
    },
  },
  {
    key: "gap",
    heading: "Claims-vs-delivery Δ",
    info: {
      name: "Claims-versus-delivery change",
      definition:
        "The change in the distance between what the vendor says it can do and what its delivery evidence supports.",
      interpretation: "A rise means claims and evidence have moved closer together; a fall means the gap has widened.",
      caveat: "A widening gap is a prompt to ask for proof — it is not a finding of misrepresentation.",
      window: "Movement across the observed 12 months.",
      colour: CHANGE_COLOUR,
    },
  },
  {
    key: "signings",
    heading: "Commercial signings (window vs prior)",
    info: {
      name: "Commercial signings",
      definition: "Contract awards observed for this vendor in the current window, against the prior equivalent window.",
      interpretation: "Read the two counts together: the direction matters more than either number alone.",
      caveat: "Counts what is publicly recorded and curated — it is not the vendor's full order book.",
      window: "Current 12 months vs the prior 12 months.",
      colour: COLOUR_KEY,
    },
  },
];

function Cell({ n }: { n: number | null | undefined }) {
  if (n == null || n === 0) return <span style={{ color: "var(--fg-dim)" }}>no movement</span>;
  return (
    <span className="tabular" style={{ color: n > 0 ? "var(--data-positive-ink)" : "var(--data-risk-ink)" }}>
      {signed(n)}
    </span>
  );
}

export function RetrospectiveTable({
  vendors,
  deltas,
  deals,
}: {
  vendors: VendorIntel[];
  deltas: Map<string, RetrospectiveDeltas>;
  deals: Map<string, RetrospectiveDeals>;
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.95rem]">
          <thead>
            <tr>
              <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
              {DIMENSIONS.map((d) => (
                <th key={d.key} className="eyebrow px-4 py-3 text-left font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {d.heading}
                    <InfoTip content={d.info} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => {
              const dl = deltas.get(v.ticker);
              const df = deals.get(v.ticker);
              return (
                <tr key={v.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/vendors/${v.ticker.toLowerCase()}`}
                      className="font-medium underline-offset-4 hover:underline"
                      style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                    >
                      {v.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><Cell n={dl?.aiReadinessDelta} /></td>
                  <td className="px-4 py-3"><Cell n={dl?.netFlowDelta} /></td>
                  <td className="px-4 py-3"><Cell n={dl?.gapScoreDelta} /></td>
                  <td className="tabular px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                    {df ? `${count(df.awardsT12)} vs ${count(df.awardsPrior12)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
