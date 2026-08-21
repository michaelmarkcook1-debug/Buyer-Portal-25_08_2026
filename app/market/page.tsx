import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { IntelligenceStrip, MetricCard } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { TwelveMonthChange } from "@/components/TwelveMonthChange";
import {
  BasisList,
  EmptyEvidence,
  MovementText,
  Panel,
  SectionHeader,
  StateText,
} from "@/components/ui";
import { getDevelopments, getScopeLines } from "@/lib/data/facts";
import { count, money, shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** MARKET — how services economics are changing across the selected vendors. */
export default async function MarketPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) return <PortalShell active="market" ctx={ctx} returnTo="/market">{null}</PortalShell>;
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="market" ctx={ctx} returnTo="/market">
        <FirstRunSelector ctx={ctx} returnTo="/market" />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const tickersKey = [...intel.scope.tickers].sort().join(",");
  const [lines, developments] = await Promise.all([
    getScopeLines(tickersKey),
    getDevelopments(tickersKey, 20),
  ]);
  const topAwards = developments.filter((d) => d.kind === "award" && d.tcvUsd != null).slice(0, 4);

  return (
    <PortalShell active="market" ctx={ctx} returnTo="/market">
      <AnalystInsightHero intel={intel} tab="market" />

      <section className="mt-8">
        <IntelligenceStrip
          metrics={[
            intel.strip.buyerLeverage,
            intel.strip.pricingPressure,
            intel.strip.servicesDemand,
            intel.strip.competitiveIntensity,
            intel.strip.aiProductivityPressure,
          ]}
        />
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="Key market state" title="Buyer economics" />
        <Panel hero className="mt-5 px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <StateText state={intel.buyerEconomics.state} className="display text-[1.7rem]" />
            <MovementText movement={intel.buyerEconomics.movement} className="text-[0.95rem]" />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {intel.buyerEconomics.dimensions.map((m) => (
              <MetricCard key={m.id} m={m} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Service families"
          title="Services pricing direction"
          aside="Service is an attribute of the intelligence — not a configuration"
        />
        <div className="mt-5">
          {lines.length > 0 ? (
            <Panel>
              <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
                {lines.map((l) => (
                  <li key={l.line} className="flex flex-wrap items-baseline gap-x-4 px-5 py-3">
                    <span className="w-56 font-medium" style={{ color: "var(--fg)" }}>
                      {l.line}
                    </span>
                    <span className="tabular text-[0.84rem]" style={{ color: "var(--fg-muted)" }}>
                      {count(l.contracts)} contracts in scope · {count(l.inPlay24)} in play
                    </span>
                    <span className="ml-auto text-[0.8rem] italic" style={{ color: "var(--fg-dim)" }}>
                      Direction not asserted — spine last refreshed {shortDate(intel.spine.lastIngest)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyEvidence
              title="Insufficient evidence for a pricing view by service family."
              body="Your selected vendors hold no classified contracts on the spine."
            />
          )}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="AI"
          title="AI productivity"
          aside="Where should AI capability now be changing what buyers pay for?"
        />
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <MetricCard m={intel.strip.aiProductivityPressure} />
          <Panel className="px-5 py-4 lg:col-span-2">
            <div className="eyebrow">By vendor</div>
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
              {intel.vendors.map((v) => (
                <li key={v.ticker} className="flex flex-wrap items-baseline gap-x-4 text-[0.86rem]">
                  <span className="w-44 truncate font-medium" style={{ color: "var(--fg)" }}>
                    {v.name}
                  </span>
                  <StateText state={v.metrics.aiProductivityOpportunity.state} className="text-[0.84rem]" />
                  {v.metrics.aiProductivityOpportunity.headline ? (
                    <span className="min-w-0 flex-1 text-[0.8rem]" style={{ color: "var(--fg-muted)" }}>
                      {v.metrics.aiProductivityOpportunity.headline}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="Delivery economics" title="Labour and delivery" />
        <div className="mt-5">
          <Panel>
            <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
              {intel.vendors.map((v) => {
                const t = v.metrics.talentPressure;
                return (
                  <li key={v.ticker} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-4">
                      <span className="w-44 truncate font-medium" style={{ color: "var(--fg)" }}>
                        {v.name}
                      </span>
                      <StateText state={t.state} className="text-[0.84rem]" />
                    </div>
                    {t.basis.length > 0 ? <BasisList basis={t.basis.slice(0, 1)} className="mt-1" /> : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Deal market"
          title="Deal flow in your market"
          aside={`Windows anchored at ${shortDate(intel.spine.lastIngest)}`}
        />
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <MetricCard m={intel.strip.servicesDemand} />
          <Panel className="px-5 py-4 lg:col-span-2">
            <div className="eyebrow">Notable signed agreements</div>
            {topAwards.length > 0 ? (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {topAwards.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-[0.86rem]">
                    <span className="code tabular text-[0.7rem]" style={{ color: "var(--fg-dim)" }}>
                      {shortDate(d.date)}
                    </span>
                    <span className="font-medium" style={{ color: "var(--fg)" }}>
                      {d.vendor}
                    </span>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {d.headline} · {money(d.tcvUsd)}
                    </span>
                    {d.sourceUrl ? (
                      <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="code text-[0.68rem]" style={{ color: "var(--rail-ink)" }}>
                        Source ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 mb-0 text-[0.84rem]" style={{ color: "var(--fg-dim)" }}>
                No signed agreements on record in the trailing window.
              </p>
            )}
          </Panel>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="Supplier economics" title="Vendor financial position" />
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {intel.vendors.map((v) => (
            <MetricCard key={v.ticker} m={{ ...v.metrics.financialResilience, label: v.name }} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Retrospective"
          title="12-month structural change"
          aside={`Baseline ${shortDate(intel.baselineStart)}`}
        />
        <div className="mt-5">
          <TwelveMonthChange changes={intel.changes} />
        </div>
      </section>
    </PortalShell>
  );
}
