import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { EmptyEvidence, LevelText, MovementText, Panel, SectionHeader } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import {
  OPPORTUNITY_LABELS,
  OPPORTUNITY_TYPES,
  levelScore,
  type MarketIntel,
  type OpportunityType,
} from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";

export const dynamic = "force-dynamic";

/** Distribution of one opportunity type across the scoped vendors — presentation only. */
function distribution(intel: MarketIntel, type: OpportunityType | "overall") {
  const levels = intel.vendors.map((v) => (type === "overall" ? v.overall.level : v.opportunities[type].level));
  const assessed = levels.filter((l) => l !== "insufficient");
  const highPlus = assessed.filter((l) => l === "high" || l === "very-high").length;
  const best = assessed.length ? assessed.reduce((a, b) => (levelScore(b) > levelScore(a) ? b : a)) : "insufficient";
  return { assessed: assessed.length, total: levels.length, highPlus, best } as const;
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) return <PortalShell active="opportunities" ctx={ctx} returnTo="/opportunities">{null}</PortalShell>;
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="opportunities" ctx={ctx} returnTo="/opportunities">
        <FirstRunSelector ctx={ctx} returnTo="/opportunities" />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const stripTypes: Array<{ key: OpportunityType | "overall"; label: string }> = [
    { key: "overall", label: "Overall Opportunity" },
    { key: "pricing", label: "Pricing Opportunity" },
    { key: "automation", label: "Automation Opportunity" },
    { key: "gain-sharing", label: "Gain-Sharing Opportunity" },
    { key: "market-test", label: "Market-Test Opportunity" },
  ];

  const anyAssessed = distribution(intel, "overall").assessed > 0;

  /* Per-type movement tallies across vendors — the 12-month opportunity view. */
  const typeMovement = OPPORTUNITY_TYPES.map((t) => {
    const moves = intel.vendors.map((v) => v.opportunities[t].movement);
    const up = moves.filter((mv) => mv.includes("improving")).length;
    const down = moves.filter((mv) => mv.includes("deteriorating")).length;
    return { type: t, up, down };
  });

  return (
    <PortalShell active="opportunities" ctx={ctx} returnTo="/opportunities">
      <AnalystInsightHero intel={intel} tab="opportunities" />

      <section className="mt-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stripTypes.map(({ key, label }) => {
            const d = distribution(intel, key);
            return (
              <Panel key={key} className="flex min-w-0 flex-col gap-1.5 px-4 py-4">
                <div className="eyebrow">{label}</div>
                <LevelText level={d.best} className="text-[1.02rem]" />
                <p className="m-0 text-[0.78rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
                  {d.assessed === 0
                    ? "No vendor carries sufficient evidence."
                    : `${d.highPlus} of ${d.assessed} assessed vendors at High or above.`}
                </p>
              </Panel>
            );
          })}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Ranked"
          title="Where buyer value sits"
          aside="Highest buyer opportunity first"
        />
        <div className="mt-5">
          {anyAssessed ? (
            <Panel className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.86rem]">
                  <thead>
                    <tr>
                      <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
                      <th className="eyebrow px-4 py-3 text-left font-semibold">Overall</th>
                      {OPPORTUNITY_TYPES.map((t) => (
                        <th key={t} className="eyebrow px-4 py-3 text-left font-semibold">
                          {OPPORTUNITY_LABELS[t]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {intel.vendors.map((v, i) => (
                      <tr key={v.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                        <td className="px-5 py-3">
                          <Link
                            href={`/vendors/${v.ticker.toLowerCase()}`}
                            className="group inline-flex items-baseline gap-2.5"
                          >
                            <span className="code tabular w-5 text-right text-[0.7rem]" style={{ color: "var(--fg-dim)" }}>
                              {i + 1}
                            </span>
                            <span
                              className="font-medium underline-offset-4 group-hover:underline"
                              style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
                            >
                              {v.name}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <LevelText level={v.overall.level} />
                        </td>
                        {OPPORTUNITY_TYPES.map((t) => (
                          <td key={t} className="px-4 py-3">
                            <Link
                              href={`/opportunities/${v.ticker.toLowerCase()}/${t}`}
                              className="underline-offset-4 hover:underline"
                              style={{ textDecorationColor: "var(--accent-fill)" }}
                            >
                              <LevelText level={v.opportunities[t].level} className="text-[0.84rem]" />
                            </Link>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <EmptyEvidence
              title="No high-confidence buyer opportunities identified at present."
              body="Opportunity levels appear only where the record carries sufficient evidence. Widen the vendor selection, or return once the intelligence refreshes."
            />
          )}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeader
          eyebrow="Retrospective"
          title="12-month opportunity change"
          aside={`Baseline ${shortDate(intel.baselineStart)}`}
        />
        <div className="mt-5">
          <Panel>
            <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
              {typeMovement.map((tm) => (
                <li key={tm.type} className="flex flex-wrap items-baseline gap-x-5 px-5 py-3">
                  <span className="w-48 font-medium" style={{ color: "var(--fg)" }}>
                    {OPPORTUNITY_LABELS[tm.type]}
                  </span>
                  {tm.up === 0 && tm.down === 0 ? (
                    <span className="text-[0.84rem] italic" style={{ color: "var(--fg-dim)" }}>
                      No movement the record can support
                      {intel.signalTrackingSince ? ` — tracking since ${shortDate(intel.signalTrackingSince)}` : ""}
                    </span>
                  ) : (
                    <>
                      {tm.up > 0 ? (
                        <MovementText movement="improving" className="text-[0.84rem]" />
                      ) : null}
                      <span className="text-[0.84rem]" style={{ color: "var(--fg-muted)" }}>
                        {tm.up} vendor{tm.up === 1 ? "" : "s"} improving · {tm.down} deteriorating
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>
    </PortalShell>
  );
}
