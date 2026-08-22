import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { VendorComparison } from "@/components/VendorComparison";
import { LevelText, Panel, SectionHeader } from "@/components/ui";
import { getSignalDeltas, getVendorDealFacts } from "@/lib/data/facts";
import { count, shortDate, signed } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { OPPORTUNITY_LABELS, OPPORTUNITY_TYPES } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** VENDORS — how the vendors in the selected market are changing, compared. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) return <PortalShell active="vendors" ctx={ctx} returnTo="/vendors">{null}</PortalShell>;
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="vendors" ctx={ctx} returnTo="/vendors">
        <FirstRunSelector ctx={ctx} returnTo="/vendors" />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const tickersKey = [...intel.scope.tickers].sort().join(",");
  const [deltas, deals] = await Promise.all([getSignalDeltas(tickersKey), getVendorDealFacts(tickersKey)]);

  return (
    <PortalShell active="vendors" ctx={ctx} returnTo="/vendors">
      <AnalystInsightHero intel={intel} tab="vendors" />

      <section className="mt-8">
        <SectionHeader
          eyebrow="Relative position"
          title="Vendor comparison"
          aside="Greatest buyer opportunity first"
        />
        <div className="mt-5">
          <VendorComparison vendors={intel.vendors} variant="position" />
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Retrospective"
          title="12-month change comparison"
          aside={
            intel.signalTrackingSince
              ? `AG signal tracking since ${shortDate(intel.signalTrackingSince)} — a full 12-month series is not yet held`
              : undefined
          }
        />
        <div className="mt-5">
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.86rem]">
                <thead>
                  <tr>
                    <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
                    <th className="eyebrow px-4 py-3 text-left font-semibold">AI readiness Δ</th>
                    <th className="eyebrow px-4 py-3 text-left font-semibold">Net talent flow Δ</th>
                    <th className="eyebrow px-4 py-3 text-left font-semibold">Claims-vs-delivery Δ</th>
                    <th className="eyebrow px-4 py-3 text-left font-semibold">Awards (window vs prior)</th>
                  </tr>
                </thead>
                <tbody>
                  {intel.vendors.map((v) => {
                    const dl = deltas.get(v.ticker);
                    const df = deals.get(v.ticker);
                    const cell = (n: number | null | undefined) =>
                      n == null || n === 0 ? (
                        <span style={{ color: "var(--fg-dim)" }}>no movement</span>
                      ) : (
                        <span className="tabular" style={{ color: n > 0 ? "var(--data-positive-ink)" : "var(--data-risk-ink)" }}>
                          {signed(n)}
                        </span>
                      );
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
                        <td className="px-4 py-3">{cell(dl?.aiReadinessDelta)}</td>
                        <td className="px-4 py-3">{cell(dl?.netFlowDelta)}</td>
                        <td className="px-4 py-3">{cell(dl?.gapScoreDelta)}</td>
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
        </div>
      </section>

    </PortalShell>
  );
}
