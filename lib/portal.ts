import "server-only";
import { getFreshness, getSpineAnchor, getUniverse, type SourceFreshness, type UniverseVendor } from "@/lib/data/facts";
import { isDbConfigured } from "@/lib/db";
import { getMarketScope, type MarketScope, type RawSearchParams } from "@/lib/market-scope";

/** Everything the shell and every page needs about the current request. */
export type PortalContext =
  | { dbReady: false }
  | {
      dbReady: true;
      universe: UniverseVendor[];
      scope: MarketScope;
      names: string[];
      freshness: SourceFreshness[];
      spine: { lastIngest: string; daysStale: number };
      updatedAt: string | null;
    };

export async function getPortalContext(sp: RawSearchParams): Promise<PortalContext> {
  if (!isDbConfigured()) return { dbReady: false };
  const [universe, spine, freshness] = await Promise.all([getUniverse(), getSpineAnchor(), getFreshness()]);
  const valid = new Set(universe.map((u) => u.ticker));
  const scope = await getMarketScope(sp, valid);
  const nameOf = new Map(universe.map((u) => [u.ticker, u.name]));
  const names = scope.vendorIds.map((t) => nameOf.get(t) ?? t);
  const updatedAt = freshness.map((f) => f.lastSeen).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  return { dbReady: true, universe, scope, names, freshness, spine, updatedAt };
}

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
