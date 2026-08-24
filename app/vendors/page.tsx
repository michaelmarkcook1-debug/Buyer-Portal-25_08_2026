import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { SigningsSlopeChart } from "@/components/charts/Charts";
import { RetrospectiveTable } from "@/components/RetrospectiveTable";
import { VendorComparison } from "@/components/VendorComparison";
import { WholeMarketLenses } from "@/components/WholeMarketLenses";
import { LevelText, Panel, SectionHeader } from "@/components/ui";
import { getSignalDeltas, getVendorDealFacts } from "@/lib/data/facts";
import { count, shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { OPPORTUNITY_LABELS, OPPORTUNITY_TYPES } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** Rows shown before progressive disclosure takes over on a wide market. */
const CURATED_ROWS = 12;

/** Only vendors whose 12-month series actually moved lead the curated
 * retrospective — "no movement" repeated 60 times is not evidence. Every
 * vendor remains reachable through the disclosure below it. */
function hasMovement(
  deltas: Awaited<ReturnType<typeof getSignalDeltas>>,
  deals: Awaited<ReturnType<typeof getVendorDealFacts>>,
) {
  return (v: { ticker: string }): boolean => {
    const dl = deltas.get(v.ticker);
    const df = deals.get(v.ticker);
    const moved = [dl?.aiReadinessDelta, dl?.netFlowDelta, dl?.gapScoreDelta].some((n) => n != null && n !== 0);
    const awardsMoved = df != null && df.awardsT12 !== df.awardsPrior12;
    return moved || awardsMoved;
  };
}

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
  // A market this wide is unreadable as a flat table — lead with curation and
  // keep the full universe one disclosure away (§13/§14).
  const curated = intel.vendors.length > CURATED_ROWS;
  /* CHART 2 inputs — canonical commercial signings, rolling 12 months to the
     evidence anchor against the preceding 12. Never procurement awards, which
     are a separate measure on a separate window. */
  const signingsAll = intel.vendors
    .filter((v) => v.coverage.signingsT12 > 0 || v.coverage.signingsPrior12 > 0)
    .map((v) => ({ name: v.name, prior: v.coverage.signingsPrior12, current: v.coverage.signingsT12 }));
  const byDelta = [...signingsAll].sort((a, b) => (b.current - b.prior) - (a.current - a.prior));
  /* Whole Market plots the extremes, not 66 rows: strongest risers and
     strongest fallers, with the middle stated as a count rather than drawn. */
  const signingsRows = curated
    ? [...byDelta.filter((r) => r.current > r.prior).slice(0, 4), ...byDelta.filter((r) => r.current < r.prior).slice(-4)]
    : signingsAll;
  const signingsMiddle = signingsAll.length - signingsRows.length;
  const signingsTotalNow = signingsAll.reduce((a, r) => a + r.current, 0);
  const signingsTotalPrior = signingsAll.reduce((a, r) => a + r.prior, 0);

  return (
    <PortalShell active="vendors" ctx={ctx} returnTo="/vendors">
      <AnalystInsightHero intel={intel} tab="vendors" />

      {curated ? (
        <>
          <section className="mt-8">
            <SectionHeader
              eyebrow="Relative position"
              title="Where to look first"
              aside={`The exceptional situations across ${count(intel.vendors.length)} covered vendors`}
            />
            <div className="mt-5">
              <WholeMarketLenses vendors={intel.vendors} />
            </div>
          </section>

          <section className="mt-12">
            <SectionHeader
              eyebrow="Relative position"
              title="Leading vendors"
              aside="Greatest buyer opportunity first"
            />
            <div className="mt-5">
              <VendorComparison vendors={intel.vendors.slice(0, CURATED_ROWS)} variant="position" />
            </div>
            <details className="mt-4">
              <summary
                className="cursor-pointer text-[0.95rem] underline-offset-4 hover:underline"
                style={{ color: "var(--accent-ink)" }}
              >
                Show all {count(intel.vendors.length)} covered vendors
              </summary>
              <div className="mt-4">
                <VendorComparison vendors={intel.vendors} variant="position" />
              </div>
            </details>
          </section>
        </>
      ) : (
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
      )}

      {/* CHART 2 — which vendors are gaining or losing commercial momentum.
          Complements the retrospective table; it does not replace it. */}
      {signingsRows.length > 0 ? (
        <section className="mt-12">
          <SectionHeader
            eyebrow="Commercial momentum"
            title="Signings, current window against prior"
            aside={curated ? `Strongest movers of ${count(signingsAll.length)} vendors with signing activity` : undefined}
          />
          <div className="mt-5">
            <Panel className="px-6 py-5">
              <SigningsSlopeChart
                rows={signingsRows}
                windowLabel={`Rolling 12 months${intel.spine.dataAsOf ? ` to ${shortDate(intel.spine.dataAsOf)}` : ""} against the preceding 12`}
                interpretation={`${count(signingsTotalNow)} observed signings across the selected market against ${count(signingsTotalPrior)} in the prior window.${
                  signingsMiddle > 0 ? ` ${count(signingsMiddle)} further vendors moved less and are not plotted.` : ""
                } A vendor winning more work is not automatically good news for a buyer — rising activity tends to reduce the room to press.`}
                footnote="Curated contract record · commercial signings only, never public procurement awards"
              />
            </Panel>
          </div>
        </section>
      ) : null}

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
          {curated ? (
            <>
              <RetrospectiveTable
                vendors={intel.vendors.filter(hasMovement(deltas, deals)).slice(0, CURATED_ROWS)}
                deltas={deltas}
                deals={deals}
              />
              <details className="mt-4">
                <summary
                  className="cursor-pointer text-[0.95rem] underline-offset-4 hover:underline"
                  style={{ color: "var(--accent-ink)" }}
                >
                  Show all {count(intel.vendors.length)} covered vendors
                </summary>
                <div className="mt-4">
                  <RetrospectiveTable vendors={intel.vendors} deltas={deltas} deals={deals} />
                </div>
              </details>
            </>
          ) : (
            <RetrospectiveTable vendors={intel.vendors} deltas={deltas} deals={deals} />
          )}
        </div>
      </section>

    </PortalShell>
  );
}
