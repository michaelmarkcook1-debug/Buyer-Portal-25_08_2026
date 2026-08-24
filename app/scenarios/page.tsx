import Link from "next/link";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { InfoTip, COLOUR_KEY } from "@/components/InfoTip";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { LevelText, ModelledTag, Panel, SectionHeader } from "@/components/ui";
import type { RawSearchParams } from "@/lib/market-scope";
import { levelScore, OPPORTUNITY_LABELS, OPPORTUNITY_TYPES } from "@/lib/metrics/types";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import { getPortalContext } from "@/lib/portal";
import { applyScenario, getScenario, scenarioRead, SCENARIOS } from "@/lib/scenarios";

export const dynamic = "force-dynamic";

/**
 * SCENARIOS — predefined only (spec §16). A scenario recalculates canonical
 * states under a stated assumption; every adjusted value is marked modelled.
 */
export default async function ScenariosPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);
  const rawS = Array.isArray(sp.s) ? sp.s[0] : sp.s;
  const scenario = getScenario(rawS);
  const returnTo = scenario ? `/scenarios?s=${scenario.id}` : "/scenarios";

  if (!ctx.dbReady) return <PortalShell active="scenarios" ctx={ctx} returnTo={returnTo}>{null}</PortalShell>;
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="scenarios" ctx={ctx} returnTo={returnTo}>
        <FirstRunSelector ctx={ctx} returnTo={returnTo} />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const result = scenario ? applyScenario(intel, scenario) : null;
  const scenarioIntel = result ? { ...intel, vendors: result.vendors } : null;

  return (
    <PortalShell active="scenarios" ctx={ctx} returnTo={returnTo}>
      {scenario && scenarioIntel ? (
        <AnalystInsightHero intel={scenarioIntel} tab="scenarios" scenario={scenario} />
      ) : (
        /* Default state (sprint 3 fix 2): a real Analyst Insight on the
           baseline's scenario SENSITIVITY — which variable could most change
           the buyer's position — before any scenario is chosen. */
        <AnalystInsightHero intel={intel} tab="scenarios" />
      )}

      <section className="mt-8">
        <SectionHeader eyebrow="Predefined" title="Choose a scenario" />
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => {
            const active = scenario?.id === s.id;
            return (
              <Link key={s.id} href={active ? "/scenarios" : `/scenarios?s=${s.id}`} className="group">
                <Panel
                  className="h-full px-4 py-4 transition-transform"
                  hero={active}
                >
                  <div
                    className="font-medium"
                    style={{ color: active ? "var(--accent-ink)" : "var(--fg)" }}
                  >
                    {s.label}
                  </div>
                  <p className="mt-1.5 mb-0 text-[0.9rem] leading-snug" style={{ color: "var(--fg-muted)" }}>
                    {s.question}
                  </p>
                  <div className="code mt-2.5 text-[0.74rem]" style={{ color: "var(--fg-dim)" }}>
                    {active ? "Active — select to clear" : `Adjusts: ${s.adjusts.join(" · ")}`}
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      </section>

      {scenario && result ? (() => {
        const read = scenarioRead(intel, result);
        return (
          <section className="mt-6">
            <Panel className="px-6 py-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>Scenario read</span>
                <ModelledTag note={`Modelled under: ${scenario.assumes}`} />
              </div>
              <p className="mt-3 mb-0 max-w-[78ch] text-[1.02rem] leading-relaxed" style={{ color: "var(--fg)" }}>
                {read.note}
              </p>
              <p className="mt-2 mb-0 text-[0.9rem]" style={{ color: "var(--fg-muted)" }}>
                Most affected: {read.mostAffected ? read.mostAffected.name : "none"} · Family moving most:{" "}
                {read.familyMoved ?? "none"} · Buyer relative position: {read.position}.
              </p>
            </Panel>
          </section>
        );
      })() : null}

      {scenario && result ? (
        <>
          <section className="mt-10">
            <Panel className="px-6 py-4" >
              <div className="flex flex-wrap items-center gap-3">
                <ModelledTag note="Scenario outputs are recalculated states, not new evidence." />
                <span className="text-[0.98rem]" style={{ color: "var(--fg)" }}>
                  Assumes: {scenario.assumes}
                </span>
              </div>
              <p className="mt-2 mb-0 text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
                The scenario remains scoped to your selected vendor market. Baseline evidence is
                unchanged; only the stated states shift, and each shifted value carries the modelled mark.
              </p>
            </Panel>
          </section>

          <section className="mt-10">
            <SectionHeader eyebrow="Impact" title="Vendor position under this scenario" />
            <div className="mt-5">
              <Panel className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[0.95rem]">
                    <thead>
                      <tr>
                        <th className="eyebrow px-5 py-3 text-left font-semibold">Vendor</th>
                        <th className="eyebrow px-4 py-3 text-left font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            Baseline → scenario
                            <InfoTip content={{
                              name: "Modelled scenario outputs",
                              definition: "What the selected assumption would do to each vendor's overall commercial opportunity band, relative to today's baseline.",
                              interpretation: "These are MODELLED values recalculated from the current evidence — not new evidence and not a forecast. Read the most-shifted opportunity column for what actually moves.",
                              caveat: "A band that does not move can still sit over real movement inside the opportunity families.",
                              colour: COLOUR_KEY,
                            }} />
                          </span>
                        </th>
                        <th className="eyebrow px-4 py-3 text-left font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            Rank move
                            <InfoTip content={{
                              name: "Rank move",
                              definition: "How far this vendor moves up or down the where-to-look-first order under the scenario.",
                              interpretation: "Movement shows which vendors your priorities are most sensitive to. No move means the scenario does not change where you would start.",
                              caveat: "Rank orders where to look, not how much value is available.",
                              colour: "Teal marks a vendor rising toward the top of your list, red a vendor falling down it; no movement is stated in words.",
                            }} />
                          </span>
                        </th>
                        <th className="eyebrow px-4 py-3 text-left font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            Most-shifted opportunity
                            <InfoTip content={{
                              name: "Most-shifted opportunity",
                              definition: "The opportunity family that moves furthest for this vendor under the scenario.",
                              interpretation: "This is where the assumption bites hardest — the lever to test first if you think the scenario is plausible.",
                              caveat: "The family that moves most is not necessarily the largest one.",
                              colour: COLOUR_KEY,
                            }} />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.vendors.map((v) => {
                        const baseline = intel.vendors.find((b) => b.ticker === v.ticker);
                        const move = result.rankMoves.get(v.ticker) ?? 0;
                        const shifted = OPPORTUNITY_TYPES
                          .map((t) => ({
                            t,
                            d: levelScore(v.opportunities[t].level) - levelScore(baseline?.opportunities[t].level ?? "insufficient"),
                          }))
                          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
                        return (
                          <tr key={v.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                            <td className="px-5 py-3 font-medium" style={{ color: "var(--fg)" }}>
                              {v.name}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-2">
                                <LevelText level={baseline?.overall.level ?? "insufficient"} className="text-[0.94rem]" />
                                <span aria-hidden="true" style={{ color: "var(--fg-dim)" }}>→</span>
                                <LevelText level={v.overall.level} className="text-[0.94rem]" />
                              </span>
                            </td>
                            <td className="tabular px-4 py-3">
                              {move > 0 ? (
                                <span style={{ color: "var(--data-positive-ink)" }}>▲ {move}</span>
                              ) : move < 0 ? (
                                <span style={{ color: "var(--data-risk-ink)" }}>▼ {Math.abs(move)}</span>
                              ) : (
                                <span style={{ color: "var(--fg-dim)" }}>—</span>
                              )}
                            </td>
                            <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                              {shifted && shifted.d !== 0
                                ? `${OPPORTUNITY_LABELS[shifted.t]} ${shifted.d > 0 ? "up" : "down"} one band`
                                : "No band shift"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* §6: where every vendor already sits in the top band, the
                    overall column cannot move. Say so once, beneath the table,
                    rather than repeating it on every row. */}
                {result.vendors.length > 0
                  && result.vendors.every((v) => {
                    const base = intel.vendors.find((b) => b.ticker === v.ticker);
                    return v.overall.level === "very-high" && base?.overall.level === "very-high";
                  }) ? (
                  <p className="m-0 border-t px-5 py-3 text-[0.9rem]" style={{ color: "var(--fg-dim)", borderColor: "var(--surface-line-soft)" }}>
                    Overall opportunity stays Very High because these vendors were already in the top
                    band — read the family column for what this scenario actually moves.
                  </p>
                ) : null}
              </Panel>
            </div>
          </section>
        </>
      ) : null}
    </PortalShell>
  );
}
