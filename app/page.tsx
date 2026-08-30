import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import type { WatchSignal } from "@/lib/metrics/types";
import { MarketStateBand } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { SignalCard } from "@/components/SignalCard";
import { TwelveMonthChange } from "@/components/TwelveMonthChange";
import { VendorComparison } from "@/components/VendorComparison";
import { displayState } from "@/lib/metrics/dictionary";
import { ClassChip, EmptyEvidence, MovementText, Panel, SectionHeader } from "@/components/ui";
import { getDevelopments } from "@/lib/data/facts";
import { InfoTip, COLOUR_KEY } from "@/components/InfoTip";
import { SIGNAL_CLASS_HELP } from "@/lib/metrics/dictionary";
import { count, money, shortDate } from "@/lib/format";
import { SEC_MEANING } from "@/lib/metrics/watch";
import type { RawSearchParams } from "@/lib/market-scope";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

/**
 * §10: collapse ACT signals that share one underlying development. Several
 * vendors showing the same implication lead to a single buyer action, so they
 * belong on one comparative card rather than as near-identical repeats.
 * Order is preserved; a lone signal stays a normal card.
 */
function groupByImplication(signals: WatchSignal[]): WatchSignal[][] {
  const groups = new Map<string, WatchSignal[]>();
  for (const s of signals) {
    const key = s.implication.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()];
}

/** Cards actually rendered after renewal and implication grouping. */

/**
 * Say plainly that these signals do not share one clock.
 *
 * The signals list mixes evidence that moves in days with evidence that moves
 * in months: a filed SEC termination sits beside renewal concentration read
 * off a commercial record whose newest deal predates it by a quarter. Both are
 * decision-useful, and neither is improved by pretending they were observed
 * together. One line, so a reader knows which clock each is on without a
 * timestamp on every row.
 */
function cadenceNote(intel: { watch: WatchSignal[]; spine: { dataAsOf: string | null } }): string {
  const eventDates = intel.watch.map((s) => s.date).filter((d): d is string => Boolean(d)).sort();
  const newestEvent = eventDates.at(-1);
  const commercial = intel.spine.dataAsOf;
  if (!newestEvent && !commercial) return "";
  const parts = [
    newestEvent ? `filings to ${shortDate(newestEvent)}` : null,
    commercial ? `commercial record to ${shortDate(commercial)}` : null,
  ].filter(Boolean);
  return ` · ${parts.join(", ")}`;
}

function renderedSignalTotal(watch: WatchSignal[]): number {
  const isRenewal = (h: string) => h.includes("observed renewal activity concentrating");
  const renewal = watch.filter((s) => isRenewal(s.headline));
  const rest = watch.filter((s) => !isRenewal(s.headline));
  const acts = groupByImplication(rest.filter((s) => s.classification === "ACT")).length;
  const others = rest.filter((s) => s.classification !== "ACT").length;
  const renewalCards = renewal.length >= 2 ? 1 : renewal.length;
  return acts + others + renewalCards;
}

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
  const renderedSignalCount = renderedSignalTotal(intel.watch);
  const tickersKey = [...intel.scope.tickers].sort().join(",");
  const developmentsAll = await getDevelopments(tickersKey, 12);
  const developments = developmentsAll.slice(0, 5);

  const moversAll = intel.vendors
    .map((v) => {
      const moving = [v.metrics.providerMomentum, v.metrics.reputationMovement, v.metrics.dealMarketHeat, v.metrics.talentPressure]
        .filter((m) => m.movement.includes("improving") || m.movement.includes("deteriorating"));
      return { v, moving };
    })
    .filter((x) => x.moving.length > 0);
  const movers = moversAll.slice(0, 4);

  return (
    <PortalShell active="home" ctx={ctx} returnTo="/">
      <AnalystInsightHero intel={intel} tab="home" />

      <section className="mt-8">
        <MarketStateBand
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
          title={(
            <span className="inline-flex items-center gap-2">
              What matters today
              <InfoTip content={{ ...SIGNAL_CLASS_HELP, colour: COLOUR_KEY }} />
            </span>
          ) as unknown as string}
          aside={renderedSignalCount > 0 ? `${renderedSignalCount} development${renderedSignalCount === 1 ? "" : "s"} worth attention${cadenceNote(intel)}` : undefined}
        />
        <div className="mt-5 space-y-3">
          {intel.watch.length > 0 ? (
            (() => {
              /* Presentation-level grouping (design review §5): the same
                 renewal-concentration reading across several vendors renders
                 as ONE comparative card instead of near-identical repeats. */
              const isRenewal = (h: string) => h.includes("observed renewal activity concentrating");
              const renewal = intel.watch.filter((s) => isRenewal(s.headline));
              const rest = intel.watch.filter((s) => !isRenewal(s.headline));
              const restActs = rest.filter((s) => s.classification === "ACT");
              const restOther = rest.filter((s) => s.classification !== "ACT");
              /* §10: several vendors showing the SAME underlying development
                 lead to one buyer action, so they render as one comparative
                 card. Repeating an identical implication per vendor inflated
                 ACT and made the list look busier than the evidence is. */
              const actGroups = groupByImplication(restActs);
              return (
                <>
                  {actGroups.map((g, i) =>
                    g.length === 1 ? (
                      <SignalCard key={`a${i}`} s={g[0]!} />
                    ) : (
                      <Panel key={`a${i}`} className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <ClassChip cls={g[0]!.classification} />
                          <span className="font-medium" style={{ color: "var(--fg)" }}>
                            {g[0]!.implication.split(". ")[0]} — across {g.length} vendors
                          </span>
                        </div>
                        <ul className="m-0 mt-3 list-none space-y-2 p-0">
                          {g.map((s) => (
                            <li key={s.tickers[0]} className="flex flex-wrap items-baseline gap-x-3 text-[0.94rem]">
                              <span className="w-28 shrink-0 font-medium" style={{ color: "var(--fg)" }}>{s.vendors[0]}</span>
                              <span className="min-w-0 flex-1" style={{ color: "var(--fg-muted)" }}>
                                {s.headline}{s.change ? ` · ${s.change}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Panel>
                    ),
                  )}
                  {renewal.length >= 2 ? (
                    <Panel className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <ClassChip cls={renewal[0]!.classification} />
                        <span className="font-medium" style={{ color: "var(--fg)" }}>
                          Observed renewal activity concentrating across {renewal.length} selected vendors
                        </span>
                      </div>
                      <ul className="m-0 mt-3 list-none space-y-2 p-0">
                        {renewal.map((s) => (
                          <li key={s.tickers[0]} className="flex flex-wrap items-baseline gap-x-3 text-[0.94rem]">
                            <span className="w-28 shrink-0 font-medium" style={{ color: "var(--fg)" }}>{s.vendors[0]}</span>
                            <span className="min-w-0 flex-1" style={{ color: "var(--fg-muted)" }}>
                              {s.implication.split(". ")[0]}.{s.change ? ` ${s.change}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="code mt-3 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                        Market record{intel.spine.dataAsOf ? ` to ${shortDate(intel.spine.dataAsOf)}` : ""} — their defensive exposure, never the reader's contracts. End-of-term dates move slowly, so this reading stays useful between commercial loads.
                      </div>
                    </Panel>
                  ) : (
                    renewal.map((s, i) => <SignalCard key={`n${i}`} s={s} />)
                  )}
                  {restOther.map((s, i) => (
                    <SignalCard key={`o${i}`} s={s} />
                  ))}
                </>
              );
            })()
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
          <VendorComparison vendors={intel.scope.mode === "whole_market" ? intel.vendors.slice(0, 8) : intel.vendors} variant="opportunity" />
          {intel.scope.mode === "whole_market" && intel.vendors.length > 8 ? (
            <p className="mt-3 mb-0 text-[0.9rem]" style={{ color: "var(--fg-muted)" }}>
              Showing the strongest 8 of {intel.vendors.length} covered vendors — the full comparison lives in Vendors.
            </p>
          ) : null}
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
          <SectionHeader
            eyebrow="Movement"
            title="Vendor movers"
            aside={
              moversAll.length > movers.length
                ? `Showing ${count(movers.length)} of ${count(moversAll.length)} vendors with movement`
                : undefined
            }
          />
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {movers.map(({ v, moving }) => (
              <Panel key={v.ticker} className="px-5 py-4">
                <div className="font-medium" style={{ color: "var(--fg)" }}>
                  {v.name}
                </div>
                <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                  {moving.slice(0, 2).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 text-[0.94rem]">
                      <span className="eyebrow text-[0.72rem]">{m.label}</span>
                      <MovementText movement={m.movement} effect={displayState(m.id, m.state).effect} className="text-[0.9rem]" />
                      {m.headline ? (
                        <span className="w-full text-[0.9rem]" style={{ color: "var(--fg-muted)" }}>
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
          aside={
            developmentsAll.length > developments.length
              ? `Showing ${count(developments.length)} of ${count(developmentsAll.length)} dated developments`
              : "Dated and citable — no general news feed"
          }
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
                    <span className="code tabular text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                      {shortDate(d.date)}
                    </span>
                    <span className="font-medium" style={{ color: "var(--fg)" }}>
                      {d.vendor}
                    </span>
                    <span className="text-[0.96rem]" style={{ color: "var(--fg-muted)" }}>
                      {d.headline}
                      {d.tcvUsd != null ? ` · ${money(d.tcvUsd)}` : ""}
                      {d.detail ? ` · ${d.detail}` : ""}
                    </span>
                    {d.sourceUrl ? (
                      <a
                        href={d.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="code tap-link ml-auto text-[0.8rem]"
                        style={{ color: "var(--rail-ink)" }}
                      >
                        Source ↗
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 mb-0 text-[0.92rem]" style={{ color: "var(--fg-muted)" }}>
                    <span className="eyebrow mr-2 text-[0.68rem]">Why it matters</span>
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
