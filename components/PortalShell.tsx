import Link from "next/link";
import type { ReactNode } from "react";
import { aiEnterpriseStatus } from "@/lib/adapters/ai-enterprise";
import { agoDays, shortDate } from "@/lib/format";
import type { PortalContext } from "@/lib/portal";
import { todayLabel } from "@/lib/portal";
import { Masthead, type NavId } from "./Masthead";
import { ScopeBar } from "./ScopeBar";
import { Panel } from "./ui";

/** The page chrome: masthead, persistent scope bar, content column, provenance footer. */
export function PortalShell({
  active,
  ctx,
  returnTo,
  children,
}: {
  active: NavId;
  ctx: PortalContext;
  returnTo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Masthead active={active} dateLabel={todayLabel()} />
      {ctx.dbReady ? (
        <ScopeBar
          scope={ctx.scope}
          universe={ctx.universe}
          names={ctx.names}
          updatedAt={ctx.updatedAt}
          spineDataAsOf={ctx.spine.dataAsOf}
          spineDataAgeDays={ctx.spine.dataAgeDays}
          returnTo={returnTo}
        />
      ) : null}
      <main className="mx-auto w-full max-w-[var(--max-width)] flex-1 px-5 pb-16 pt-7 sm:px-8 sm:pt-9">
        {ctx.dbReady ? children : <DbNotConfigured />}
      </main>
      <PortalFooter ctx={ctx} />
    </div>
  );
}

export function DbNotConfigured() {
  return (
    <Panel hero className="mx-auto max-w-2xl px-8 py-10 text-center">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Data connection
      </div>
      <h2 className="display mt-3 text-[1.6rem]" style={{ color: "var(--fg)" }}>
        The canonical intelligence spine is not connected.
      </h2>
      <p className="mx-auto mt-3 max-w-[52ch] text-[0.92rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Set <span className="code">DATABASE_URL</span> in <span className="code">.env.local</span> — the fastest
        path is copying the sibling repo&rsquo;s env file:
      </p>
      <pre
        className="code mx-auto mt-4 max-w-full overflow-x-auto rounded-[var(--radius-md)] px-4 py-3 text-left text-[0.78rem]"
        style={{ background: "var(--bg-elev-2)", border: "1px solid var(--surface-line-soft)", color: "var(--fg-muted)" }}
      >
        cp &quot;../AG Sourcing Tool 20_06_2026/.env&quot; .env.local
      </pre>
      <p className="mt-4 mb-0 text-[0.84rem]" style={{ color: "var(--fg-dim)" }}>
        Nothing renders from placeholder data — an unconnected portal says so.
      </p>
    </Panel>
  );
}

/** First-run: vendor selection is the only configuration, so it is the welcome. */
export function FirstRunSelector({
  ctx,
  returnTo,
}: {
  ctx: Extract<PortalContext, { dbReady: true }>;
  returnTo: string;
}) {
  return (
    <Panel hero className="px-6 py-8 sm:px-10 sm:py-10">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Define your market
      </div>
      <h2 className="display mt-3 max-w-[26ch] text-[1.9rem] leading-tight" style={{ color: "var(--fg)" }}>
        Select the Services vendors you care about.
      </h2>
      <p className="mt-3 max-w-[64ch] text-[0.95rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        AnalystGenius continuously identifies where market change has created new commercial
        opportunity. Your selected vendors define the market: every metric, benchmark, ranking and
        analyst insight is scoped to them — vendors you contract with, vendors you are tracking, or
        the whole supported market.
      </p>
      <form method="GET" action="/select" className="mt-6">
        <input type="hidden" name="return" value={returnTo} />
        <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2 lg:grid-cols-3">
          {ctx.universe.map((v) => (
            <label
              key={v.ticker}
              className="tap tap-stack flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[0.88rem] hover:bg-[color-mix(in_srgb,var(--fg)_4%,transparent)]"
            >
              <input type="checkbox" name="vendors" value={v.ticker} className="mt-1.5 accent-[var(--accent-fill)]" />
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
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="tap cursor-pointer rounded-md px-5 py-2 text-[0.9rem] font-semibold"
            style={{ background: "var(--accent-fill)", color: "#07142a", border: "none" }}
          >
            Track selected vendors
          </button>
          <Link
            href={`/select?market=whole&return=${encodeURIComponent(returnTo)}`}
            className="tap text-[0.9rem]"
            style={{ color: "var(--rail-ink)" }}
          >
            Or track the whole market — all {ctx.universe.length} AG-covered vendors
          </Link>
        </div>
      </form>
    </Panel>
  );
}

function PortalFooter({ ctx }: { ctx: PortalContext }) {
  const blocked = aiEnterpriseStatus();
  return (
    <footer style={{ borderTop: "1px solid var(--surface-line-soft)", background: "var(--bg-elev-2)" }}>
      <div className="mx-auto max-w-[var(--max-width)] px-5 py-6 sm:px-8">
        {ctx.dbReady ? (
          <ul className="code m-0 flex list-none flex-wrap gap-x-6 gap-y-1.5 p-0 text-[0.68rem]" style={{ color: "var(--fg-dim)" }}>
            {ctx.freshness.map((f) => (
              <li key={f.source} title={f.feeds}>
                {f.source}: {f.lastSeen ? `${shortDate(f.lastSeen)} (${agoDays(f.daysSince)})` : "never"}
                {f.snapshots === 1 ? " · loaded once" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 mb-0 max-w-[100ch] text-[0.72rem] leading-relaxed" style={{ color: "var(--fg-dim)" }}>
          AnalystGenius intelligence is shown as result, direction, confidence, freshness and analyst
          interpretation. Inference methodology is proprietary and is not exposed. {blocked.reason}{" "}
          Where evidence is insufficient, the portal says so rather than estimating.
        </p>
        {/* Approved brand mark — indigo variant, deliberately set on a warm-white
            tile so the mark sits on a light ground (per brand rule). One
            placement only; the masthead carries the white variant. */}
        <div className="mt-5 flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]"
            style={{ background: "var(--warm-white, #f6f1e7)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/ag-mark-on-light.png" alt="" width={22} height={22} className="h-[22px] w-[22px] select-none" />
          </span>
          <span className="code text-[0.7rem]" style={{ color: "var(--fg-dim)" }}>
            AnalystGenius · Buyer Portal
          </span>
        </div>
      </div>
    </footer>
  );
}
