import type { Metadata } from "next";
import { BackofficeRefresh } from "@/components/BackofficeRefresh";
import { Hairline, Panel, SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Backoffice — AnalystGenius", robots: { index: false, follow: false } };

/**
 * BACKOFFICE — operator area, testing phase. Not linked from product
 * navigation; localhost-only. One purpose: manually initiate the sanctioned
 * data refresh and see what it did. REFRESH IS MANUAL UNTIL FURTHER NOTICE.
 */
export default function BackofficePage() {
  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-16 pt-10 sm:px-8">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Backoffice · Operator · Testing phase
      </div>
      <h1 className="display mt-2 text-[1.9rem] leading-tight" style={{ color: "var(--fg)" }}>
        Manual data refresh
      </h1>
      <p className="mt-3 max-w-[70ch] text-[1.02rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Refresh is manual until further notice: run → validate results → review the portal → continue
        testing. This button invokes the AG repo&rsquo;s single sanctioned entry point
        (<span className="code">ops/refresh-manual.sh</span>) — identical to running it in a terminal.
        Every stage is idempotent, every truth/quality gate applies, and evidence dates are preserved —
        a refresh can never manufacture freshness.
      </p>

      <section className="mt-8">
        <Panel className="px-6 py-6">
          <BackofficeRefresh />
        </Panel>
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
                  <th className="eyebrow px-3 py-2 text-left font-semibold">Component</th>
                  <th className="eyebrow px-3 py-2 text-left font-semibold">Estimated cost</th>
                  <th className="eyebrow px-3 py-2 text-left font-semibold">Why</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--fg)" }}>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-2.5">External data sources</td>
                  <td className="tabular px-3 py-2.5">$0.00</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--fg-muted)" }}>SEC EDGAR and FRED are free; the AG API and AI Enterprise DB are your own services.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-2.5">LLM usage in the pipeline</td>
                  <td className="tabular px-3 py-2.5">$0.00</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--fg-muted)" }}>Classification and materiality gating are deterministic — no model calls during refresh.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-2.5">Neon database compute</td>
                  <td className="tabular px-3 py-2.5">≈ $0.01–0.05</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--fg-muted)" }}>Roughly 5–10 minutes of autoscaled activity for staging, promotion and snapshots.</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-2.5">Analyst Insight regeneration (consequential)</td>
                  <td className="tabular px-3 py-2.5">≈ $0.30–0.60</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--fg-muted)" }}>
                    If the data changed, cached briefings expire; the next visit to each surface regenerates
                    (~12–16 briefings × roughly $0.02–0.03 each on claude-sonnet-5, including occasional retries).
                    Only pages actually visited regenerate.
                  </td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--surface-line)" }}>
                  <td className="px-3 py-2.5 font-medium">Typical total per refresh cycle</td>
                  <td className="tabular px-3 py-2.5 font-medium">under $1</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--fg-muted)" }}>Dominated by insight regeneration; the pipeline itself costs effectively nothing.</td>
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
