/**
 * Pure MarketScope helpers — no Next.js imports, so the locked-rules tests can
 * exercise them directly. `lib/market-scope.ts` re-exports these for the app.
 */

export interface ScopeCookie {
  v: 1;
  mode: "selected_vendors" | "whole_market";
  vendors: string[];
  selectedAt: string;
  firstUseAt: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** first_use_date − 12 months (spec §3). */
export function baselineFrom(firstUseAt: string): string {
  const d = new Date(firstUseAt);
  if (Number.isNaN(d.getTime())) return isoDate(new Date(Date.now() - 365 * 86400_000));
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return isoDate(d);
}

export function parseCookieValue(rawValue: string | undefined): ScopeCookie | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Partial<ScopeCookie>;
    if (parsed.v !== 1) return null;
    if (parsed.mode !== "selected_vendors" && parsed.mode !== "whole_market") return null;
    return {
      v: 1,
      mode: parsed.mode,
      vendors: Array.isArray(parsed.vendors)
        ? parsed.vendors.filter((t): t is string => typeof t === "string").map((t) => t.toUpperCase())
        : [],
      selectedAt: typeof parsed.selectedAt === "string" ? parsed.selectedAt : new Date().toISOString(),
      firstUseAt: typeof parsed.firstUseAt === "string" ? parsed.firstUseAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function encodeCookieValue(c: ScopeCookie): string {
  return JSON.stringify(c);
}

export type ScopeMode = "selected_vendors" | "whole_market" | "unset";

export interface MarketScopeShape {
  mode: ScopeMode;
  vendorIds: string[];
}

/**
 * The tickers a data read may scope to. Selected vendors define the market —
 * a calculation may NEVER silently widen beyond this (§15 regression-tested).
 */
export function scopedTickers(scope: MarketScopeShape, universe: readonly string[]): string[] {
  if (scope.mode === "selected_vendors") return scope.vendorIds;
  if (scope.mode === "whole_market") return [...universe];
  return [];
}

/** Normalise a ?vendors= param (repeated or comma-separated) to uppercase tickers. */
export function tickersFromParam(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((v) => v.split(","))
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.-]{1,16}$/.test(s));
  return [...new Set(parts)];
}
