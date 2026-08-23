import Link from "next/link";
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
        <table className="w-full border-collapse text-[0.86rem]">
          <thead>
            <tr>
              <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
              <th className="eyebrow px-4 py-3 text-left font-semibold">AI readiness Δ</th>
              <th className="eyebrow px-4 py-3 text-left font-semibold">Net talent flow Δ</th>
              <th className="eyebrow px-4 py-3 text-left font-semibold">Claims-vs-delivery Δ</th>
              <th className="eyebrow px-4 py-3 text-left font-semibold">Commercial signings (window vs prior)</th>
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
