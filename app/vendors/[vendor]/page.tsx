import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { challengePoints } from "@/lib/metrics/challenge";
import { MetricCard } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import {
  BasisList,
  EmptyEvidence,
  Panel,
  SectionHeader,
} from "@/components/ui";
import { fetchAgRenewals } from "@/lib/adapters/decision-api";
import { getDevelopments, getVendorExposure } from "@/lib/data/facts";
import { count, formatTcvDisplay, money, monthsRemaining, shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { levelScore, type Metric, type VendorIntel } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

const CVD_LABEL: Record<string, string> = {
  "over-hyped": "Claims ahead of evidence",
  "under-recognized": "Delivers ahead of reputation",
  aligned: "Claims and delivery aligned",
};

/** Ranks the focal vendor against the selected market only — never a wider universe. */
function relativePosition(focal: VendorIntel, all: VendorIntel[]) {
  const rows: Array<{ label: string; rank: number; of: number }> = [];
  const rankBy = (label: string, score: (v: VendorIntel) => number | null) => {
    const scored = all
      .map((v) => ({ t: v.ticker, s: score(v) }))
      .filter((x): x is { t: string; s: number } => x.s != null);
    const mine = scored.find((x) => x.t === focal.ticker);
    if (!mine || scored.length < 2) return; // no ranking on insufficient evidence
    scored.sort((a, b) => b.s - a.s);
    rows.push({ label, rank: scored.findIndex((x) => x.t === focal.ticker) + 1, of: scored.length });
  };
  const stateScore = (m: Metric): number | null =>
    m.state === "insufficient" ? null : m.state === "favourable" ? 3 : m.state === "stable" ? 2 : m.state === "mixed" ? 1.5 : 1;
  rankBy("Commercial opportunity", (v) => (v.overall.level === "insufficient" ? null : levelScore(v.overall.level)));
  rankBy("Buyer leverage", (v) => stateScore(v.metrics.buyerLeverage));
  rankBy("Pricing conditions", (v) => stateScore(v.metrics.pricingPressure));
  rankBy("AI productivity opportunity", (v) => stateScore(v.metrics.aiProductivityOpportunity));
  rankBy("Financial resilience", (v) => stateScore(v.metrics.financialResilience));
  return rows;
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export default async function VendorDetail({
  params,
  searchParams,
}: {
  params: Promise<{ vendor: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ vendor }, sp] = await Promise.all([params, searchParams]);
  const ticker = vendor.toUpperCase();
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) return <PortalShell active="vendors" ctx={ctx} returnTo={`/vendors/${vendor}`}>{null}</PortalShell>;
  if (!ctx.universe.some((u) => u.ticker === ticker)) notFound();
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="vendors" ctx={ctx} returnTo={`/vendors/${vendor}`}>
        <FirstRunSelector ctx={ctx} returnTo={`/vendors/${vendor}`} />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const focal = intel.vendors.find((v) => v.ticker === ticker);
  const returnTo = `/vendors/${vendor}`;

  /* Opening a vendor never mutates the market scope (spec §6). Out-of-scope
     vendors get an explicit path to be ADDED, not a silent scope switch. */
  if (!focal) {
    const addUrl = `/select?vendors=${[...ctx.scope.vendorIds, ticker].join(",")}&return=${encodeURIComponent(returnTo)}`;
    const name = ctx.universe.find((u) => u.ticker === ticker)?.name ?? ticker;
    return (
      <PortalShell active="vendors" ctx={ctx} returnTo={returnTo}>
        <Panel hero className="mx-auto max-w-2xl px-8 py-9 text-center">
          <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>Outside your market</div>
          <h2 className="display mt-3 text-[1.5rem]" style={{ color: "var(--fg)" }}>
            {name} is not part of your selected vendor market.
          </h2>
          <p className="mx-auto mt-3 max-w-[50ch] text-[0.98rem]" style={{ color: "var(--fg-muted)" }}>
            Your market is {intel.scope.names.join(", ")}. Viewing a vendor never silently changes
            that scope — add them if they should be part of it.
          </p>
          <Link
            href={addUrl}
            className="tap mt-5 inline-flex rounded-md px-5 py-2 text-[0.98rem] font-semibold"
            style={{ background: "var(--accent-fill)", color: "#07142a" }}
          >
            Add {name} to your tracked vendors
          </Link>
        </Panel>
      </PortalShell>
    );
  }

  const [exposure, developments, agBriefs] = await Promise.all([
    getVendorExposure(ticker, 8),
    getDevelopments(ticker, 10),
    fetchAgRenewals(ticker, 12),
  ]);

  const m = focal.metrics;
  const ranks = relativePosition(focal, intel.vendors);
  const challenges = challengePoints(focal, intel.vendors);
  const comparedWith =
    intel.scope.mode === "whole_market"
      ? `the whole supported market (${intel.scope.names.length} vendors)`
      : intel.scope.names.join(", ");

  return (
    <PortalShell active="vendors" ctx={ctx} returnTo={returnTo}>
      <div className="mb-6">
        <div className="eyebrow">
          <Link href="/vendors" style={{ color: "var(--fg-dim)" }}>Vendors</Link> · {focal.ticker}
        </div>
        <h2 className="display mt-2 text-[2rem] leading-tight" style={{ color: "var(--fg)" }}>
          {focal.name}
        </h2>
        <p className="mt-1.5 mb-0 text-[0.96rem]" style={{ color: "var(--fg-muted)" }}>
          Compared with your market: {comparedWith}. {count(focal.coverage.contracts)} observed
          contracts on the market record · {count(focal.coverage.inPlay12)} reaching end-of-term
          within 12 months.
        </p>
      </div>

      <AnalystInsightHero intel={intel} tab="vendor-detail" focalTicker={ticker} />

      {/* LEAD FINDING (Phase 1). The same canonical differentiation object as
          before — previously a flat list of six equal bullets that answered the
          section's own question without ever leading. It now reads as one
          judgement, its supporting movement, and the single thing worth
          challenging, so the page states its reason to exist above the
          twelve supporting metric cards. */}
      {focal.differentiation ? (
        <section className="mt-10">
          <SectionHeader eyebrow="Lead finding" title="Why this vendor matters" />
          <Panel hero className="mt-5 px-6 py-6 sm:px-8">
            <p className="m-0 max-w-[62ch] text-[1.3rem] leading-snug font-medium" style={{ color: "var(--fg)" }}>
              {focal.differentiation.strongest}
            </p>

            {(() => {
              const support = [
                focal.differentiation.keyChange ? `Most important 12-month change: ${focal.differentiation.keyChange}` : null,
                // the "no unique leadership position" fallback says nothing in a
                // lead finding — carry it only where it is a real distinction
                focal.differentiation.relatives.find((r) => !/^No unique leadership/i.test(r)) ?? null,
                focal.differentiation.weakest,
              ].filter(Boolean) as string[];
              return support.length > 0 ? (
                <p className="mt-3.5 mb-0 max-w-[70ch] text-[1rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                  {support.join(" ")}
                </p>
              ) : null;
            })()}

            {focal.differentiation.risk ? (
              <p className="mt-2.5 mb-0 max-w-[70ch] text-[1rem] leading-relaxed" style={{ color: "var(--data-risk-ink)" }}>
                Current risk to the buyer: {focal.differentiation.risk}
              </p>
            ) : null}

            {focal.differentiation.discuss ? (
              <p
                className="mt-5 mb-0 max-w-[70ch] rounded-[var(--radius-sm)] px-4 py-3 text-[1rem] leading-relaxed"
                style={{ background: "var(--bg-elev-2)", color: "var(--fg)" }}
              >
                <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>Worth challenging</span>{" "}
                {focal.differentiation.discuss}
              </p>
            ) : null}

            <div className="code mt-4 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
              Derived from this vendor&apos;s canonical readings · scoped to your {count(intel.vendors.length)}-vendor market
              {intel.spine.dataAsOf ? ` · commercial evidence to ${shortDate(intel.spine.dataAsOf)}` : ""}
            </div>
          </Panel>
        </section>
      ) : null}

      {/* Remaining relative positions stay available, demoted below the lead. */}
      {focal.differentiation && focal.differentiation.relatives.length > 1 ? (
        <section className="mt-6">
          <Panel className="px-6 py-4">
            <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>Also distinctive</div>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[0.95rem]" style={{ color: "var(--fg-muted)" }}>
              {focal.differentiation.relatives.slice(1).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}

      {challenges.length > 0 ? (
        <section className="mt-10">
          <SectionHeader
            eyebrow="Commercial conversation"
            title="What to challenge"
            aside="Derived from this vendor's evidence and your selected market"
          />
          <Panel className="mt-5 px-6 py-5">
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {challenges.map((c, i) => (
                <li key={i} className="flex gap-4">
                  <span className="code shrink-0 text-[0.88rem]" style={{ color: "var(--accent-ink)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-[1.02rem] leading-snug font-medium" style={{ color: "var(--fg)" }}>
                      {c.point}
                    </p>
                    <p className="m-0 mt-1 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                      Because {c.because}.
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="code mt-4 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
              Discussion prompts from market evidence — the portal holds none of the reader's own contracts or spend.
            </div>
          </Panel>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionHeader eyebrow="Commercial position" title="Where the buyer stands" />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard m={m.buyerLeverage} />
          <MetricCard m={m.pricingPressure} />
          <MetricCard m={m.savingsOpportunity} />
          <MetricCard m={m.aiProductivityOpportunity} />
          <MetricCard m={m.gainShareOpportunity} />
          <MetricCard m={m.financialHeadroom} />
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Vendor health"
          title="Their condition"
          aside="Vendor quality — held separate from buyer leverage"
        />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard m={m.financialResilience} />
          <MetricCard m={m.providerMomentum} />
          <MetricCard m={m.talentPressure} />
          <MetricCard m={m.automationOpportunity} />
          <MetricCard m={m.operationalRisk} />
          <MetricCard m={m.reputationMovement} />
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="Relative position" title="Against your selected market" />
        <div className="mt-5">
          {ranks.length > 0 ? (
            <Panel>
              <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
                {ranks.map((r) => (
                  <li key={r.label} className="flex items-baseline gap-4 px-5 py-3">
                    <span className="w-64 font-medium" style={{ color: "var(--fg)" }}>{r.label}</span>
                    <span className="tabular text-[0.98rem]" style={{ color: "var(--fg-muted)" }}>
                      {ordinal(r.rank)} of {r.of} assessed vendors
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyEvidence
              title="No ranking is generated."
              body="Fewer than two vendors in your market carry sufficient evidence on comparable dimensions — a ranking would be manufactured."
            />
          )}
        </div>
      </section>

      {focal.claimsVsDelivery ? (
        <section className="mt-12">
          <SectionHeader
            eyebrow="AnalystGenius interpretation · market evidence"
            title="Claims vs delivery"
            aside={focal.claimsVsDelivery.asOf ? `AG analysis as of ${shortDate(focal.claimsVsDelivery.asOf)}` : undefined}
          />
          <Panel className="mt-5 px-6 py-5">
            <div className="font-medium" style={{ color: "var(--accent-ink)" }}>
              {focal.claimsVsDelivery.direction
                ? CVD_LABEL[focal.claimsVsDelivery.direction] ?? focal.claimsVsDelivery.direction
                : "Direction not stated"}
            </div>
            {focal.claimsVsDelivery.headline ? (
              <p className="mt-2 mb-0 max-w-[75ch] text-[1.02rem] leading-relaxed" style={{ color: "var(--fg)" }}>
                {focal.claimsVsDelivery.headline}
              </p>
            ) : null}
            <p className="code mt-3 mb-0 text-[0.78rem]" style={{ color: "var(--fg-dim)" }}>
              AG conclusion and direction only — the underlying assessment methodology is proprietary.
            </p>
          </Panel>
        </section>
      ) : null}

      <section className="mt-12">
        <SectionHeader
          eyebrow="Market record"
          title="Their expiring agreements"
          aside={
            exposure.length > 0 && focal.coverage.inPlay12 > exposure.length
              ? `Showing ${count(exposure.length)} of ${count(focal.coverage.inPlay12)} reaching end-of-term within 12 months`
              : "Their defensive position is your leverage"
          }
        />
        <p className="mt-2 mb-0 text-[0.9rem]" style={{ color: "var(--fg-dim)" }}>
          Observed agreements between {focal.name} and other organisations, from the public and
          curated market record. None of these are your contracts — the portal holds no buyer-owned
          contract data.
        </p>
        <div className="mt-4">
          {exposure.length > 0 ? (
            <Panel className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.95rem]">
                  <thead>
                    <tr>
                      <th className="eyebrow px-5 py-3 text-left font-semibold">Client</th>
                      <th className="eyebrow px-4 py-3 text-left font-semibold">Service line</th>
                      <th className="eyebrow px-4 py-3 text-right font-semibold">Total value</th>
                      <th className="eyebrow px-4 py-3 text-left font-semibold">End of term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposure.map((e, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                        <td className="px-5 py-2.5 font-medium" style={{ color: "var(--fg)" }}>{e.client}</td>
                        <td className="px-4 py-2.5" style={{ color: "var(--fg-muted)" }}>{e.line ?? "Unclassified"}</td>
                        <td className="tabular px-4 py-2.5 text-right" style={{ color: "var(--fg)" }}>
                          {formatTcvDisplay(e)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="mark-dir tabular"
                            style={{ color: e.daysRemaining <= 60 ? "var(--data-watch-ink)" : "var(--fg-muted)" }}
                          >
                            {shortDate(e.endDate)} · {monthsRemaining(e.daysRemaining)} remaining
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <EmptyEvidence
              title="Nothing of theirs reaches end-of-term inside 24 months."
              body="The contract spine holds no expiring agreements for this vendor in the window."
            />
          )}
          {agBriefs.status !== "ok" ? (
            <p className="code mt-2 mb-0 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
              AG renewal briefs: {agBriefs.reason}
            </p>
          ) : (
            <p className="code mt-2 mb-0 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
              AG decision service connected — {agBriefs.count} renewal brief{agBriefs.count === 1 ? "" : "s"} available for this vendor.
            </p>
          )}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader eyebrow="Supporting detail" title="Developments" />
        <div className="mt-5">
          {developments.length > 0 ? (
            <Panel>
              <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
                {developments.slice(0, 6).map((d, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3 text-[0.95rem]">
                    <span className="code tabular text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>{shortDate(d.date)}</span>
                    <span style={{ color: "var(--fg)" }}>{d.headline}</span>
                    {d.tcvUsd != null ? <span className="tabular" style={{ color: "var(--fg-muted)" }}>{money(d.tcvUsd)}</span> : null}
                    {d.detail ? <span style={{ color: "var(--fg-dim)" }}>{d.detail}</span> : null}
                    {d.sourceUrl ? (
                      <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="code tap-link ml-auto text-[0.8rem]" style={{ color: "var(--rail-ink)" }}>
                        Source ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : (
            <EmptyEvidence title="No dated developments on record." body="Nothing signed or filed touches this vendor in the trailing window." />
          )}
        </div>
      </section>

      <div className="mt-10">
        <BasisList
          basis={[
            {
              text: "Figures originate in the canonical record; states and rankings are computed against your selected market only.",
              source: "AnalystGenius Buyer Portal",
            },
          ]}
        />
      </div>
    </PortalShell>
  );
}
