import { Suspense } from "react";
import type { MarketIntel } from "@/lib/metrics/types";
import type { Scenario } from "@/lib/scenarios";
import { getInsight, type InsightTab } from "@/lib/insight/generate";
import { Panel } from "./ui";

/**
 * The Analyst Insight hero (spec §7) — the first element of every tab.
 *
 * States are explicit: generating (Suspense fallback), delivered, model not
 * configured, or withheld by the grounding firewall. No state ever shows
 * substitute prose (spec §29: no fake copy while loading).
 */

const TAB_LABEL: Record<InsightTab, string> = {
  // "Today" would overclaim during manual-refresh testing: the briefing
  // reflects the last refresh, which may not be today.
  home: "Since last refresh",
  market: "Market",
  vendors: "Vendors",
  "vendor-detail": "Vendor",
  opportunities: "Opportunities",
  scenarios: "Scenario",
  reputation: "Reputation",
  "opportunity-detail": "Opportunity briefing",
};

function Frame({ tab, children }: { tab: InsightTab; children: React.ReactNode }) {
  return (
    <Panel hero className="px-6 py-7 sm:px-10 sm:py-9">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Analyst Insight · {TAB_LABEL[tab]}
      </div>
      <div aria-hidden="true" className="mt-3 h-px w-10" style={{ background: "var(--accent-fill)", opacity: 0.7 }} />
      <div className="mt-4">{children}</div>
    </Panel>
  );
}

function InsightResultView({
  result,
  scenario,
}: {
  result: Awaited<ReturnType<typeof getInsight>>;
  scenario?: Scenario | null;
}) {

  if (result.status === "no-scope") {
    return (
      <p className="display m-0 max-w-[62ch] text-[1.25rem] leading-[1.5]" style={{ color: "var(--fg-muted)" }}>
        Select the vendors that define your market to receive an analyst briefing.
      </p>
    );
  }

  if (result.status === "not-configured") {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed px-4 py-3"
        style={{ borderColor: "var(--surface-line)" }}
      >
        <div className="font-medium" style={{ color: "var(--fg)" }}>
          Analyst Insight is not configured.
        </div>
        <p className="code mt-1 mb-0 text-[0.88rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {result.reason}
        </p>
      </div>
    );
  }

  if (result.status === "blocked") {
    // Calm, factual refusal — an integrity note, never an alarm banner.
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed px-5 py-4"
        style={{ borderColor: "var(--surface-line)" }}
      >
        <div className="font-medium" style={{ color: "var(--fg)" }}>
          Analyst Insight temporarily unavailable.
        </div>
        <p className="mt-1.5 mb-0 max-w-[70ch] text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          The intelligence below is complete and unaffected.
        </p>
      </div>
    );
  }

  /* Editorial lede: the first sentence carries the page — display scale —
     with the remainder set as body prose beneath it. */
  const text = result.text.trim();
  const sentenceCut = text.search(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  const colonCut = text.indexOf(": ");
  // Prefer whichever editorial break lands in kicker range; colon breaks
  // ("…is X: the detail…") make natural analyst-note ledes.
  const candidates = [sentenceCut, colonCut >= 0 ? colonCut + 1 : -1].filter((c) => c > 40 && c < 230);
  const cut = candidates.length ? Math.min(...candidates) : -1;
  const lede = cut > 0 ? text.slice(0, cut) : null;
  const body = lede ? text.slice(cut).trim() : text;

  return (
    <>
      {lede ? (
        <p
          className="display m-0 max-w-[52ch] text-[1.55rem] leading-[1.35] sm:text-[1.72rem]"
          style={{ color: "var(--fg)" }}
        >
          {lede}
        </p>
      ) : null}
      <p
        className={`display m-0 max-w-[64ch] whitespace-pre-line text-[1.12rem] leading-[1.6] sm:text-[1.18rem] ${lede ? "mt-4" : ""}`}
        style={{ color: "var(--fg)", opacity: 0.92 }}
      >
        {body}
      </p>
      <div className="code mt-5 text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
        Grounded in the canonical intelligence below · interpretation, not additional data
        {scenario ? ` · modelled under “${scenario.label}”` : ""}
      </div>
    </>
  );
}

async function AwaitInsight({
  promise,
  scenario,
}: {
  promise: ReturnType<typeof getInsight>;
  scenario?: Scenario | null;
}) {
  return <InsightResultView result={await promise} scenario={scenario} />;
}

const PENDING = Symbol("pending");

export async function AnalystInsightHero(props: {
  intel: MarketIntel;
  tab: InsightTab;
  focalTicker?: string;
  scenario?: Scenario | null;
}) {
  const promise = getInsight(props.intel, props.tab, {
    focalTicker: props.focalTicker,
    scenario: props.scenario,
  });

  // Cached briefings resolve immediately — render them inline rather than
  // through a streamed Suspense swap. Only a genuinely slow first generation
  // takes the "Preparing Analyst Insight…" path (spec §29).
  const quick = await Promise.race([
    promise,
    new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), 400)),
  ]);

  if (quick !== PENDING) {
    return (
      <Frame tab={props.tab}>
        <InsightResultView result={quick} scenario={props.scenario} />
      </Frame>
    );
  }

  return (
    <Frame tab={props.tab}>
      <Suspense
        fallback={
          <div aria-live="polite">
            <p className="display m-0 text-[1.28rem]" style={{ color: "var(--fg-muted)" }}>
              Preparing this market briefing…
            </p>
            {/* The briefing streams in on its own — no refresh, no client JS.
                Say so, so a reader does not sit waiting or reload the page. */}
            <p className="m-0 mt-2 text-[0.94rem] leading-snug" style={{ color: "var(--fg-dim)" }}>
              Prepared from the evidence for your selected market. It will appear here when ready —
              the intelligence below is complete and usable now.
            </p>
            <div className="skeleton mt-4 h-4 w-[86%]" />
            <div className="skeleton mt-2 h-4 w-[74%]" />
            <div className="skeleton mt-2 h-4 w-[63%]" />
          </div>
        }
      >
        <AwaitInsight promise={promise} scenario={props.scenario} />
      </Suspense>
    </Frame>
  );
}
