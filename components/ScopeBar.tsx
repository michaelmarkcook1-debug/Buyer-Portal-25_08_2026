import Link from "next/link";
import type { UniverseVendor } from "@/lib/data/facts";
import type { MarketScope } from "@/lib/market-scope";
import { agoDays, shortDate } from "@/lib/format";

/**
 * The persistent vendor-market selector (spec §6) — visible on every tab.
 *
 * Zero client JS: the selector is a <details> popover holding a GET form to
 * /select, which writes the scope cookie and returns to the current tab.
 * Selected vendors define the market; this control is the only user
 * configuration in the product.
 */

export function ScopeBar({
  scope,
  universe,
  names,
  updatedAt,
  spineDataAsOf,
  spineDataAgeDays,
  returnTo,
}: {
  scope: MarketScope;
  universe: UniverseVendor[];
  names: string[];
  updatedAt: string | null;
  /** The newest observation date the commercial evidence itself carries. */
  spineDataAsOf: string | null;
  spineDataAgeDays: number | null;
  returnTo: string;
}) {
  const tracking =
    scope.mode === "selected_vendors"
      ? names.length <= 4
        ? names.join(" · ")
        : `${names.slice(0, 3).join(" · ")} · +${names.length - 3} more`
      : scope.mode === "whole_market"
        ? `Whole market — ${universe.length} AG-covered vendors`
        : "No vendors selected";

  const selected = new Set(scope.vendorIds);

  return (
    <div
      style={{ background: "var(--bg-elev-2)", borderBottom: "1px solid var(--surface-line-soft)" }}
      className="relative"
    >
      <div className="mx-auto flex max-w-[var(--max-width)] flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="eyebrow shrink-0">Tracking</span>
          <span className="truncate text-[0.92rem] font-medium" style={{ color: "var(--fg)" }}>
            {tracking}
          </span>
        </div>

        <details className="relative">
          <summary
            className="tap cursor-pointer list-none rounded-md px-2.5 py-1 text-[0.82rem] transition-colors"
            style={{ color: "var(--accent-ink)", background: "var(--accent-soft)" }}
          >
            Change vendors
          </summary>
          <div
            className="absolute left-0 z-40 mt-2 w-[min(30rem,88vw)] rounded-[var(--radius-card)] p-5"
            style={{
              background: "var(--surface-solid)",
              border: "1px solid var(--surface-line)",
              boxShadow: "var(--shadow-2)",
            }}
          >
            <div className="eyebrow">Define your market</div>
            <p className="mt-1.5 mb-3 text-[0.84rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Select the vendors you contract with or want to track. Your selection defines every
              metric, comparison and insight in the portal.
            </p>
            <form method="GET" action="/select">
              <input type="hidden" name="return" value={returnTo} />
              <div
                className="grid max-h-[46vh] grid-cols-1 gap-x-4 overflow-y-auto pr-1 sm:grid-cols-2"
                role="group"
                aria-label="Vendors"
              >
                {universe.map((v) => (
                  <label
                    key={v.ticker}
                    className="tap tap-stack flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 text-[0.85rem] hover:bg-[color-mix(in_srgb,var(--fg)_4%,transparent)]"
                  >
                    <input
                      type="checkbox"
                      name="vendors"
                      value={v.ticker}
                      defaultChecked={selected.has(v.ticker)}
                      className="mt-1 accent-[var(--accent-fill)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate" style={{ color: "var(--fg)" }}>
                        {v.name}
                      </span>
                      <span className="code block text-[0.66rem]" style={{ color: "var(--fg-dim)" }}>
                        {v.contracts > 0 ? `${v.contracts} contracts · ${v.inPlay24} in play` : "no contracts on record"}
                        {v.signalTypes > 0 ? ` · ${v.signalTypes} signal types` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="tap cursor-pointer rounded-md px-4 py-1.5 text-[0.85rem] font-semibold"
                  style={{ background: "var(--accent-fill)", color: "#07142a", border: "none" }}
                >
                  Track selected vendors
                </button>
                <Link
                  href={`/select?market=whole&return=${encodeURIComponent(returnTo)}`}
                  className="tap rounded-md px-3 py-1.5 text-[0.85rem]"
                  style={{ color: "var(--rail-ink)" }}
                >
                  Whole market instead
                </Link>
              </div>
            </form>
          </div>
        </details>

        {scope.mode !== "whole_market" ? (
          <Link
            href={`/select?market=whole&return=${encodeURIComponent(returnTo)}`}
            className="tap text-[0.82rem]"
            style={{ color: "var(--rail-ink)" }}
          >
            Whole Market
          </Link>
        ) : null}

        <div className="ml-auto flex items-center gap-4">
          {scope.mode !== "unset" ? (
            <span className="code hidden text-[0.7rem] md:inline" style={{ color: "var(--fg-dim)" }}>
              12-month baseline from {shortDate(scope.baselineStart)}
            </span>
          ) : null}
          {updatedAt ? (
            <span className="code text-[0.7rem]" style={{ color: "var(--fg-dim)" }} title="Latest ingest across connected sources">
              Updated {shortDate(updatedAt)}
            </span>
          ) : null}
        </div>
      </div>

      {spineDataAgeDays != null && spineDataAgeDays > 45 ? (
        <div style={{ background: "var(--data-watch-soft)" }}>
          <div
            className="mx-auto max-w-[var(--max-width)] px-5 py-1.5 text-[0.78rem] sm:px-8"
            style={{ color: "var(--data-watch-ink)" }}
          >
            Commercial contract evidence is as of {shortDate(spineDataAsOf)} ({agoDays(spineDataAgeDays)}) —
            contract-derived readings are dated accordingly. Public-procurement and AG-signal evidence is
            fresher and carries its own dates; nothing here is passed off as current.
          </div>
        </div>
      ) : null}
    </div>
  );
}
