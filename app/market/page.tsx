import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { MarketStateBand, MetricCard } from "@/components/MetricCard";
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
import { commercialWindowLabel } from "@/lib/metrics/canonical";
import { METRIC_DICTIONARY } from "@/lib/metrics/dictionary";
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
        <MarketStateBand
          metrics={[
            intel.strip.buyerLeverage,
            intel.strip.pricingPressure,
            intel.strip.servicesDemand,
            intel.strip.competitiveIntensity,
            intel.strip.aiProductivityPressure,
          ]}
        />
      </section>

      {/* The strip above reports what conditions are changing. This section is
          a DIFFERENT layer: what those conditions do to the buyer's commercial
          position economically. Nothing here restates a strip reading — cost,
          supplier capacity, value entering play and the productivity-to-terms
          gap are questions the strip does not answer. */}
      <section className="mt-12">
        <SectionHeader
          eyebrow="Economic consequence"
          title="Buyer economics"
          aside="What economic forces are changing the buyer's commercial position?"
        />
        <Panel hero className="mt-5 px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <StateText state={intel.buyerEconomics.state} metricId="m.buyerEconomics" className="display text-[1.7rem]" />
            <MovementText movement={intel.buyerEconomics.movement} className="text-[1.02rem]" />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {intel.buyerEconomics.dimensions.map((m) => (
              <MetricCard key={m.id} m={m} />
            ))}
          </div>
        </Panel>
      </section>

      {/* §20: when every row would read "Direction not asserted", the section
          asserts nothing. Collapse it to the volume it genuinely supports
          rather than filling a layout slot with a repeated non-statement. */}
      <section className="mt-12">
        <SectionHeader
          eyebrow="Service families"
          title="Contract volume by service family"
          aside="Direction is not asserted while contract evidence is this old"
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
                    <span className="tabular text-[0.94rem]" style={{ color: "var(--fg-muted)" }}>
                      {count(l.contracts)} contracts in scope · {count(l.inPlay24)} in play
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
        <div className="mt-5">
          <Panel className="px-5 py-4">
            <div className="eyebrow">By vendor</div>
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
              {/* The reading is the state; the sentence behind it repeats across
                  dozens of vendors, so it moves to hover/focus rather than
                  filling the column. The name links through to the vendor's
                  full reading, which is what gives the row a focus target. */}
              {intel.vendors.map((v) => (
                <li key={v.ticker} className="reveal flex flex-wrap items-baseline gap-x-4 text-[0.95rem]">
                  <Link
                    href={`/vendors/${v.ticker.toLowerCase()}`}
                    className="tap-link w-44 truncate font-medium underline-offset-4 hover:underline"
                    style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                  >
                    {v.name}
                  </Link>
                  <StateText state={v.metrics.aiProductivityOpportunity.state} metricId="aiProductivityOpportunity" className="text-[0.94rem]" />
                  {v.metrics.aiProductivityOpportunity.headline ? (
                    <span className="reveal-panel" role="note">
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
        {/* Operational risk is a delivery CONDITION, not an economic force. It
            was previously filed under buyer economics, where it answered no
            economic question; it belongs here beside delivery continuity. */}
        <div className="mt-5">
          <MetricCard m={intel.strip.operationalRisk} />
        </div>
        <div className="mt-3">
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
                      <StateText state={t.state} metricId="talentPressure" className="text-[0.94rem]" />
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
          /* canonical commercial anchor — the evidence date, never ingestion time */
          aside={commercialWindowLabel(intel.spine.dataAsOf, shortDate).replace(/^r/, "R")}
        />
        <div className="mt-5">
          <Panel className="px-5 py-4">
            <div className="eyebrow">Notable signed agreements</div>
            {topAwards.length > 0 ? (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {topAwards.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-[0.95rem]">
                    <span className="code tabular text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                      {shortDate(d.date)}
                    </span>
                    <span className="font-medium" style={{ color: "var(--fg)" }}>
                      {d.vendor}
                    </span>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {d.headline} · {money(d.tcvUsd)}
                    </span>
                    {d.sourceUrl ? (
                      <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="code tap-link text-[0.8rem]" style={{ color: "var(--rail-ink)" }}>
                        Source ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 mb-0 text-[0.94rem]" style={{ color: "var(--fg-dim)" }}>
                No signed agreements on record in the trailing window.
              </p>
            )}
          </Panel>
        </div>
      </section>

      <section className="mt-12">
        {/* Every card here reads the SAME variable for a different vendor, so
            the explanation sits once on the heading — not 66 times in a wide
            market. */}
        <SectionHeader
          eyebrow="By vendor"
          title="Vendor financial position"
          aside={
            <span className="inline-flex items-center gap-1.5">
              What this measures
              <InfoTip content={fromSemantics(METRIC_DICTIONARY.financialResilience!)} />
            </span>
          }
        />
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {intel.vendors.map((v) => (
            <MetricCard key={v.ticker} hideInfo m={{ ...v.metrics.financialResilience, label: v.name }} />
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
