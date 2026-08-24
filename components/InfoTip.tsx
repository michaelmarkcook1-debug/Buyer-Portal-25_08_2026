import type { MetricSemantics } from "@/lib/metrics/dictionary";

/**
 * Restrained "i" affordance beside a metric label.
 *
 * Uses the platform popover API, which gives keyboard activation, Escape to
 * close, light-dismiss and focus handling natively — the portal ships no
 * client JS, and a hover-only tooltip would be unusable on touch and to
 * keyboard users. `title` adds a hover hint on top for pointer users.
 *
 * Placement is at the LABEL level, never per repeated cell, so a dense table
 * gains one affordance per column rather than one per value.
 *
 * The touch target comes from .hit-target's overlay, NOT from .tap: .tap's
 * 44px min-height would stretch this fixed-width control into a tall pill on
 * mobile. The overlay keeps the dot round at every width.
 */

let seq = 0;
const nextId = (): string => `infotip-${(seq += 1)}`;

export interface InfoContent {
  name: string;
  definition: string;
  interpretation: string;
  caveat?: string;
  window?: string;
  /** What the colour on this reading conveys. */
  colour?: string;
}

export function InfoTip({ content }: { content: InfoContent }) {
  const id = nextId();
  return (
    <>
      <button
        type="button"
        // @ts-expect-error popoverTarget is a valid DOM attribute
        popovertarget={id}
        aria-label={`About ${content.name}`}
        title={`${content.name}: ${content.definition}`}
        className="hit-target inline-flex h-[15px] w-[15px] shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-[10px] leading-none transition-colors"
        style={{
          border: "1px solid var(--surface-line)",
          color: "var(--fg-dim)",
          background: "transparent",
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <div
        id={id}
        popover="auto"
        role="note"
        className="max-w-[min(34rem,90vw)] rounded-[var(--radius-md)] px-5 py-4 text-left"
        style={{
          background: "var(--surface-solid)",
          border: "1px solid var(--surface-line)",
          boxShadow: "var(--shadow-2)",
          color: "var(--fg)",
          // These affordances sit inside .eyebrow headers, which set uppercase
          // and wide tracking. Explanatory prose must not inherit either.
          textTransform: "none",
          letterSpacing: "normal",
        }}
      >
        <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          {content.name}
        </div>
        <p className="mt-2 mb-0 text-[0.95rem] leading-relaxed" style={{ color: "var(--fg)" }}>
          {content.definition}
        </p>
        <p className="mt-2.5 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          <span style={{ color: "var(--fg-dim)" }}>How to read it: </span>
          {content.interpretation}
        </p>
        {content.colour ? (
          <p className="mt-2 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--fg-dim)" }}>Colour: </span>
            {content.colour}
          </p>
        ) : null}
        {content.window ? (
          <p className="mt-2 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--fg-dim)" }}>Period: </span>
            {content.window}
          </p>
        ) : null}
        {content.caveat ? (
          <p className="mt-2 mb-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--fg-dim)" }}>What it does not mean: </span>
            {content.caveat}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Standing explanation of what the colours mean, shared by every reading. */
export const COLOUR_KEY =
  "Teal marks conditions that favour the buyer, amber marks readings that need attention or are ambiguous, red marks conditions that work against the buyer or carry elevated risk, and muted text is neutral context.";

/** Build tooltip content from a dictionary entry. */
export function fromSemantics(s: MetricSemantics): InfoContent {
  return {
    name: s.name,
    definition: s.definition,
    interpretation: s.interpretation,
    caveat: s.caveat,
    window: s.window,
    colour: COLOUR_KEY,
  };
}
