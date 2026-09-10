import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import {
  DistributionChart,
  ExposureConcentrationChart,
  FlowComparisonChart,
  stateInk,
} from "@/components/charts/Charts";
import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { MarketStateBand, MetricCard } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { TwelveMonthChange } from "@/components/TwelveMonthChange";
import {
  BasisList,
  CONFIDENCE_LABEL,
  EmptyEvidence,
  MovementText,
  Panel,
  SectionHeader,
  StateText,
} from "@/components/ui";
import { getDevelopments, getScopeCountries, getScopeLines } from "@/lib/data/facts";
import { count, money, shortDate } from "@/lib/format";
import { commercialWindowLabel } from "@/lib/metrics/canonical";
import { METRIC_DICTIONARY, displayState } from "@/lib/metrics/dictionary";
import type { RawSearchParams } from "@/lib/market-scope";
import type { FlowWindow } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/**
 * One buyer reading for the observed flow pair.
 *
 * DERIVED, never asserted: a narrower scope can genuinely show flow rising,
 * and the sentence has to say so rather than repeat a market-wide storyline.
 * The bars are deliberately neutral, so the buyer consequence is carried here
 * in words — less new work reaching providers is a market condition that
 * tends to favour buyers, which stock-market colouring would state backwards.
 */
function flowReading(series: FlowWindow[]): string {
  if (series.length === 0) return "";
  const dir = (w: FlowWindow) => (w.current < w.prior ? "down" : w.current > w.prior ? "up" : "flat");
  const dirs = new Set(series.map(dir));
  const both = series.length > 1;

  if (dirs.size > 1) {
    return "The two series diverge. They run on different windows and different evidence families, so each is read on its own clock rather than as one trend.";
  }
  if (dirs.has("down")) {
    return (
      (both ? "Both series moved the same way on different clocks: less" : "Less") +
      " new work is reaching these providers than in the comparison period. Providers competing for materially less new work is a market condition that tends to favour buyers — it is market evidence, not evidence about any individual agreement."
    );
  }
  if (dirs.has("up")) {
    return "More new work is reaching these providers than in the comparison period. Rising demand tends to reduce a provider's need to concede, so market conditions are the weaker part of a buyer's case here.";
  }
  return "Observed flow is level against the comparison period; market conditions are neither strengthening nor weakening the buyer's backdrop.";
}

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
  /* Whole Market is a DISCOVERY scope: the same page rendered for 66 vendors
     is detail mode applied to a universe. Charts summarise; the full per-vendor
     detail moves behind explicit disclosure. */
  const isWhole = ctx.scope.mode === "whole_market";
  const exposureBars = intel.vendors
    .filter((v) => v.coverage.inPlay12 > 0)
    .sort((a, b) => (b.coverage.inPlay12DisclosedUsd ?? 0) - (a.coverage.inPlay12DisclosedUsd ?? 0) || b.coverage.inPlay12 - a.coverage.inPlay12)
    .map((v) => ({
      name: v.name,
      count: v.coverage.inPlay12,
      disclosedUsd: v.coverage.inPlay12DisclosedUsd,
      inferred: v.coverage.inPlay12Inferred,
    }));
  const exposureShown = isWhole ? exposureBars.slice(0, 8) : exposureBars;
  const exposureTop = exposureShown[0];
  const exposureTotalDisclosed = exposureBars.reduce((a, b) => a + (b.disclosedUsd ?? 0), 0);
  const exposureShare =
    exposureTop?.disclosedUsd && exposureTotalDisclosed > 0
      ? exposureTop.disclosedUsd / exposureTotalDisclosed
      : 0;
  const [lines, geography, developments] = await Promise.all([
    getScopeLines(tickersKey),
    getScopeCountries(tickersKey),
    getDevelopments(tickersKey, 20),
  ]);
  const topAwards = developments.filter((d) => d.kind === "award" && d.tcvUsd != null).slice(0, 4);

  /* The two strongest movements in the product were three paragraphs of raw
     numbers spread across the page. They keep their canonical values here and
     gain a shape; the retrospective rows that restated them are merged out
     below, so this section gains a chart without the page gaining prose. */
  const flowSeries = [
    intel.dealFlow.procurement
      ? { ...intel.dealFlow.procurement, label: "Public procurement awards", unit: "awards" }
      : null,
    intel.dealFlow.commercial
      ? { ...intel.dealFlow.commercial, label: "Commercial signings", unit: "signings" }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x != null);
  /* Two clocks, so the heading names both rather than labelling the pair with
     the window of only one of them. */
  const dealWindowLabel =
    intel.dealFlow.procurement?.asOf && intel.dealFlow.commercial?.asOf
      ? `Public awards to ${intel.dealFlow.procurement.asOf} · commercial record to ${intel.dealFlow.commercial.asOf}`
      : commercialWindowLabel(intel.spine.dataAsOf, shortDate).replace(/^r/, "R");
  /* Rows whose entire content is now drawn above. Merged, not dropped: the
     chart carries their figures, windows, source and confidence. */
  const MERGED_INTO_FLOW_CHART = new Set(["Deal flow (commercial)", "Deal flow (public procurement)"]);
  const retrospective = flowSeries.length > 0
    ? intel.changes.filter((c) => !MERGED_INTO_FLOW_CHART.has(c.dimension))
    : intel.changes;

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
            <MovementText
              movement={intel.buyerEconomics.movement}
              effect={displayState("m.buyerEconomics", intel.buyerEconomics.state).effect}
              className="text-[1.03rem]"
            />
          </div>
          {/* The exposure chart lives INSIDE its own analytical unit and spans
              the grid: one heading, one interpretation, one conclusion. It
              previously sat in a separate section below, restating the same
              finding with its own header and prose. */}
          <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {intel.buyerEconomics.dimensions.map((m) => (
              <div key={m.id}>
                <MetricCard
                  m={m}
                  visual={
                    m.id === "m.exposure" && exposureShown.length > 0 ? (
                      <ExposureConcentrationChart
                        bars={exposureShown}
                        totalCount={exposureBars.reduce((a, b) => a + b.count, 0)}
                        moneyFmt={money}
                        valueLabel="Bars show DISCLOSED value only. A dashed, lighter bar marks a vendor whose value is mostly estimated; withheld value draws no bar."
                      />
                    ) : undefined
                  }
                />
              </div>
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
                    <span className="tabular text-[0.97rem]" style={{ color: "var(--fg-muted)" }}>
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

      {/* WHERE THE MARKET SIGNS (2026-09-10). The spine carried no geography at
          all: the columns existed on the table but were absent from the model,
          so nothing could write them. A country-level question — who signs
          where, and what is reaching term there — could not be put to the
          product. This reads the SIGNING country, which is not a delivery
          location, and the section says so rather than letting a reader infer
          offshore exposure from it. */}
      <section className="mt-12">
        <SectionHeader
          eyebrow="Geography"
          title="Where this market signs"
          aside="The country each agreement was signed in — never where it is delivered from"
        />
        <div className="mt-5">
          {geography.rows.length > 0 ? (
            <Panel>
              <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
                {geography.rows.slice(0, 12).map((c) => (
                  <li key={c.country} className="flex flex-wrap items-baseline gap-x-4 px-5 py-3">
                    <span className="w-56 font-medium" style={{ color: "var(--fg)" }}>
                      {c.country}
                    </span>
                    <span className="tabular text-[0.97rem]" style={{ color: "var(--fg-muted)" }}>
                      {count(c.contracts)} contracts in scope · {count(c.inPlay12)} reaching term inside 12 months
                    </span>
                    {/* Disclosed value only. A modelled figure never enters a
                        country total, so a country with none shows none. */}
                    {c.disclosedUsd != null ? (
                      <span className="tabular ml-auto text-[0.97rem]" style={{ color: "var(--fg-dim)" }}>
                        {money(c.disclosedUsd)} disclosed
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div
                className="code max-w-[92ch] px-5 py-3 text-[0.88rem] leading-snug"
                style={{ color: "var(--fg-dim)", borderTop: "1px solid var(--surface-line-soft)" }}
              >
                {[
                  geography.rows.length > 12
                    ? `Showing the 12 largest of ${count(geography.rows.length)} countries in the record.`
                    : `${count(geography.rows.length)} countries in the record.`,
                  geography.unstated > 0
                    ? `${count(geography.unstated)} agreements name no country and are counted in none of these.`
                    : null,
                  "Signing country only — this says nothing about where work is delivered.",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </Panel>
          ) : (
            <EmptyEvidence
              title="No signing country is recorded for this market."
              body="The agreements on the spine for your selected vendors name no country of signature."
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
                <li key={v.ticker} className="reveal flex flex-wrap items-baseline gap-x-4 text-[0.98rem]">
                  <Link
                    href={`/vendors/${v.ticker.toLowerCase()}`}
                    className="tap-link w-44 truncate font-medium underline-offset-4 hover:underline"
                    style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                  >
                    {v.name}
                  </Link>
                  <StateText state={v.metrics.aiProductivityOpportunity.state} metricId="aiProductivityOpportunity" className="text-[0.97rem]" />
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
                      <StateText state={t.state} metricId="talentPressure" className="text-[0.97rem]" />
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
          aside={dealWindowLabel}
        />
        {flowSeries.length > 0 ? (
          <div className="mt-5">
            <Panel className="px-6 py-5">
              <div className="eyebrow">Observed flow, current window against prior</div>
              <div className="mt-3">
                <FlowComparisonChart
                  series={flowSeries}
                  interpretation={flowReading(flowSeries)}
                  footnote={`${[...new Set(flowSeries.map((f) => f.source))].join(" · ")} · ${
                    flowSeries.every((f) => f.confidence === flowSeries[0]!.confidence)
                      ? `confidence ${CONFIDENCE_LABEL[flowSeries[0]!.confidence]}`
                      : flowSeries.map((f) => `${f.label.toLowerCase()} ${CONFIDENCE_LABEL[f.confidence]}`).join(" · ")
                  }`}
                />
              </div>
            </Panel>
          </div>
        ) : null}
        <div className={flowSeries.length > 0 ? "mt-3" : "mt-5"}>
          <Panel className="px-5 py-4">
            <div className="eyebrow">Notable signed agreements</div>
            {topAwards.length > 0 ? (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {topAwards.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-[0.98rem]">
                    <span className="code tabular text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
                      {shortDate(d.date)}
                    </span>
                    <span className="font-medium" style={{ color: "var(--fg)" }}>
                      {d.vendor}
                    </span>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {d.headline} · {money(d.tcvUsd)}
                    </span>
                    {d.sourceUrl ? (
                      <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="code tap-link text-[0.88rem]" style={{ color: "var(--rail-ink)" }}>
                        Source ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 mb-0 text-[0.97rem]" style={{ color: "var(--fg-dim)" }}>
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
        {isWhole ? (
          /* 66 identical cards is not a market view — it is the same variable
             restated 66 times. The distribution says what the cards said, and
             every card stays one disclosure away. */
          <div className="mt-5 flex flex-col gap-4">
            <Panel className="px-6 py-5">
              <DistributionChart
                total={intel.vendors.length}
                rows={[
                  {
                    dimension: "Financial resilience",
                    bands: (["favourable", "stable", "unfavourable", "mixed", "insufficient"] as const).map((st) => ({
                      label: displayState("financialResilience", st).label,
                      count: intel.vendors.filter((v) => v.metrics.financialResilience.state === st).length,
                      ink: stateInk("financialResilience", st),
                    })),
                  },
                ]}
                interpretation={`Across ${count(intel.vendors.length)} covered vendors, financial condition is not uniform — read it as market context, not as buyer advantage.`}
                footnote="Revenue growth · filed operating margin (SEC XBRL where listed)"
              />
            </Panel>
            <details className="group">
              <summary className="tap cursor-pointer list-none text-[0.98rem]" style={{ color: "var(--accent-ink)" }}>
                Show all {count(intel.vendors.length)} vendors
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {intel.vendors.map((v) => (
                  <MetricCard key={v.ticker} hideInfo m={{ ...v.metrics.financialResilience, label: v.name }} />
                ))}
              </div>
            </details>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {intel.vendors.map((v) => (
              <MetricCard key={v.ticker} hideInfo m={{ ...v.metrics.financialResilience, label: v.name }} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Retrospective"
          title="12-month structural change"
          aside={`Baseline ${shortDate(intel.baselineStart)}`}
        />
        <div className="mt-5">
          <TwelveMonthChange changes={retrospective} />
        </div>
      </section>
    </PortalShell>
  );
}
