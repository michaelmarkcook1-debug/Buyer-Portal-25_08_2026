/**
 * Internal scenario value audit (pilot QA, 2026-08-23).
 *
 * For each predefined scenario: which vendor moves most, which opportunity
 * family moves most, and whether the strategic reading actually changes —
 * i.e. whether any vendor's overall opportunity LEVEL or strongest lever
 * changes, not merely its underlying score.
 *
 * Classification is INTERNAL product QA. It is never rendered to buyers.
 * Read-only: resolves intelligence and compares, writes nothing.
 */
import { SCENARIOS, applyScenario } from "../lib/scenarios";
import { resolveIntelligence } from "../lib/metrics/resolve";
import { levelScore } from "../lib/metrics/types";
import type { VendorIntel } from "../lib/metrics/types";

type Classification = "DECISION_CHANGING" | "USEFUL_CONTEXT" | "LOW_VALUE";

const SCOPE = JSON.stringify({
  v: 1,
  mode: "selected_vendors",
  vendors: (process.env.AUDIT_VENDORS ?? "ACN,CTSH,TTNQY").split(","),
  selectedAt: "2026-08-23T00:00:00.000Z",
  firstUseAt: "2025-08-21T00:00:00.000Z",
});

function strongestLever(v: VendorIntel): string {
  const defined = Object.values(v.opportunities).filter((o) => o.level !== "insufficient");
  if (defined.length === 0) return "none";
  return defined.sort((a, b) => levelScore(b.level) - levelScore(a.level))[0]!.type;
}

async function main(): Promise<void> {
  const base = await resolveIntelligence(SCOPE);
  const baseByTicker = new Map(base.vendors.map((v) => [v.ticker, v]));

  console.log(`baseline market: ${base.scope.names.join(", ")}\n`);
  const rows: Array<{ id: string; label: string; vendor: string; family: string; strategyChanges: boolean; cls: Classification; detail: string }> = [];

  for (const sc of SCENARIOS) {
    const applied = applyScenario(base, sc);
    const alt = { ...base, vendors: applied.vendors };
    let topVendor = "—";
    let topVendorDelta = 0;
    let levelChanges = 0;
    let leverChanges = 0;
    const familyDelta = new Map<string, number>();

    for (const v of alt.vendors) {
      const b = baseByTicker.get(v.ticker);
      if (!b) continue;
      const dOverall = Math.abs(levelScore(v.overall.level) - levelScore(b.overall.level));
      if (levelScore(v.overall.level) !== levelScore(b.overall.level)) levelChanges += 1;
      if (strongestLever(v) !== strongestLever(b)) leverChanges += 1;

      let vendorMove = dOverall;
      for (const [type, opp] of Object.entries(v.opportunities)) {
        const bo = b.opportunities[type as keyof typeof b.opportunities];
        const d = Math.abs(levelScore(opp.level) - levelScore(bo.level));
        vendorMove += d;
        familyDelta.set(type, (familyDelta.get(type) ?? 0) + d);
      }
      if (vendorMove > topVendorDelta) {
        topVendorDelta = vendorMove;
        topVendor = v.name;
      }
    }

    const topFamily = [...familyDelta.entries()].sort((a, b) => b[1] - a[1])[0];
    const strategyChanges = levelChanges > 0 || leverChanges > 0;
    const anyMovement = topVendorDelta > 0 || (topFamily?.[1] ?? 0) > 0;
    const cls: Classification = strategyChanges
      ? "DECISION_CHANGING"
      : anyMovement
        ? "USEFUL_CONTEXT"
        : "LOW_VALUE";

    rows.push({
      id: sc.id,
      label: sc.label,
      vendor: topVendorDelta > 0 ? `${topVendor} (${topVendorDelta} level steps)` : "no vendor moves",
      family: topFamily && topFamily[1] > 0 ? `${topFamily[0]} (${topFamily[1]} steps)` : "no family moves",
      strategyChanges,
      cls,
      detail: `${levelChanges} vendor(s) change overall level, ${leverChanges} change strongest lever`,
    });
  }

  console.log("id".padEnd(24) + "vendor moving most".padEnd(34) + "family moving most".padEnd(26) + "strategy?".padEnd(11) + "class");
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      r.id.padEnd(24) + r.vendor.padEnd(34) + r.family.padEnd(26) + (r.strategyChanges ? "YES" : "no").padEnd(11) + r.cls,
    );
    console.log("  ".padEnd(24) + r.detail);
  }
  const low = rows.filter((r) => r.cls === "LOW_VALUE");
  console.log(`\nLOW_VALUE candidates flagged for pilot feedback: ${low.length ? low.map((r) => r.id).join(", ") : "none"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
