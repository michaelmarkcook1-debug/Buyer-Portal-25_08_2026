import "server-only";
import {
  getFreshness, getSpineAnchor, getUniverse, getVendorsInServiceFamily,
  SERVICE_FAMILIES, type ServiceFamilyId,
  type SourceFreshness, type SpineAnchor, type UniverseVendor,
} from "@/lib/data/facts";
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
      spine: SpineAnchor;
      updatedAt: string | null;
      families: ServiceFamilyOption[];
    };

export interface ServiceFamilyOption {
  id: ServiceFamilyId;
  label: string;
  /** Tracked providers holding observed agreements in the family. */
  count: number;
  /** Those providers, so the picker can gate to them without a second read. */
  tickers: string[];
}

/**
 * A family is only offered where it would open on a market rather than an
 * empty page. Below this it is not a scope, it is a disappointment.
 */
const MIN_PROVIDERS_FOR_FAMILY_SCOPE = 5;

export async function getPortalContext(sp: RawSearchParams): Promise<PortalContext> {
  if (!isDbConfigured()) return { dbReady: false };
  const familyIds = Object.keys(SERVICE_FAMILIES) as ServiceFamilyId[];
  const [universe, spine, freshness, familyTickers] = await Promise.all([
    getUniverse(), getSpineAnchor(), getFreshness(),
    Promise.all(familyIds.map((id) => getVendorsInServiceFamily(id))),
  ]);
  const valid = new Set(universe.map((u) => u.ticker));
  const scope = await getMarketScope(sp, valid);
  const nameOf = new Map(universe.map((u) => [u.ticker, u.name]));
  const names = scope.vendorIds.map((t) => nameOf.get(t) ?? t);
  const updatedAt = freshness.map((f) => f.lastSeen).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const families: ServiceFamilyOption[] = familyIds
    .map((id, i) => {
      const tickers = familyTickers[i]!.filter((t) => valid.has(t));
      return { id, label: SERVICE_FAMILIES[id].label, count: tickers.length, tickers };
    })
    .filter((f) => f.count >= MIN_PROVIDERS_FOR_FAMILY_SCOPE);
  return { dbReady: true, universe, scope, names, freshness, spine, updatedAt, families };
}

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
