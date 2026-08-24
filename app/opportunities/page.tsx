import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { DistributionChart, levelInk } from "@/components/charts/Charts";
import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { LEVEL_VOCABULARY, METRIC_DICTIONARY } from "@/lib/metrics/dictionary";
import { EmptyEvidence, LevelText, MovementText, Panel, SectionHeader } from "@/components/ui";
import { count, shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import {
  OPPORTUNITY_LABELS,
  OPPORTUNITY_TYPES,
  levelScore,
  type MarketIntel,
  type OpportunityType,
  type VendorIntel,
} from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";


/** Opportunity family -> metric-dictionary key, so each column header can
 *  carry one info affordance explaining that family's scale. */
const FAMILY_DICT: Record<string, string> = {
  pricing: "pricingOpportunity",
  automation: "automationOpportunity",
  "gain-sharing": "gainShareOpportunity",
  "commercial-leverage": "buyerLeverage",
  "market-test": "marketTestOpportunity",
};

export const dynamic = "force-dynamic";

/** Distribution of one opportunity type across the scoped vendors — presentation only. */
function distribution(intel: MarketIntel, type: OpportunityType | "overall") {
  const levels = intel.vendors.map((v) => (type === "overall" ? v.overall.level : v.opportunities[type].level));
  const assessed = levels.filter((l) => l !== "insufficient");
  const highPlus = assessed.filter((l) => l === "high" || l === "very-high").length;
  const best = assessed.length ? assessed.reduce((a, b) => (levelScore(b) > levelScore(a) ? b : a)) : "insufficient";
  return { assessed: assessed.length, total: levels.length, highPlus, best } as const;
}


/**
 * The ranked opportunity table. Extracted so the curated view and the full
 * covered universe render from ONE definition — at Whole Market scale the
 * page shows the leading rows and keeps every remaining vendor one explicit
 * disclosure away, with no second copy of this markup to drift.
 */
function RankedOpportunityTable({ rows }: { rows: VendorIntel[] }) {
  return (
                <Panel className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[0.95rem]">
                      <thead>
                        <tr>
                          <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
                          <th className="eyebrow px-4 py-3 text-left font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              Overall
                              <InfoTip content={fromSemantics(METRIC_DICTIONARY["commercialOpportunity"]!)} />
                            </span>
                          </th>
                          {OPPORTUNITY_TYPES.map((t) => (
                            <th key={t} className="eyebrow px-4 py-3 text-left font-semibold">
                              <span className="inline-flex items-center gap-1.5">
                                {OPPORTUNITY_LABELS[t]}
                                {FAMILY_DICT[t] && METRIC_DICTIONARY[FAMILY_DICT[t]!] ? (
                                  <InfoTip content={fromSemantics(METRIC_DICTIONARY[FAMILY_DICT[t]!]!)} />
                                ) : null}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((v, i) => (
                          <tr key={v.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                            <td className="px-5 py-3">
                              <Link
                                href={`/vendors/${v.ticker.toLowerCase()}`}
                                className="group inline-flex items-baseline gap-2.5"
                              >
                                {/* Gold marks rank POSITION — never the state value.
                                    This is the emphasis the ranking legitimately
                                    earns; the level keeps its buyer-effect colour. */}
                                <span
                                  className={`code tabular w-5 text-right text-[0.8rem] ${i === 0 ? "font-bold" : ""}`}
                                  style={{ color: i === 0 ? "var(--accent-ink)" : "var(--fg-dim)" }}
                                >
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
                              <div className="flex flex-col gap-1">
                                <LevelText level={v.overall.level} emphasis={i === 0} />
                                {v.overall.reason ? (
                                  <span className="max-w-[36ch] text-[0.82rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
                                    {v.overall.reason}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            {(() => {
                              /* Each vendor's DOMINANT lever carries typographic
                                 emphasis (weight + hairline rule). Colour stays
                                 semantic — emphasis marks position, never meaning. */
                              const scored = OPPORTUNITY_TYPES.map((t) => ({ t, s: levelScore(v.opportunities[t].level) })).sort((a, b) => b.s - a.s);
                              const dominant = scored[0]!.s > (scored[1]?.s ?? -1) ? scored[0]!.t : null;
                              return OPPORTUNITY_TYPES.map((t) => (
                                <td key={t} className="px-4 py-3">
                                  <Link
                                    href={`/opportunities/${v.ticker.toLowerCase()}/${t}`}
                                    className="tap-link underline-offset-4 hover:underline"
                                    style={{ textDecorationColor: "var(--accent-fill)" }}
                                  >
                                    <LevelText level={v.opportunities[t].level} className="text-[0.94rem]" emphasis={t === dominant} />
                                  </Link>
                                </td>
                              ));
                            })()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
  );
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
  /* Whole Market previously rendered all 66 ranked rows with no disclosure —
     346 colour chips in one table. The distribution answers "what shape is the
     market"; the ranked rows answer "who first". Both stay, in that order. */
  const isWhole = ctx.scope.mode === "whole_market";
  const RANKED_ROWS = 12;
  const rankedShown = isWhole ? intel.vendors.slice(0, RANKED_ROWS) : intel.vendors;
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
        <Panel className="px-0 py-0">
          <div className="grid grid-cols-2 lg:grid-cols-5">
            {stripTypes.map(({ key, label }, i) => {
              const d = distribution(intel, key);
              return (
                <div
                  key={key}
                  className="flex min-w-0 flex-col gap-1 px-5 py-4"
                  style={i > 0 ? { borderLeft: "1px solid var(--surface-line-soft)" } : undefined}
                >
                  <div className="eyebrow">{label}</div>
                  <LevelText level={d.best} className="text-[1.1rem]" />
                  <p className="m-0 text-[0.84rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
                    {d.assessed === 0
                      ? "No vendor carries sufficient evidence."
                      : `${d.highPlus} of ${d.assessed} assessed at High or above.`}
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>

      {/* CHART 3 — market shape across every covered vendor, before the ranking. */}
      {isWhole && anyAssessed ? (
        <section className="mt-12">
          <SectionHeader
            eyebrow="Market shape"
            title="How opportunity is distributed"
            aside={`Across ${count(intel.vendors.length)} covered vendors`}
          />
          <div className="mt-5">
            <Panel className="px-6 py-5">
              <DistributionChart
                total={intel.vendors.length}
                rows={[
                  { dimension: "Overall commercial opportunity", pick: (v: (typeof intel.vendors)[number]) => v.overall.level },
                  ...OPPORTUNITY_TYPES.map((t) => ({
                    dimension: OPPORTUNITY_LABELS[t],
                    pick: (v: (typeof intel.vendors)[number]) => v.opportunities[t].level,
                  })),
                ].map((row) => ({
                  dimension: row.dimension,
                  bands: (["very-high", "high", "medium", "low", "insufficient"] as const).map((lv) => ({
                    label: LEVEL_VOCABULARY[lv],
                    count: intel.vendors.filter((v) => row.pick(v) === lv).length,
                    ink: levelInk(lv),
                  })),
                }))}
                interpretation={(() => {
                  const strong = intel.vendors.filter((v) => v.overall.level === "very-high" || v.overall.level === "high").length;
                  const thin = intel.vendors.filter((v) => v.overall.level === "insufficient").length;
                  return `${count(strong)} of ${count(intel.vendors.length)} covered vendors read High or above on overall commercial opportunity${
                    thin > 0 ? `, and ${count(thin)} lack sufficient evidence to place at all` : ""
                  }. Read the shape first, then the ranking below for where to start.`;
                })()}
                footnote="Opportunity families across the covered market · same readings as the ranked table below"
              />
            </Panel>
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <SectionHeader
          eyebrow="Ranked"
          title="Where buyer value sits"
          aside={isWhole ? `Top ${count(RANKED_ROWS)} of ${count(intel.vendors.length)} — highest buyer opportunity first` : "Highest buyer opportunity first"}
        />
        <div className="mt-5">
          {anyAssessed ? (
<>
              <RankedOpportunityTable rows={rankedShown} />
              {isWhole && intel.vendors.length > rankedShown.length ? (
                <details className="mt-4">
                  <summary
                    className="tap cursor-pointer text-[0.95rem] underline-offset-4 hover:underline"
                    style={{ color: "var(--accent-ink)" }}
                  >
                    Show all {count(intel.vendors.length)} vendors
                  </summary>
                  <div className="mt-4">
                    <RankedOpportunityTable rows={intel.vendors} />
                  </div>
                </details>
              ) : null}
            </>
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
                    <span className="text-[0.94rem] italic" style={{ color: "var(--fg-dim)" }}>
                      No movement the record can support
                      {intel.signalTrackingSince ? ` — tracking since ${shortDate(intel.signalTrackingSince)}` : ""}
                    </span>
                  ) : (
                    <>
                      {tm.up > 0 ? (
                        <MovementText movement="improving" className="text-[0.94rem]" />
                      ) : null}
                      <span className="text-[0.94rem]" style={{ color: "var(--fg-muted)" }}>
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
