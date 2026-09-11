import "server-only";
import { cookies } from "next/headers";
import {
  baselineFrom,
  parseCookieValue,
  tickersFromParam,
  encodeCookieValue,
  type ScopeCookie,
} from "./scope-core";

export { baselineFrom, parseCookieValue, tickersFromParam, encodeCookieValue };
export type { ScopeCookie };

/**
 * MarketScope — the single global scope object (spec §2).
 *
 * The user's selected vendors ARE the market. Every downstream read, metric,
 * ranking, opportunity and Analyst Insight accepts this object; nothing may
 * silently widen to a broader market. "Whole market" means the full supported
 * vendor universe — the AG-covered vendors, resolved live from the database.
 *
 * Vendor selection is the ONLY user configuration in this MVP.
 *
 * Persistence: an httpOnly cookie (there are no accounts), which also carries
 * the first-use timestamp from which the 12-month retrospective baseline is
 * derived (spec §3). A `?vendors=` URL parameter overrides the cookie for the
 * request (shareable views) without rewriting the reader's own selection.
 */

export const SCOPE_COOKIE = "bp_scope";

export type ScopeMode = "selected_vendors" | "whole_market" | "unset";

export interface MarketScope {
  mode: ScopeMode;
  /** Uppercase AG tickers. Empty when whole_market or unset. */
  vendorIds: string[];
  /** The service family the vendors were chosen from, if any. */
  family?: string;
  selectionTimestamp: string | null;
  /** first_use_date − 12 months (YYYY-MM-DD). */
  baselineStart: string;
  firstUseAt: string;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Resolve the request's MarketScope. `validTickers` is the live supported
 * universe — unknown tickers are dropped rather than queried, so a hand-edited
 * URL cannot produce an empty view that reads as "no intelligence".
 */
export async function getMarketScope(
  sp: RawSearchParams,
  validTickers: ReadonlySet<string>,
): Promise<MarketScope> {
  const jar = await cookies();
  const stored = parseCookieValue(jar.get(SCOPE_COOKIE)?.value);
  const now = new Date().toISOString();
  const firstUseAt = stored?.firstUseAt ?? now;

  const urlMode = Array.isArray(sp.market) ? sp.market[0] : sp.market;
  const urlVendors = tickersFromParam(sp.vendors).filter((t) => validTickers.has(t));

  if (urlMode === "whole") {
    return { mode: "whole_market", vendorIds: [], selectionTimestamp: now, baselineStart: baselineFrom(firstUseAt), firstUseAt };
  }
  if (urlVendors.length > 0) {
    return { mode: "selected_vendors", vendorIds: urlVendors, selectionTimestamp: now, baselineStart: baselineFrom(firstUseAt), firstUseAt };
  }

  if (stored) {
    const vendors = stored.vendors.filter((t) => validTickers.has(t));
    if (stored.mode === "whole_market") {
      return { mode: "whole_market", vendorIds: [], selectionTimestamp: stored.selectedAt, baselineStart: baselineFrom(firstUseAt), firstUseAt };
    }
    if (vendors.length > 0) {
      return { mode: "selected_vendors", vendorIds: vendors, family: stored.family, selectionTimestamp: stored.selectedAt, baselineStart: baselineFrom(firstUseAt), firstUseAt };
    }
  }

  return { mode: "unset", vendorIds: [], selectionTimestamp: null, baselineStart: baselineFrom(firstUseAt), firstUseAt };
}

export { scopedTickers } from "./scope-core";

/** Stable cache key component for this scope. */
export function scopeKey(scope: MarketScope): string {
  if (scope.mode === "selected_vendors") return `sel:${[...scope.vendorIds].sort().join(",")}`;
  return scope.mode;
}
