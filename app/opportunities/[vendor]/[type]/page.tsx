import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { MetricCard } from "@/components/MetricCard";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import {
  BasisList,
  CONFIDENCE_LABEL,
  LevelText,
  ModelledTag,
  MovementText,
  Panel,
  SectionHeader,
} from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { levelEffect } from "@/lib/metrics/dictionary";
import { OPPORTUNITY_LABELS, OPPORTUNITY_TYPES, type OpportunityType } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** Which canonical metric underpins each opportunity type, for supporting detail. */
type MetricKey = Exclude<keyof import("@/lib/metrics/types").VendorMetrics, "gainShareLevelBand">;
const UNDERLYING: Record<OpportunityType, Array<MetricKey>> = {
  pricing: ["pricingPressure", "dealMarketHeat", "buyerLeverage"],
  automation: ["automationOpportunity", "talentPressure"],
  "gain-sharing": ["gainShareOpportunity", "aiProductivityOpportunity", "talentPressure"],
  "commercial-leverage": ["buyerLeverage", "dealMarketHeat"],
  "market-test": ["marketTestOpportunity", "buyerLeverage"],
};

export default async function OpportunityDetail({
  params,
  searchParams,
}: {
  params: Promise<{ vendor: string; type: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ vendor, type }, sp] = await Promise.all([params, searchParams]);
  const ticker = vendor.toUpperCase();
  if (!(OPPORTUNITY_TYPES as readonly string[]).includes(type)) notFound();
  const oppType = type as OpportunityType;

  const ctx = await getPortalContext(sp);
  const returnTo = `/opportunities/${vendor}/${type}`;
  if (!ctx.dbReady) return <PortalShell active="opportunities" ctx={ctx} returnTo={returnTo}>{null}</PortalShell>;
  if (!ctx.universe.some((u) => u.ticker === ticker)) notFound();
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="opportunities" ctx={ctx} returnTo={returnTo}>
        <FirstRunSelector ctx={ctx} returnTo={returnTo} />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const focal = intel.vendors.find((v) => v.ticker === ticker);
  if (!focal) {
    // Out of the selected market — same rule as vendor detail: no silent scope change.
    return (
      <PortalShell active="opportunities" ctx={ctx} returnTo={returnTo}>
        <Panel hero className="mx-auto max-w-xl px-8 py-8 text-center">
          <p className="m-0 text-[1.03rem]" style={{ color: "var(--fg-muted)" }}>
            This vendor is not part of your selected market.{" "}
            <Link href="/opportunities" style={{ color: "var(--accent-ink)" }}>
              Back to opportunities
            </Link>
          </p>
        </Panel>
      </PortalShell>
    );
  }

  const opp = focal.opportunities[oppType];

  return (
    <PortalShell active="opportunities" ctx={ctx} returnTo={returnTo}>
      <div className="mb-6">
        <div className="eyebrow">
          <Link href="/opportunities" style={{ color: "var(--fg-dim)" }}>
            Opportunities
          </Link>{" "}
          · {focal.name}
        </div>
        <h2 className="display mt-2 text-[2rem] leading-tight" style={{ color: "var(--fg)" }}>
          {OPPORTUNITY_LABELS[oppType]} — {focal.name}
        </h2>
      </div>

      <Panel hero className="px-6 py-6 sm:px-9 sm:py-7">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <LevelText level={opp.level} className="display text-[1.9rem]" />
          <MovementText movement={opp.movement} effect={levelEffect(opp.level)} className="text-[1.03rem]" />
          <span className="eyebrow">Confidence: {CONFIDENCE_LABEL[opp.confidence]}</span>
          {opp.modelled ? <ModelledTag note={opp.modelled} /> : null}
        </div>
        {opp.reason ? (
          <p className="mt-3 mb-0 max-w-[74ch] text-[1.02rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            {opp.reason}
          </p>
        ) : null}
        {opp.level === "insufficient" ? (
          <p className="mt-4 mb-0 max-w-[70ch] text-[1.03rem]" style={{ color: "var(--fg-muted)" }}>
            Insufficient evidence for a reliable {OPPORTUNITY_LABELS[oppType].toLowerCase()} assessment.
            This is a legitimate state — the portal does not estimate past the record.
          </p>
        ) : null}
      </Panel>

      <div className="mt-8">
        <AnalystInsightHero intel={intel} tab="opportunity-detail" focalTicker={focal.ticker} />
      </div>

      {opp.why.length > 0 ? (
        <section className="mt-10">
          <SectionHeader eyebrow="Evidence" title="Why this opportunity exists" />
          <Panel className="mt-5 px-6 py-5">
            <BasisList basis={opp.why} />
          </Panel>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionHeader eyebrow="Retrospective" title="12-month change" />
        <Panel className="mt-5 px-6 py-5">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <MovementText movement={opp.movement} effect={levelEffect(opp.level)} className="text-[1.03rem]" />
            <span className="text-[0.97rem]" style={{ color: "var(--fg-muted)" }}>
              {opp.movement === "insufficient"
                ? `No direction is held for this opportunity yet${intel.signalTrackingSince ? ` — AG signal tracking began ${shortDate(intel.signalTrackingSince)}` : ""}.`
                : `Direction observed across the held windows; a full 12-month series builds as the intelligence refreshes (baseline ${shortDate(intel.baselineStart)}).`}
            </span>
          </div>
        </Panel>
      </section>

      {opp.investigate.length > 0 ? (
        <section className="mt-10">
          <SectionHeader eyebrow="Action" title="What to investigate or discuss" />
          <Panel className="mt-5 px-6 py-5">
            <ul className="m-0 list-none space-y-2.5 p-0">
              {opp.investigate.map((line, i) => (
                <li key={i} className="flex gap-3 text-[1.02rem]" style={{ color: "var(--fg)" }}>
                  <span aria-hidden="true" style={{ color: "var(--accent-ink)" }}>
                    →
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 mb-0 text-[0.92rem]" style={{ color: "var(--fg-dim)" }}>
              AnalystGenius does not hold your contract terms. Nothing here asserts what your
              agreements contain — these are areas the market evidence says are worth pressing.
            </p>
          </Panel>
        </section>
      ) : null}

      <section className="mt-10">
        <SectionHeader eyebrow="Supporting detail" title="Underlying canonical readings" />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {UNDERLYING[oppType].map((k) => (
            <MetricCard key={k} m={focal.metrics[k]} />
          ))}
        </div>
      </section>
    </PortalShell>
  );
}
