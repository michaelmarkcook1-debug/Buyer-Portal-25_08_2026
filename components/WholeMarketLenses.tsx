import Link from "next/link";
import { Panel } from "@/components/ui";
import type { VendorIntel } from "@/lib/metrics/types";

/**
 * "Where to look first" — a small number of genuinely exceptional vendor
 * situations, not four top-five league tables.
 *
 * Rules (cross-surface consistency correction, 23 Aug 2026):
 *  - ONE vendor, ONE distinctive reason, ONE buyer implication per call.
 *  - A vendor appears at most once across the whole section. Repeating the
 *    same name under four headings with near-identical wording added no
 *    intelligence and made ranking noise look like insight.
 *  - A call is made only where the vendor is genuinely distinguishable. Where
 *    several vendors are effectively equivalent, the section says so instead
 *    of manufacturing a league table (§11 — no false comparative language).
 *  - 3–5 calls total.
 */

interface Call {
  ticker: string;
  name: string;
  headline: string;
  why: string;
  implication: string;
}

const MAX_CALLS = 5;

function materially(movement: string): boolean {
  return movement === "materially-improving" || movement === "materially-deteriorating";
}

/** True when the leader is genuinely ahead rather than tied with the pack. */
function isDistinguishable(leaderScore: number, runnerUpScore: number | undefined): boolean {
  if (runnerUpScore == null) return true;
  return leaderScore > runnerUpScore;
}

export function buildCalls(vendors: VendorIntel[]): { calls: Call[]; tiedNote: string | null } {
  const used = new Set<string>();
  const calls: Call[] = [];
  let tied = 0;

  const take = (
    candidates: VendorIntel[],
    score: (v: VendorIntel) => number,
    build: (v: VendorIntel) => Omit<Call, "ticker" | "name">,
  ): void => {
    if (calls.length >= MAX_CALLS) return;
    const pool = candidates.filter((v) => !used.has(v.ticker)).sort((a, b) => score(b) - score(a));
    const leader = pool[0];
    if (!leader || score(leader) <= 0) return;
    // §11: only claim a superlative where one genuinely exists.
    if (!isDistinguishable(score(leader), pool[1] ? score(pool[1]) : undefined)) {
      tied += 1;
      return;
    }
    used.add(leader.ticker);
    calls.push({ ticker: leader.ticker, name: leader.name, ...build(leader) });
  };

  const levelRank = (l: string): number => ["insufficient", "low", "medium", "high", "very-high"].indexOf(l);

  /* Corroboration depth: how many independent readings are actually moving
     for this vendor. Used to separate genuine leaders from a tied field —
     a vendor whose position is supported by more moving evidence is really
     more exceptional, not just alphabetically first. */
  const depth = (v: VendorIntel): number =>
    [
      v.metrics.providerMomentum, v.metrics.talentPressure, v.metrics.automationOpportunity,
      v.metrics.aiProductivityOpportunity, v.metrics.pricingPressure, v.metrics.dealMarketHeat,
      v.metrics.reputationMovement, v.metrics.financialHeadroom,
    ].filter((m) => m && materially(m.movement)).length;

  // 1. Strongest commercial opportunity — scored so ties remain visible.
  take(
    vendors,
    (v) => levelRank(v.overall.level) * 100 + Object.values(v.opportunities).filter((o) => o.level === "very-high").length * 10 + depth(v),
    (v) => ({
      headline: "strongest commercial opportunity",
      why: v.overall.reason ?? "the strongest combination of opportunity readings in the covered market",
      implication: "Open the commercial conversation here first — this is where the evidence best supports a challenge.",
    }),
  );

  // 2. Delivery capacity deserving scrutiny.
  take(
    vendors,
    (v) => (v.metrics.talentPressure.state === "unfavourable" ? 100 : 0) + (materially(v.metrics.talentPressure.movement) ? 50 : 0) + depth(v),
    () => ({
      headline: "delivery capacity deserves scrutiny",
      why: "their delivery workforce is contracting on the observed talent record while commitments run multi-year",
      implication: "Test continuity and named-resource commitments before price.",
    }),
  );

  // 3. Automation / productivity challenge.
  take(
    vendors,
    (v) =>
      (v.metrics.automationOpportunity.state === "favourable" ? 100 : 0) +
      (materially(v.metrics.aiProductivityOpportunity.movement) ? 50 : 0) +
      levelRank(v.opportunities.automation.level) * 5 + depth(v),
    () => ({
      headline: "strongest automation and productivity challenge",
      why: "automation capability has advanced faster than their delivery model has repriced",
      implication: "Challenge whether productivity gains are reflected in the rates on offer.",
    }),
  );

  // 4. Sharpest change in commercial momentum.
  take(
    vendors,
    (v) => (v.metrics.providerMomentum.movement === "materially-deteriorating" ? 200 : v.metrics.providerMomentum.movement === "materially-improving" ? 100 : 0) + depth(v) * 5 + levelRank(v.overall.level),
    (v) => ({
      headline:
        v.metrics.providerMomentum.movement === "materially-deteriorating"
          ? "commercial momentum weakening fastest"
          : "commercial momentum strengthening fastest",
      why:
        v.metrics.providerMomentum.movement === "materially-deteriorating"
          ? "their observed win pace has fallen materially, moving demand pressure toward the buyer"
          : "their observed win pace has risen materially, which tightens buyer leverage",
      implication:
        v.metrics.providerMomentum.movement === "materially-deteriorating"
          ? "A weakening vendor may concede more — worth testing before their position recovers."
          : "Expect less flexibility here; plan the conversation accordingly.",
    }),
  );

  const tiedNote =
    calls.length === 0
      ? "No vendor is materially distinguishable on the current evidence — several show similar readings."
      : tied > 0
        ? "Other dimensions show several vendors at similar levels, so no single leader is claimed."
        : null;

  return { calls, tiedNote };
}

export function WholeMarketLenses({ vendors }: { vendors: VendorIntel[] }) {
  const { calls, tiedNote } = buildCalls(vendors);
  if (calls.length === 0 && !tiedNote) return null;

  return (
    <div className="flex flex-col gap-3">
      {calls.map((c, i) => (
        <Panel key={c.ticker} className="px-5 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="code text-[0.93rem]" style={{ color: "var(--accent-ink)" }}>
              #{i + 1}
            </span>
            <Link
              href={`/vendors/${c.ticker.toLowerCase()}`}
              className="text-[1.11rem] font-medium underline-offset-4 hover:underline"
              style={{ color: "var(--fg)", textDecorationColor: "var(--accent-fill)" }}
            >
              {c.name}
            </Link>
            <span className="text-[1.02rem]" style={{ color: "var(--fg-muted)" }}>
              — {c.headline}
            </span>
          </div>
          <p className="m-0 mt-2 text-[0.98rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--fg-dim)" }}>Why: </span>
            {c.why}
          </p>
          <p className="m-0 mt-1 text-[0.98rem] leading-relaxed" style={{ color: "var(--fg)" }}>
            <span style={{ color: "var(--fg-dim)" }}>Buyer implication: </span>
            {c.implication}
          </p>
        </Panel>
      ))}
      {tiedNote ? (
        <p className="m-0 text-[0.95rem]" style={{ color: "var(--fg-dim)" }}>
          {tiedNote}
        </p>
      ) : null}
    </div>
  );
}
