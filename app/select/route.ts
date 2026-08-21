import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUniverse } from "@/lib/data/facts";
import { isDbConfigured } from "@/lib/db";
import {
  SCOPE_COOKIE,
  encodeCookieValue,
  parseCookieValue,
  tickersFromParam,
} from "@/lib/market-scope";

export const dynamic = "force-dynamic";

/**
 * GET /select — the vendor-selection form target (zero client JS).
 *
 * Writes the scope cookie (the only persistence in the product — vendor
 * selection is the only user configuration) and returns to the tab the buyer
 * was on. Tickers are validated against the live supported universe; unknown
 * values are dropped, never stored.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawReturn = url.searchParams.get("return") ?? "/";
  // Same-origin relative paths only — never an open redirect.
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/";

  const jar = await cookies();
  const existing = parseCookieValue(jar.get(SCOPE_COOKIE)?.value);
  const now = new Date().toISOString();
  const firstUseAt = existing?.firstUseAt ?? now;

  const wantsWhole = url.searchParams.get("market") === "whole";
  let vendors: string[] = [];
  if (!wantsWhole) {
    const requested = tickersFromParam(url.searchParams.getAll("vendors"));
    if (requested.length > 0 && isDbConfigured()) {
      const universe = new Set((await getUniverse()).map((u) => u.ticker));
      vendors = requested.filter((t) => universe.has(t));
    }
  }

  const res = NextResponse.redirect(new URL(returnTo, url.origin), 303);

  if (wantsWhole || vendors.length > 0) {
    res.cookies.set(
      SCOPE_COOKIE,
      encodeCookieValue({
        v: 1,
        mode: wantsWhole ? "whole_market" : "selected_vendors",
        vendors,
        selectedAt: now,
        firstUseAt,
      }),
      { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 },
    );
  }
  // A submission with nothing selected changes nothing — the current scope stands.

  return res;
}
