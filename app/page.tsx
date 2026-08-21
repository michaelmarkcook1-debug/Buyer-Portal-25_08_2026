import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { IntelligenceStrip } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { SignalCard } from "@/components/SignalCard";
import { TwelveMonthChange } from "@/components/TwelveMonthChange";
import { VendorComparison } from "@/components/VendorComparison";
import { EmptyEvidence, MovementText, Panel, SectionHeader } from "@/components/ui";
import { getDevelopments } from "@/lib/data/facts";
import { money, shortDate } from "@/lib/format";
import { SEC_MEANING } from "@/lib/metrics/watch";
import type { RawSearchParams } from "@/lib/market-scope";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * HOME — what matters most today across the selected vendor market.
 * Hierarchy (spec §5): analyst judgement → key state → what changed →
 * relative position → opportunity → supporting detail.
 */
export default async function Home({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) {
    return <PortalShell active="home" ctx={ctx} returnTo="/">{null}</PortalShell>;
  }
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="home" ctx={ctx} returnTo="/">
        <FirstRunSelector ctx={ctx} returnTo="/" />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const tickersKey = [...intel.scope.tickers].sort().join(",");
  const developments = (await getDevelopments(tickersKey, 12)).slice(0, 6);

  const movers = intel.vendors
    .map((v) => {
      const moving = [v.metrics.providerMomentum, v.metrics.reputationMovement, v.metrics.dealMarketHeat, v.metrics.talentPressure]
        .filter((m) => m.movement.includes("improving") || m.movement.includes("deteriorating"));
      return { v, moving };
    })
    .filter((x) => x.moving.length > 0)
    .slice(0, 4);

  return (
    <PortalShell active="home" ctx={ctx} returnTo="/">
      <AnalystInsightHero intel={intel} tab="home" />

      <section className="mt-8">
        <IntelligenceStrip
          metrics={[
            intel.strip.buyerLeverage,
            intel.strip.pricingPressure,
            intel.strip.automationOpportunity,
            intel.strip.commercialOpportunities,
            intel.strip.marketHeat,
          ]}
        />
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Signals"
          title="What matters today"
          aside={intel.watch.length > 0 ? `${intel.watch.length} of a maximum 5` : undefined}
        />
        <div className="mt-5 space-y-3">
          {intel.watch.length > 0 ? (
            intel.watch.map((s, i) => <SignalCard key={i} s={s} />)
          ) : (
            <EmptyEvidence
              title="No material change detected across your selected vendors today."
              body="Signals appear only when a dated event or canonical state genuinely warrants attention — nothing is manufactured to fill this space."
            />
          )}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Relative position"
          title="Commercial opportunity"
          aside="Greatest buyer opportunity first"
        />
        <div className="mt-5">
          <VendorComparison vendors={intel.vendors} variant="opportunity" />
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Retrospective"
          title="12-month commercial change"
          aside={`Baseline ${shortDate(intel.baselineStart)}`}
        />
        <div className="mt-5">
          <TwelveMonthChange changes={intel.changes} materialOnly />
        </div>
      </section>

      {movers.length > 0 ? (
        <section className="mt-12">
          <SectionHeader eyebrow="Movement" title="Vendor movers" />
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {movers.map(({ v, moving }) => (
              <Panel key={v.ticker} className="px-5 py-4">
                <div className="font-medium" style={{ color: "var(--fg)" }}>
                  {v.name}
                </div>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {moving.slice(0, 2).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 text-[0.84rem]">
                      <span className="eyebrow text-[0.6rem]">{m.label}</span>
                      <MovementText movement={m.movement} className="text-[0.8rem]" />
                      {m.headline ? (
                        <span className="w-full text-[0.8rem]" style={{ color: "var(--fg-muted)" }}>
                          {m.headline}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <SectionHeader
          eyebrow="Supporting detail"
          title="Relevant developments"
          aside="Dated and citable — no general news feed"
        />
        <div className="mt-5 space-y-3">
          {developments.length > 0 ? (
            developments.map((d, i) => {
              const implication =
                d.kind === "filing"
                  ? (d.itemCode ? SEC_MEANING[d.itemCode]?.implication : undefined) ??
                    "The company judged this material enough to disclose."
                  : "A signed agreement in your market — a live reference point for scope, size and provider capability.";
              return (
                <Panel key={i} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="code tabular text-[0.7rem]" style={{ color: "var(--fg-dim)" }}>
                      {shortDate(d.date)}
                    </span>
                    <span className="font-medium" style={{ color: "var(--fg)" }}>
                      {d.vendor}
                    </span>
                    <span className="text-[0.88rem]" style={{ color: "var(--fg-muted)" }}>
                      {d.headline}
                      {d.tcvUsd != null ? ` · ${money(d.tcvUsd)}` : ""}
                      {d.detail ? ` · ${d.detail}` : ""}
                    </span>
                    {d.sourceUrl ? (
                      <a
                        href={d.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="code ml-auto text-[0.68rem]"
                        style={{ color: "var(--rail-ink)" }}
                      >
                        Source ↗
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 mb-0 text-[0.82rem]" style={{ color: "var(--fg-muted)" }}>
                    <span className="eyebrow mr-2 text-[0.56rem]">Why it matters</span>
                    {implication}
                  </p>
                </Panel>
              );
            })
          ) : (
            <EmptyEvidence
              title="No dated developments in scope."
              body="Developments appear here only when a signed contract or regulatory filing touches your selected vendors."
            />
          )}
        </div>
      </section>
    </PortalShell>
  );
}
