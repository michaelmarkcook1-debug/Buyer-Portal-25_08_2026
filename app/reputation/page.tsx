import type { Metadata } from "next";
import { AnalystInsightHero } from "@/components/AnalystInsightHero";
import { InfoTip, fromSemantics } from "@/components/InfoTip";
import { FirstRunSelector, PortalShell } from "@/components/PortalShell";
import { EFFECT_INK, Hairline, Panel, SectionHeader, StateText } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { RawSearchParams } from "@/lib/market-scope";
import { METRIC_DICTIONARY, displayState } from "@/lib/metrics/dictionary";
import { resolveIntelligence } from "@/lib/metrics/resolve";
import type { Metric, MetricState } from "@/lib/metrics/types";
import { getPortalContext } from "@/lib/portal";

export const metadata: Metadata = { title: "Reputation — AnalystGenius" };

/**
 * REPUTATION — how the market reads these vendors, and where that reading
 * diverges from what they claim.
 *
 * This tab answers a question the others do not. Market covers commercial
 * conditions, Vendors covers divergence in buyer opportunity; this covers
 * PERCEPTION — reputation movement, talent pressure and the gap between stated
 * positioning and delivery evidence.
 *
 * FIREWALL. The underlying AG tracker holds numeric sentiment, risk and gap
 * scores. None of them appear here. Every reading renders as a semantic state
 * from the metric dictionary, exactly as elsewhere in the portal, because those
 * scores are proprietary and a buyer cannot audit them.
 *
 * Reputation is a WATCH signal about market perception. It is never a finding
 * about delivery quality on the buyer's own account, and the copy says so.
 */

interface Finding {
  eyebrow: string;
  title: string;
  body: string;
  evidence: string;
  action: string;
  state: MetricState;
}

const STATE_RANK: Record<MetricState, number> = {
  favourable: 2,
  stable: 1,
  mixed: 0,
  unfavourable: -1,
  insufficient: -2,
};

/** Label a metric through the dictionary, never through a raw score. */
function stateWord(m: Metric): string {
  return displayState(m.id, m.state).label;
}

/** Semantic ink for a finding, resolved through the same dictionary. */
function findingInk(state: MetricState): string {
  return EFFECT_INK[displayState("reputationMovement", state).effect];
}

/**
 * The three findings are DERIVED, not written: each one counts or compares
 * held readings and says only what those readings support. Where the evidence
 * does not carry a finding, the finding says that rather than reaching.
 */
/** What Reputation reads: canonical states plus the AG perception narrative. */
type VendorRow = {
  ticker: string;
  name: string;
  metrics: Record<string, Metric>;
  perception?: { summary: string | null; earlyWarnings: string[]; asOf: string | null } | null;
};

function buildFindings(
  vendors: VendorRow[],
): Finding[] {
  const rep = vendors.map((v) => ({ v, m: v.metrics.reputationMovement })).filter((x) => x.m);
  const assessed = rep.filter((x) => x.m.state !== "insufficient");

  /* 1 — the market-level condition. */
  const improving = assessed.filter((x) => x.m.state === "favourable").length;
  const eroding = assessed.filter((x) => x.m.state === "unfavourable").length;
  const holding = assessed.length - improving - eroding;
  const dominant: MetricState =
    eroding > improving && eroding >= holding ? "unfavourable" : improving > eroding && improving >= holding ? "favourable" : "stable";
  const marketFinding: Finding = {
    eyebrow: "Market perception",
    title:
      assessed.length === 0
        ? "No reputation reading is held for the selected vendors"
        : dominant === "unfavourable"
          ? "Perception is eroding across more of this market than it is improving"
          : dominant === "favourable"
            ? "Perception is improving across more of this market than it is eroding"
            : "Perception is broadly holding across this market",
    body:
      assessed.length === 0
        ? "The reputation tracker carries no assessable reading for these vendors, so this tab cannot characterise market perception."
        : `Of ${assessed.length} vendors with an assessable reading, ${improving} are improving, ${holding} are holding and ${eroding} are eroding. That distribution — not any single vendor — is what characterises the market right now.`,
    evidence: `AnalystGenius reputation tracker${rep.length > assessed.length ? `; ${rep.length - assessed.length} vendor(s) held as insufficient evidence` : ""}.`,
    action:
      assessed.length === 0
        ? "Treat perception as unknown for these vendors rather than assuming stability."
        : "Use this as the backdrop for renewal timing: a market where perception is moving is one where vendors are more responsive to being challenged.",
    state: assessed.length === 0 ? "insufficient" : dominant,
  };

  /* 2 — divergence: the widest separation on the same axis. */
  const ranked = [...assessed].sort((a, b) => STATE_RANK[b.m.state] - STATE_RANK[a.m.state]);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const diverges = Boolean(best && worst && best.v.ticker !== worst.v.ticker && STATE_RANK[best.m.state] > STATE_RANK[worst.m.state]);
  const divergenceFinding: Finding = {
    eyebrow: "Divergence",
    title: diverges
      ? `${best!.v.name} and ${worst!.v.name} sit at opposite ends of the same signal`
      : assessed.length > 0
        ? "The selected vendors do not diverge materially on perception"
        : "Divergence cannot be assessed",
    body: diverges
      ? `${best!.v.name} reads ${stateWord(best!.m).toLowerCase()} while ${worst!.v.name} reads ${stateWord(worst!.m).toLowerCase()}. Two vendors in the same market, on the same measure, moving in opposite directions is a reason to treat them differently in a negotiation — not a reason to prefer one.`
      : assessed.length > 0
        ? `All ${assessed.length} assessable vendors read within one state of each other, so perception is not currently a differentiator across this market.`
        : "No vendor carries an assessable reputation reading.",
    evidence: diverges
      ? `Reputation movement, ${stateWord(best!.m)} vs ${stateWord(worst!.m)}.`
      : "Reputation movement across the selected vendors.",
    action: diverges
      ? `Ask ${worst!.v.name} what changed and what they are doing about it. A vendor that can answer that precisely is managing it; one that cannot may not have noticed.`
      : "Look to commercial and delivery evidence for differentiation instead.",
    state: diverges ? worst!.m.state : assessed.length > 0 ? "stable" : "insufficient",
  };

  /* 3 — claims against delivery evidence. */
  const gaps = vendors
    .map((v) => ({ v, m: v.metrics.operationalRisk }))
    .filter((x) => x.m && x.m.state === "unfavourable");
  const pressure = vendors
    .map((v) => ({ v, m: v.metrics.talentPressure }))
    .filter((x) => x.m && x.m.state === "unfavourable");
  const claimsFinding: Finding = {
    eyebrow: "Claims against delivery",
    title:
      gaps.length > 0
        ? `${gaps.length} vendor${gaps.length === 1 ? " carries" : "s carry"} delivery-side strain worth testing against their positioning`
        : pressure.length > 0
          ? `Delivery strain is not evident, but ${pressure.length} vendor${pressure.length === 1 ? " carries" : "s carry"} talent pressure`
          : "Nothing in held evidence contradicts what these vendors claim",
    body:
      gaps.length > 0
        ? `${gaps.slice(0, 3).map((x) => x.v.name).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""} show${gaps.length === 1 ? "s" : ""} strain on the delivery-side reading while presenting to the market on capability. That is a question to put to them, not a conclusion about your own account.`
        : pressure.length > 0
          ? `${pressure.slice(0, 3).map((x) => x.v.name).join(", ")} show talent pressure. Talent strain often precedes delivery strain, so it is worth watching before it becomes a service conversation.`
          : "No vendor in this selection shows delivery-side or talent strain that would contradict its market positioning.",
    evidence: "Delivery-side and talent readings held for the selected vendors.",
    action:
      gaps.length > 0 || pressure.length > 0
        ? "In your next review, ask for named evidence on the accounts nearest yours in scale and scope — not case studies."
        : "No specific challenge is indicated by perception evidence this period.",
    state: gaps.length > 0 ? "unfavourable" : pressure.length > 0 ? "mixed" : "stable",
  };

  /* §21/§22 — AG stakeholder tracking is held for every vendor and was
     extracted but never read. It says what is actually being said about a
     provider, which is more use to a buyer than a movement state alone. The
     upstream numeric index stays internal; only the narrative and its named
     early warnings surface, and only as something to verify. */
  const warned = vendors
    .filter((v) => (v.perception?.earlyWarnings ?? []).length > 0)
    .slice(0, 3);
  if (warned.length > 0) {
    const named = warned.map((v) => `${v.name} (${v.perception!.earlyWarnings[0]})`).join("; ");
    divergenceFinding.body =
      `${divergenceFinding.body} AG stakeholder tracking currently flags: ${named}.`;
    divergenceFinding.action =
      "Put the flagged themes to the provider directly and ask what has changed since — a perception signal is a prompt to verify, not a finding about your own account.";
    divergenceFinding.evidence =
      `${divergenceFinding.evidence} AnalystGenius stakeholder tracking${warned[0]?.perception?.asOf ? `, to ${warned[0].perception!.asOf.slice(0, 10)}` : ""}.`;
  }

  return [marketFinding, divergenceFinding, claimsFinding];
}

export default async function ReputationPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext(sp);

  if (!ctx.dbReady) return <PortalShell active="reputation" ctx={ctx} returnTo="/reputation">{null}</PortalShell>;
  if (ctx.scope.mode === "unset") {
    return (
      <PortalShell active="reputation" ctx={ctx} returnTo="/reputation">
        <FirstRunSelector ctx={ctx} returnTo="/reputation" />
      </PortalShell>
    );
  }

  const intel = await resolveIntelligence(JSON.stringify(ctx.scope));
  const vendors = intel.vendors as unknown as VendorRow[];
  const findings = buildFindings(vendors);

  const rows = vendors
    .map((v) => ({
      ticker: v.ticker,
      name: v.name,
      reputation: v.metrics.reputationMovement,
      talent: v.metrics.talentPressure,
      risk: v.metrics.operationalRisk,
    }))
    .filter((r) => r.reputation)
    .sort((a, b) => STATE_RANK[a.reputation.state] - STATE_RANK[b.reputation.state]);

  return (
    <PortalShell active="reputation" ctx={ctx} returnTo="/reputation">
      <AnalystInsightHero intel={intel} tab="reputation" />

      {/* THREE CORE FINDINGS — market condition, divergence, claims vs delivery. */}
      <section className="mt-8">
        <SectionHeader
          eyebrow="Core findings"
          title="What the market reads into these vendors"
          aside="Perception, not delivery quality on your own account"
        />
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {findings.map((f) => (
            <Panel key={f.eyebrow} className="flex flex-col gap-3 px-5 py-5">
              <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>
                {f.eyebrow}
              </div>
              <h3 className="m-0 text-[1.06rem] leading-snug" style={{ color: findingInk(f.state) }}>
                {f.title}
              </h3>
              <p className="m-0 text-[0.98rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                {f.body}
              </p>
              <Hairline />
              <p className="m-0 text-[0.9rem] leading-relaxed" style={{ color: "var(--fg-dim)" }}>
                <span className="eyebrow">Evidence</span> {f.evidence}
              </p>
              <p className="m-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
                  What to do
                </span>{" "}
                {f.action}
              </p>
            </Panel>
          ))}
        </div>
      </section>

      {/* PER-VENDOR — the same three readings, per vendor, as states only. */}
      <section className="mt-10">
        <SectionHeader
          eyebrow="By vendor"
          title="Perception readings"
          aside="Ordered by reputation movement, weakest first"
        />
        <div className="mt-5">
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.95rem]" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Vendor</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">
                      Reputation
                      <InfoTip content={fromSemantics(METRIC_DICTIONARY.reputationMovement!)} />
                    </th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Talent pressure</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Delivery-side reading</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                      <td className="px-4 py-3" style={{ color: "var(--fg)" }}>{r.name}</td>
                      <td className="px-4 py-3">
                        <StateText state={r.reputation.state} metricId={r.reputation.id} className="text-[0.95rem]" />
                      </td>
                      <td className="px-4 py-3">
                        {r.talent ? <StateText state={r.talent.state} metricId={r.talent.id} className="text-[0.95rem]" /> : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.risk ? <StateText state={r.risk.state} metricId={r.risk.id} className="text-[0.95rem]" /> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <p className="mt-4 max-w-[80ch] text-[0.9rem] leading-relaxed" style={{ color: "var(--fg-dim)" }}>
          These readings describe how the market perceives each vendor. They are a prompt to ask
          better questions, not a verdict on how a vendor performs on your own account — and the
          underlying analytical scoring is proprietary and is not exposed.
          {intel.updatedAt ? ` Perception evidence runs to ${shortDate(intel.updatedAt)}.` : ""}
        </p>
      </section>
    </PortalShell>
  );
}
