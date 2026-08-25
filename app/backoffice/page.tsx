import type { Metadata } from "next";
import { BackofficeRefresh } from "@/components/BackofficeRefresh";
import { Hairline, Panel, SectionHeader } from "@/components/ui";
import { detectExecutor } from "@/lib/backoffice/executor";
import { getFreshness, getSpineAnchor } from "@/lib/data/facts";
import { isDbConfigured } from "@/lib/db";
import { count, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Backoffice — AnalystGenius", robots: { index: false, follow: false } };

/**
 * BACKOFFICE — operator area, testing phase. Outside product navigation.
 *
 * During testing refreshes are run by hand from the AG development machine and
 * write to the shared canonical spine. This page therefore does two things,
 * and which one depends only on where it is running: on the AG machine it can
 * start that refresh; everywhere else it reports what the spine holds and what
 * the last run did. Both are complete states — the deployed page is not a
 * degraded copy of the local one.
 *
 * REFRESH IS MANUAL UNTIL FURTHER NOTICE — there is no scheduler.
 */
export default async function BackofficePage() {
  const executor = detectExecutor();
  const ready = isDbConfigured();
  const [freshness, spine] = ready
    ? await Promise.all([getFreshness(), getSpineAnchor()])
    : [[], { lastIngest: "", daysStale: 0, dataAsOf: null, dataAgeDays: null }];
  const tracker = freshness.find((f) => /Contract Tracker curated store/i.test(f.source)) ?? null;
  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-16 pt-10 sm:px-8">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Backoffice · Operator · Testing phase
      </div>
      <h1 className="display mt-2 text-[1.9rem] leading-tight" style={{ color: "var(--fg)" }}>
        Manual data refresh
      </h1>
      <p className="mt-3 max-w-[70ch] text-[1.02rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        {executor.reason === "local-execution" ? (
          <>
            Refresh is manual until further notice: run → validate results → review the portal →
            continue testing. This button invokes the AG repo&rsquo;s single sanctioned entry point
            (<span className="code">ops/refresh-manual.sh</span>) — identical to running it in a
            terminal.
          </>
        ) : executor.reason === "github-actions" ? (
          <>
            Refresh is manual until further notice. This button dispatches one run of the
            AnalystGenius data pipeline in GitHub Actions — the same stages as the local script,
            on a temporary runner. Nothing is scheduled, and progress below is read from the
            canonical spine as the run reports it.
          </>
        ) : (
          <>
            Refreshes are run manually from the AnalystGenius development environment while the
            product is in testing, and write to the shared canonical spine. This portal reads that
            same spine, so it reflects those updates automatically — nothing here needs redeploying
            when data lands.
          </>
        )}{" "}
        Every stage is idempotent, every truth and quality gate applies, and evidence dates are
        preserved — a refresh can never manufacture freshness.
      </p>

      {/* The two dates that are most often confused, side by side and labelled.
          A refresh moves the ingestion date; only newer evidence moves the
          evidence date, so they are shown as separate facts. */}
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>
            Execution
          </div>
          <div className="mt-1 text-[0.98rem]" style={{ color: "var(--fg)" }}>
            {executor.reason === "local-execution"
              ? "This machine"
              : executor.reason === "github-actions"
                ? "GitHub Actions"
                : "Local AG environment"}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>
            Latest evidence
          </div>
          <div className="mt-1 text-[0.98rem]" style={{ color: "var(--fg)" }}>
            {spine.dataAsOf ? shortDate(spine.dataAsOf) : "—"}
            {spine.dataAgeDays == null ? "" : ` · ${spine.dataAgeDays} days old`}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>
            Last ingestion
          </div>
          <div className="mt-1 text-[0.98rem]" style={{ color: "var(--fg)" }}>
            {spine.lastIngest ? shortDate(spine.lastIngest) : "—"}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <Panel className="px-6 py-6">
          <BackofficeRefresh initial={executor} />
        </Panel>
      </section>

      {/* DATA FRESHNESS — evidence date and ingestion date are different facts
          and are shown as different columns. A refresh moves the ingestion
          date; only new evidence moves the evidence date. */}
      <section className="mt-10">
        <SectionHeader
          eyebrow="Freshness"
          title="Evidence by family"
          aside="Evidence date is what the data is about; ingestion is when we last landed it"
        />
        <div className="mt-5">
          <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.95rem]" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Evidence family</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Feeds</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Last ingestion</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Days since</th>
                    <th className="eyebrow px-4 py-2.5 text-left font-semibold">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {freshness.map((f) => (
                    <tr key={f.source} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                      <td className="px-4 py-3" style={{ color: "var(--fg)" }}>{f.source}</td>
                      <td className="px-4 py-3" style={{ color: "var(--fg-muted)" }}>{f.feeds}</td>
                      <td className="tabular px-4 py-3" style={{ color: "var(--fg-muted)" }}>{f.lastSeen ?? "—"}</td>
                      <td className="tabular px-4 py-3" style={{ color: "var(--fg-muted)" }}>
                        {f.daysSince == null ? "—" : `${f.daysSince}d`}
                      </td>
                      <td className="tabular px-4 py-3" style={{ color: "var(--fg-muted)" }}>{count(f.rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="mt-3 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            The portal&apos;s commercial evidence anchor is{" "}
            <strong style={{ color: "var(--fg)" }}>{spine.dataAsOf ? shortDate(spine.dataAsOf) : "not established"}</strong>
            {spine.dataAgeDays != null ? ` (${count(spine.dataAgeDays)} days old)` : ""} — derived from the newest
            evidence itself, never from the clock at the last refresh. A refresh that lands no newer evidence moves
            the ingestion dates above and leaves this anchor exactly where it is.
          </p>
        </div>
      </section>

      {/* CONTRACT TRACKER — separated, and explicitly not part of this refresh. */}
      <section className="mt-10">
        <SectionHeader eyebrow="Separate workstream" title="Contract Tracker" aside="Not run by the manual refresh" />
        <div className="mt-5">
          <Panel className="px-6 py-5">
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <div>
                <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>Included in manual refresh</div>
                <div className="mt-1 text-[1.02rem]" style={{ color: "var(--data-watch-ink)" }}>
                  No — discovery, import and confirmation are all excluded
                </div>
              </div>
              <div>
                <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>State</div>
                <div className="mt-1 text-[1.02rem]" style={{ color: "var(--fg)" }}>
                  Frozen at its confirmed 16 Apr 2026 state
                </div>
              </div>
              {tracker ? (
                <>
                  <div>
                    <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>Curated store — last ingestion</div>
                    <div className="tabular mt-1 text-[1.02rem]" style={{ color: "var(--fg)" }}>
                      {tracker.lastSeen ?? "—"}
                      {tracker.daysSince != null ? ` · ${count(tracker.daysSince)}d ago` : ""}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>Rows on the market record</div>
                    <div className="tabular mt-1 text-[1.02rem]" style={{ color: "var(--fg)" }}>{count(tracker.rows)}</div>
                  </div>
                </>
              ) : null}
            </div>
            <p className="mt-4 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              Reopening this workstream is a separate, explicit decision. Nothing in the manual refresh confirms a
              held record, promotes an unreviewed one, or runs tracker discovery.
            </p>
          </Panel>
        </div>
      </section>

      <section className="mt-10">
        <SectionHeader eyebrow="Scope" title="What a refresh updates — and what it never touches" />
        <Panel className="mt-5 px-6 py-5">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="eyebrow">Runs (in order)</div>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[0.95rem]" style={{ color: "var(--fg)" }}>
                <li>AnalystGenius intelligence — GET-only read</li>
                <li>AI Enterprise — read-only extract</li>
                <li>AI/commercial capability events (confirmed store set + partnerships)</li>
                <li>SEC 8-K/6-K exhibit discovery</li>
                <li>FRED FX / wage / CPI series</li>
                <li>Promotion to the canonical spine</li>
                <li>Vendor primitive snapshots (versioned; “no change” is recorded)</li>
                <li>EDGAR financial claims</li>
              </ul>
            </div>
            <div>
              <div className="eyebrow">Deliberately excluded</div>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[0.95rem]" style={{ color: "var(--fg-muted)" }}>
                <li>Contract Tracker discovery / import / confirmation — frozen at its confirmed 16 Apr 2026 state</li>
                <li>xlsx bridge (manual-export dependent)</li>
                <li>Any write to the protected AnalystGenius production service — its only touchpoint is a read</li>
                <li>Any scheduling — nothing here re-runs automatically</li>
              </ul>
            </div>
          </div>
          <Hairline className="my-4" />
          <p className="code m-0 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
            Stage failures are reported individually and never hidden; a failed stage does not block the others.
            Terminal equivalent: cd &quot;AG Sourcing Tool 20_06_2026&quot; &amp;&amp; ./ops/refresh-manual.sh
          </p>
        </Panel>
      </section>

      <section className="mt-10">
        <SectionHeader eyebrow="Economics" title="Cost estimate per refresh" aside="Estimates, not meters" />
        <Panel className="mt-5 px-6 py-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead>
                <tr>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Component</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Estimated cost</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Why</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--fg)" }}>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-3">External data sources</td>
                  <td className="tabular px-3 py-3">$0.00</td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>SEC EDGAR and FRED are free; the AG API and AI Enterprise DB are your own services.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-3">LLM usage in the pipeline</td>
                  <td className="tabular px-3 py-3">$0.00</td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>Classification and materiality gating are deterministic — no model calls during refresh.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-3">Neon database compute</td>
                  <td className="tabular px-3 py-3">≈ $0.01–0.05</td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>Roughly 5–10 minutes of autoscaled activity for staging, promotion and snapshots.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-3">Analyst Insight regeneration (consequential)</td>
                  <td className="tabular px-3 py-3">≈ $0.30–0.60</td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>
                    If the data changed, cached briefings expire; the next visit to each surface regenerates
                    (~12–16 briefings × roughly $0.02–0.03 each on claude-sonnet-5, including occasional retries).
                    Only pages actually visited regenerate.
                  </td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line)" }}>
                  <td className="px-3 py-3 font-medium">Typical total per refresh cycle</td>
                  <td className="tabular px-3 py-3 font-medium">under $1</td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>Dominated by insight regeneration; the pipeline itself costs effectively nothing.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="code mt-3 mb-0 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
            Wall-clock: ~6–12 minutes. Excluded: Contract Tracker discovery (frozen) — reopening that workstream
            adds its own OpenAI extraction cost (~$0.40/run at July&rsquo;s observed size).
          </p>
        </Panel>
      </section>
    </main>
  );
}
