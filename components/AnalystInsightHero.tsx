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

/**
 * The headline every Analyst Insight section opens with.
 *
 * Bold display scale in EVERY state — delivered, waiting, unconfigured or
 * withheld. A reader arriving at the top of a tab should always meet a
 * headline rather than a paragraph, so the treatment is a shared component
 * and not a conditional branch of the delivered case.
 *
 * `tight` steps the size down for a long headline, which reads as a headline
 * at 1.42rem where it would read as a wall at 1.72rem.
 */
function InsightHeadline({
  children,
  tight = false,
  muted = false,
}: {
  children: React.ReactNode;
  tight?: boolean;
  muted?: boolean;
}) {
  return (
    <h2
      className={`display m-0 max-w-[52ch] ${
        tight ? "text-[1.3rem] leading-[1.4] sm:text-[1.42rem]" : "text-[1.55rem] leading-[1.35] sm:text-[1.72rem]"
      }`}
      style={{ color: muted ? "var(--fg-muted)" : "var(--fg)", fontWeight: 700 }}
    >
      {children}
    </h2>
  );
}

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
      <InsightHeadline tight muted>
        Select the vendors that define your market to receive an analyst briefing.
      </InsightHeadline>
    );
  }

  if (result.status === "not-configured") {
    return (
      <div
        className="rounded-[var(--radius-md)] border border-dashed px-4 py-3"
        style={{ borderColor: "var(--surface-line)" }}
      >
        <InsightHeadline tight>Analyst Insight is not configured.</InsightHeadline>
        <p className="code mt-2 mb-0 text-[0.93rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
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
        <InsightHeadline tight>Analyst Insight temporarily unavailable.</InsightHeadline>
        <p className="mt-2 mb-0 max-w-[70ch] text-[0.97rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          The intelligence below is complete and unaffected.
        </p>
      </div>
    );
  }

  /* The briefing's own opening statement becomes the headline, with the
     remainder set as body prose beneath it.

     Every briefing gets one. The break was previously required to land
     between 40 and 230 characters, and a briefing whose first sentence ran
     longer than that — the Vendors tab does — simply lost its headline and
     opened on body prose instead. The range is now a PREFERENCE: where no
     break lands inside it, the first sentence still leads, one size step
     down so a long headline reads as a headline rather than a wall.

     The cut is only ever a full sentence or the clause before a colon —
     never a fragment cut at a comma. "X is not Y, but Z" truncated at the
     comma would assert the opposite of the briefing. */
  const text = result.text.trim();
  const sentenceCut = text.search(/(?<=[.!?])\s+(?=[A-Z“"'])/);
  const colonCut = text.indexOf(": ");
  const breaks = [sentenceCut, colonCut >= 0 ? colonCut + 1 : -1]
    .filter((c) => c > 0)
    .sort((x, y) => x - y);
  /* Preference order: a break in comfortable headline range; failing that the
     first break past the 40-character floor; failing that the first break at
     all — so a briefing opening on a very short sentence splits there rather
     than collapsing the whole text into one headline. */
  const cut = breaks.find((c) => c > 40 && c < 230) ?? breaks.find((c) => c > 40) ?? breaks[0] ?? -1;
  /* A briefing with no break at all is one sentence long: it IS the headline,
     and there is no body to set beneath it. */
  const rawHeadline = cut > 0 ? text.slice(0, cut).trim() : text;
  const rawBody = cut > 0 ? text.slice(cut).trim() : "";
  /* A colon cut leaves the headline trailing into nothing and the body opening
     in lower case — one sentence sawn in half and set in two sizes. This is a
     deck-and-lede split, so it is set as one: the joining colon goes, and the
     lede takes a capital.

     The capital is only ever applied to a plain lower-case first letter whose
     second letter is not upper case, so a lower-case-initial name (eBay,
     iPhone) is left exactly as the briefing wrote it. Nothing else in the text
     is altered — no word is added, removed or reordered. */
  const headline = rawHeadline.replace(/:$/, "");
  const body =
    cut > 0 && rawHeadline.endsWith(":") && /^[a-z][^A-Z]/.test(rawBody)
      ? rawBody.charAt(0).toUpperCase() + rawBody.slice(1)
      : rawBody;
  const longHeadline = headline.length > 230;

  return (
    <>
      <InsightHeadline tight={longHeadline}>{headline}</InsightHeadline>
      {body ? (
        <p
          className="display m-0 mt-4 max-w-[64ch] whitespace-pre-line text-[1.15rem] leading-[1.6] sm:text-[1.18rem]"
          style={{ color: "var(--fg)", opacity: 0.92 }}
        >
          {body}
        </p>
      ) : null}
      <div className="code mt-5 text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
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
            <InsightHeadline tight muted>Preparing this market briefing…</InsightHeadline>
            {/* The briefing streams in on its own — no refresh, no client JS.
                Say so, so a reader does not sit waiting or reload the page. */}
            <p className="m-0 mt-2.5 text-[0.97rem] leading-snug" style={{ color: "var(--fg-dim)" }}>
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
