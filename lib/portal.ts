import "server-only";
import {
  getFreshness, getSpineAnchor, getUniverse, getVendorsInServiceFamily,
  SERVICE_FAMILIES, type ServiceFamilyId,
  type SourceFreshness, type SpineAnchor, type UniverseVendor,
} from "@/lib/data/facts";
import { isDbConfigured } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import type { PortalUser } from "@/lib/auth/users";
import { summariseEvidence, type EvidenceSummary } from "@/lib/freshness";
import { getMarketScope, type MarketScope, type RawSearchParams } from "@/lib/market-scope";

/** Everything the shell and every page needs about the current request. */
export type PortalContext =
  | { dbReady: false }
  | {
      dbReady: true;
      /** The signed-in account. Every data page requires one. */
      user: PortalUser;
      universe: UniverseVendor[];
      scope: MarketScope;
      names: string[];
      freshness: SourceFreshness[];
      spine: SpineAnchor;
      /** Latest INGEST across sources — pipeline provenance only, never shown as freshness. */
      updatedAt: string | null;
      /** What the evidence is about, per family — the only freshness the page states. */
      evidence: EvidenceSummary;
      families: ServiceFamilyOption[];
    };

export interface ServiceFamilyOption {
  id: ServiceFamilyId;
  label: string;
  /** Tracked providers holding observed agreements in the family. */
  count: number;
  /** Those providers, so the picker can gate to them without a second read. */
  tickers: string[];
  /** Where the membership came from — shown wherever the family is used. */
  basis: string;
}

/**
 * A family is only offered where it would open on a market rather than an
 * empty page. Below this it is not a scope, it is a disappointment.
 */
const MIN_PROVIDERS_FOR_FAMILY_SCOPE = 5;

export async function getPortalContext(sp: RawSearchParams): Promise<PortalContext> {
  if (!isDbConfigured()) return { dbReady: false };
  /* The authoritative check: a real, enabled account — or, with
     PUBLIC_ACCESS=on, a guest. Middleware only checked the token's signature. */
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
  const evidence = summariseEvidence(freshness);
  const families: ServiceFamilyOption[] = familyIds
    .map((id, i) => {
      const tickers = familyTickers[i]!.filter((t) => valid.has(t));
      return { id, label: SERVICE_FAMILIES[id]!.label, basis: SERVICE_FAMILIES[id]!.basis, count: tickers.length, tickers };
    })
    .filter((f) => f.count >= MIN_PROVIDERS_FOR_FAMILY_SCOPE);
  return { dbReady: true, user, universe, scope, names, freshness, spine, updatedAt, evidence, families };
}

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
