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
  home: "Today",
  market: "Market",
  vendors: "Vendors",
  "vendor-detail": "Vendor",
  opportunities: "Opportunities",
  scenarios: "Scenario",
  "opportunity-detail": "Opportunity briefing",
};

function Frame({ tab, children }: { tab: InsightTab; children: React.ReactNode }) {
  return (
    <Panel hero className="px-6 py-6 sm:px-9 sm:py-8">
      <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
        Analyst Insight · {TAB_LABEL[tab]}
      </div>
      <div className="mt-3">{children}</div>
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
        <p className="code mt-1 mb-0 text-[0.78rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {result.reason}
        </p>
      </div>
    );
  }

  if (result.status === "blocked") {
    return (
      <div
        className="rounded-[var(--radius-md)] px-4 py-3"
        style={{ background: "var(--data-risk-soft)" }}
      >
        <div className="font-medium" style={{ color: "var(--data-risk-ink)" }}>
          Analyst Insight withheld.
        </div>
        <p className="mt-1 mb-0 text-[0.84rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          The generated briefing failed grounding validation and is not shown.{" "}
          {result.reasons[0] ?? ""}
        </p>
      </div>
    );
  }

  return (
    <>
      <p
        className="display m-0 max-w-[64ch] whitespace-pre-line text-[1.28rem] leading-[1.52] sm:text-[1.4rem]"
        style={{ color: "var(--fg)" }}
      >
        {result.text}
      </p>
      <div className="code mt-4 text-[0.68rem]" style={{ color: "var(--fg-dim)" }}>
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
              Preparing Analyst Insight…
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
