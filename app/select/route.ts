import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUniverse, getVendorsInServiceFamily, isServiceFamily } from "@/lib/data/facts";
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
  /* A service family expands to the providers carrying evidence in it, so the
     stored scope stays exactly what it has always been — a vendor set. The
     family is a way of CHOOSING vendors, never a second scope dimension, and
     nothing downstream has to learn about it. */
  const family = url.searchParams.get("family");
  let vendors: string[] = [];
  /* An explicit family selects its providers and becomes the active gate. A
     later submit from the gated picker carries no family param, so the stored
     one stands — the gate survives refining the selection, and is cleared only
     by choosing whole market or another family. */
  let activeFamily: string | undefined = isServiceFamily(family) ? family : existing?.family;
  if (!wantsWhole && isServiceFamily(family) && isDbConfigured()) {
    const universe = new Set((await getUniverse()).map((u) => u.ticker));
    vendors = (await getVendorsInServiceFamily(family)).filter((t) => universe.has(t));
  } else if (!wantsWhole) {
    const requested = tickersFromParam(url.searchParams.getAll("vendors"));
    if (requested.length > 0 && isDbConfigured()) {
      const universe = new Set((await getUniverse()).map((u) => u.ticker));
      vendors = requested.filter((t) => universe.has(t));
    }
  }

  const res = NextResponse.redirect(new URL(returnTo, url.origin), 303);

  if (wantsWhole) activeFamily = undefined; // the whole market is not a family
  if (wantsWhole || vendors.length > 0) {
    res.cookies.set(
      SCOPE_COOKIE,
      encodeCookieValue({
        v: 1,
        mode: wantsWhole ? "whole_market" : "selected_vendors",
        vendors,
        family: activeFamily,
        selectedAt: now,
        firstUseAt,
      }),
      { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 },
    );
  }
  // A submission with nothing selected changes nothing — the current scope stands.

  return res;
}
