import Link from "next/link";
import type { UniverseVendor } from "@/lib/data/facts";
import type { MarketScope } from "@/lib/market-scope";
import { agoDays, shortDate, counted } from "@/lib/format";
import { familyEvidenceLines, FRESHNESS_CAP_DAYS, type EvidenceSummary } from "@/lib/freshness";

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
  evidence,
  spineDataAsOf,
  spineDataAgeDays,
  returnTo,
  families,
}: {
  scope: MarketScope;
  universe: UniverseVendor[];
  names: string[];
  /** Per-family evidence dates. The ingest date is deliberately not a prop. */
  evidence: EvidenceSummary;
  /** The newest observation date the commercial evidence itself carries. */
  spineDataAsOf: string | null;
  spineDataAgeDays: number | null;
  returnTo: string;
  /** Service families with enough evidence to be worth offering as a scope. */
  families: { id: string; label: string; count: number; tickers: string[]; basis: string }[];
}) {
  const tracking =
    scope.mode === "selected_vendors"
      ? (names.length <= 4
          ? names.join(" · ")
          : `${names.slice(0, 3).join(" · ")} · +${names.length - 3} more`)
      : scope.mode === "whole_market"
        ? `Whole market — ${universe.length} AG-covered vendors`
        : "No vendors selected";

  const selected = new Set(scope.vendorIds);
  /* The spine sentence covers the commercial feeds; any other family past the
     cap is named here rather than implied fresh by the families beside it. */
  const otherStale = evidence.stale.filter((f) => !f.commercial);
  const fresherFamilies = evidence.families.filter((f) => !f.commercial && f.evidenceDate && !f.stale);
  const fresherNote =
    fresherFamilies.length > 0
      ? `${fresherFamilies.map((f) => f.source).join(", ")} run to ${shortDate(
          fresherFamilies.map((f) => f.evidenceDate!).sort()[0]!,
        )} or later.`
      : null;

  /* THE GATE. While a family is active the picker offers only the providers
     that family admits, so a buyer working in one cannot silently reselect
     their way out of it. It is stated above the list and cleared in one click,
     because a filter a reader cannot see is a filter they will misread. */
  const activeFamily = families.find((f) => f.id === scope.family) ?? null;
  const gated = activeFamily ? new Set(activeFamily.tickers) : null;
  const offered = gated ? universe.filter((v) => gated.has(v.ticker)) : universe;

  return (
    <div
      style={{ background: "var(--bg-elev-2)", borderBottom: "1px solid var(--surface-line-soft)" }}
      className="relative"
    >
      <div className="mx-auto flex max-w-[var(--max-width)] flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="eyebrow shrink-0">Tracking</span>
          <span className="truncate text-body font-medium" style={{ color: "var(--fg)" }}>
            {tracking}
          </span>
        </div>

        <details className="relative">
          <summary
            className="tap cursor-pointer list-none rounded-md px-2.5 py-1 text-label transition-colors"
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
            <p className="mt-1.5 mb-2 text-body leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Select the vendors you contract with or want to track. Your selection defines every
              metric, comparison and insight in the portal.
            </p>
            <p className="mt-0 mb-3 text-label leading-relaxed" style={{ color: "var(--fg-dim)" }}>
              Contract observations are market evidence — agreements between these vendors and other
              organisations. AnalystGenius holds none of your own contracts, spend or renewal dates.
            </p>
            {activeFamily ? (
              <p
                className="mt-0 mb-3 rounded-[var(--radius-sm)] px-3 py-2 text-label leading-relaxed"
                style={{ background: "var(--bg-elev-2)", color: "var(--fg-muted)" }}
              >
                <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
                  {activeFamily.label} only
                </span>{" "}
                Showing {activeFamily.count} of {universe.length} tracked providers.{" "}
                {activeFamily.basis}{" "}
                <Link
                  href={`/select?market=whole&return=${encodeURIComponent(returnTo)}`}
                  className="tap-link"
                  style={{ color: "var(--rail-ink)" }}
                >
                  Show all providers
                </Link>
              </p>
            ) : null}
            <form method="GET" action="/select">
              <input type="hidden" name="return" value={returnTo} />
              <div
                className="grid max-h-[46vh] grid-cols-1 gap-x-4 overflow-y-auto pr-1 sm:grid-cols-2"
                role="group"
                aria-label="Vendors"
              >
                {offered.map((v) => (
                  <label
                    key={v.ticker}
                    className="tap tap-stack flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 text-body hover:bg-[color-mix(in_srgb,var(--fg)_4%,transparent)]"
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
                      <span className="code block text-meta" style={{ color: "var(--fg-dim)" }}>
                        {v.contracts > 0 ? `${counted(v.contracts, "contract")} · ${v.inPlay24} in play` : "no contracts on record"}
                        {v.signalTypes > 0 ? ` · ${v.signalTypes} signal types` : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="tap cursor-pointer rounded-md px-4 py-1.5 text-body font-semibold"
                  style={{ background: "var(--accent-fill)", color: "#07142a", border: "none" }}
                >
                  Track selected vendors
                </button>
                <Link
                  href={`/select?market=whole&return=${encodeURIComponent(returnTo)}`}
                  className="tap rounded-md px-3 py-1.5 text-body"
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
            className="tap text-label"
            style={{ color: "var(--rail-ink)" }}
          >
            Whole Market
          </Link>
        ) : null}

        {/* SERVICE-FAMILY SCOPES (2026-09-11). One click to the providers who
            do this kind of work. They select VENDORS — every reading still
            covers each provider's whole observed position — so the label says
            "providers", never "market", and the tracking line above says which
            family put them there. A family with too little evidence to be a
            market is not offered at all rather than opening on an empty
            product. */}
        {families.map((f) => (
          <Link
            key={f.id}
            href={`/select?family=${f.id}&return=${encodeURIComponent(returnTo)}`}
            className="tap text-label"
            style={{ color: "var(--rail-ink)" }}
            title={`${f.count} of ${universe.length} tracked providers · ${f.basis}`}
          >
            {f.label} providers
          </Link>
        ))}

        <div className="ml-auto flex items-center gap-4">
          {scope.mode !== "unset" ? (
            <span className="code hidden text-meta md:inline" style={{ color: "var(--fg-dim)" }}>
              12-month baseline from {shortDate(scope.baselineStart)}
            </span>
          ) : null}
          {evidence.newest ? (
            <span
              className="code text-meta"
              style={{ color: "var(--fg-dim)" }}
              title={`Newest evidence by family — the date each is about, not when it was loaded:\n${familyEvidenceLines(evidence.families).join("\n")}`}
            >
              Newest evidence {shortDate(evidence.newest)}
            </span>
          ) : null}
        </div>
      </div>

      {(spineDataAgeDays != null && spineDataAgeDays > FRESHNESS_CAP_DAYS) || otherStale.length > 0 ? (
        <div style={{ background: "var(--data-watch-soft)" }}>
          <div
            className="mx-auto max-w-[var(--max-width)] px-5 py-1.5 text-label sm:px-8"
            style={{ color: "var(--data-watch-ink)" }}
          >
            <span className="block max-w-[84ch]">
              {spineDataAgeDays != null && spineDataAgeDays > FRESHNESS_CAP_DAYS ? (
                <>
                  Commercial contract evidence is as of {shortDate(spineDataAsOf)} ({agoDays(spineDataAgeDays)}) —
                  contract-derived readings are dated accordingly.{" "}
                </>
              ) : null}
              {otherStale.length > 0 ? (
                <>
                  Also past {FRESHNESS_CAP_DAYS} days:{" "}
                  {otherStale
                    .map((f) => `${f.source.toLowerCase()} (to ${shortDate(f.evidenceDate)})`)
                    .join(", ")}
                  .{" "}
                </>
              ) : fresherNote ? (
                <>{fresherNote} </>
              ) : null}
              Every reading carries its own date; nothing here is passed off as current.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
