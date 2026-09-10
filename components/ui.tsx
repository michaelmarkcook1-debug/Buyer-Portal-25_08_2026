import type { ReactNode } from "react";
import { showsConfidenceCaveat } from "@/lib/metrics/rules";
import { displayState, levelEffect, type BuyerEffect } from "@/lib/metrics/dictionary";
import type { Confidence, MetricState, Movement, OpportunityLevel, WatchClass } from "@/lib/metrics/types";

/* ── surfaces ─────────────────────────────────────────────────────── */

/** The base card: hairline, soft radius, gold-rimmed glass at hero weight. */
export function Panel({
  children,
  className = "",
  hero = false,
}: {
  children: ReactNode;
  className?: string;
  hero?: boolean;
}) {
  return (
    <section
      className={className}
      style={{
        background: hero ? "var(--bg-glass)" : "var(--bg-elev-1)",
        border: "1px solid var(--surface-line)",
        borderRadius: hero ? "var(--radius-card)" : "var(--radius-md)",
        boxShadow: hero ? "var(--shadow-glass)" : "var(--shadow-1)",
        ...(hero ? { backdropFilter: "blur(18px) saturate(140%)", WebkitBackdropFilter: "blur(18px) saturate(140%)" } : {}),
      }}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="display mt-1.5 text-[1.55rem] text-[var(--fg)]">{title}</h2>
      </div>
      {aside ? <div className="text-sm sm:shrink-0" style={{ color: "var(--fg-muted)" }}>{aside}</div> : null}
    </div>
  );
}

export function Hairline({ className = "" }: { className?: string }) {
  return <hr className={`rule ${className}`} />;
}

/* ── semantic display language (spec §18/§19) ─────────────────────── */

export const STATE_LABEL: Record<MetricState, string> = {
  favourable: "Favourable",
  stable: "Stable",
  unfavourable: "Unfavourable",
  mixed: "Mixed",
  insufficient: "Insufficient evidence",
};

const STATE_INK: Record<MetricState, string> = {
  favourable: "var(--data-positive-ink)",
  stable: "var(--fg-muted)",
  unfavourable: "var(--data-risk-ink)",
  mixed: "var(--data-watch-ink)",
  insufficient: "var(--fg-dim)",
};

export const MOVEMENT_LABEL: Record<Movement, string> = {
  "materially-improving": "Materially improving",
  improving: "Improving",
  stable: "Stable",
  deteriorating: "Deteriorating",
  "materially-deteriorating": "Materially deteriorating",
  insufficient: "No direction held",
};

const MOVEMENT_GLYPH: Record<Movement, string> = {
  "materially-improving": "↑",
  improving: "↗",
  stable: "→",
  deteriorating: "↘",
  "materially-deteriorating": "↓",
  insufficient: "—",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  insufficient: "Insufficient evidence",
};

export const LEVEL_LABEL: Record<OpportunityLevel, string> = {
  "very-high": "Very High",
  high: "High",
  medium: "Medium",
  low: "Low",
  insufficient: "Insufficient evidence",
};

/* Gold is hierarchy, not celebration (§14): by default even Very High reads
   in the positive ink — gold is applied only where a level is THE emphasis
   (dominant lever, #1 rank) via the `emphasis` prop. */
const LEVEL_INK: Record<OpportunityLevel, string> = {
  "very-high": "var(--data-positive-ink)",
  high: "var(--data-positive-ink)",
  medium: "var(--fg-muted)",
  low: "var(--fg-dim)",
  insufficient: "var(--fg-dim)",
};

/* ── semantic atoms — colour is never the sole carrier ────────────── */

/** Colour is keyed to BUYER EFFECT, never to how positive the word sounds. */
export const EFFECT_INK: Record<BuyerEffect, string> = {
  favourable: "var(--data-positive-ink)",
  caution: "var(--data-watch-ink)",
  unfavourable: "var(--data-risk-ink)",
  neutral: "var(--fg-muted)",
  unknown: "var(--fg-dim)",
};

/**
 * Renders a canonical state in the wording and tone correct for its variable.
 * Pass `metricId` so "favourable" on operational risk reads "Low" while the
 * same state on provider momentum reads "Strengthening" and is toned as a
 * caution — the word and the colour both follow the variable, not a shared
 * favourable/unfavourable scale.
 */
export function StateText({ state, metricId, className = "" }: { state: MetricState; metricId?: string; className?: string }) {
  const d = metricId ? displayState(metricId, state) : null;
  const label = d ? d.label : STATE_LABEL[state];
  const ink = d ? EFFECT_INK[d.effect] : STATE_INK[state];
  return (
    <span className={`mark-dir font-medium ${className}`} style={{ color: ink }}>
      {label}
    </span>
  );
}

/**
 * A direction, coloured by what it MEANS for the buyer — never by which way
 * the number went.
 *
 * This component used to read the movement word: "improving" was painted
 * positive and "deteriorating" risk-red. That is the raw-direction axis, and
 * on the variables where the two axes diverge it asserted the opposite of the
 * analysis sitting beside it. Public awards falling 146 → 12 rendered red
 * next to prose explaining that providers are competing for materially less
 * new work; a strengthening supplier rendered green next to a dictionary
 * entry calling it a caution.
 *
 * `effect` is therefore supplied by the caller, which knows the variable.
 * Without it the movement is DESCRIPTIVE — neutral ink, no buyer verdict —
 * because a component holding only the word "deteriorating" cannot know
 * whether that is good or bad for the reader, and guessing is the defect.
 */
export function MovementText({
  movement,
  effect,
  className = "",
}: {
  movement: Movement;
  /** Buyer effect for this movement, from movementEffect() or the caller's
      own canonical state. Omitted where the direction carries no buyer
      verdict — a legend, a count, an unmapped variable. */
  effect?: BuyerEffect;
  className?: string;
}) {
  const ink = effect ? EFFECT_INK[effect] : "var(--fg-muted)";
  return (
    <span className={`tabular ${className}`} style={{ color: ink }}>
      <span aria-hidden="true">{MOVEMENT_GLYPH[movement]} </span>
      {MOVEMENT_LABEL[movement]}
    </span>
  );
}

/**
 * §18: state the caveat only when it changes how the reading should be used.
 * "Confidence: High" on every tile turned the product into a confidence
 * dashboard; a thin reading still says so, because that is decision-relevant.
 */
export function ConfidenceText({ confidence }: { confidence: Confidence }) {
  if (!showsConfidenceCaveat(confidence)) return null;
  return (
    <span className="eyebrow" style={{ letterSpacing: "0.14em" }}>
      {confidence === "insufficient" ? "Insufficient evidence" : "Directional — evidence is thin"}
    </span>
  );
}

/**
 * An opportunity level as text.
 *
 * `emphasis` marks a RANKING position (the top-ranked vendor, a row's dominant
 * lever). It may change weight and it may add a rule, but it must NEVER change
 * the colour: colour is reserved for what the reading means for the buyer.
 * Overriding it with the brand accent made a Medium at rank 1 look stronger
 * than a Very High at rank 2, which inverted the very thing the page ranks.
 */
export function LevelText({ level, className = "", emphasis = false }: { level: OpportunityLevel; className?: string; emphasis?: boolean }) {
  if (level === "insufficient") {
    return (
      <span className={`italic ${className}`} style={{ color: "var(--fg-dim)" }}>
        Insufficient evidence
      </span>
    );
  }
  return (
    <span
      className={`mark-dir ${emphasis ? "font-semibold" : "font-medium"} ${className}`}
      style={{
        color: EFFECT_INK[levelEffect(level)],
        // rank emphasis reads as typographic weight plus a hairline, never as hue
        ...(emphasis
          ? { borderBottom: "2px solid var(--accent-fill)", paddingBottom: "1px" }
          : null),
      }}
    >
      {LEVEL_LABEL[level]}
    </span>
  );
}

/* ── ACT / WATCH / KNOW — the only classifications (spec §26) ─────── */

const CLASS_STYLE: Record<WatchClass, { bg: string; fg: string; ring: string }> = {
  ACT: { bg: "var(--accent-fill)", fg: "#07142a", ring: "transparent" },
  WATCH: { bg: "var(--data-watch-soft)", fg: "var(--data-watch-ink)", ring: "color-mix(in srgb, var(--data-watch) 40%, transparent)" },
  KNOW: { bg: "transparent", fg: "var(--fg-dim)", ring: "var(--surface-line)" },
};

export function ClassChip({ cls }: { cls: WatchClass }) {
  const s = CLASS_STYLE[cls];
  return (
    <span
      className="code inline-flex items-center rounded-[6px] px-2 py-1 text-[13.5px] font-semibold tracking-[0.14em]"
      style={{ background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.ring}` }}
    >
      {cls}
    </span>
  );
}

/* ── small atoms ──────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/**
 * A supporting fact with its source — the receipts, always below the
 * conclusion. Facts carry their evidence ownership: everything the portal
 * holds today is market/public observation, and is labelled as such so a
 * third-party contract can never read as the buyer's own.
 */
export function BasisList({
  basis,
  className = "",
}: {
  basis: Array<{ text: string; source: string; ownership?: "market" | "buyer"; asOf?: string | null }>;
  className?: string;
}) {
  if (basis.length === 0) return null;
  return (
    <ul className={`m-0 list-none space-y-1.5 p-0 ${className}`}>
      {basis.map((b, i) => (
        <li key={i} className="text-[0.98rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {b.text}{" "}
          <span className="code text-[0.88rem]" style={{ color: "var(--fg-dim)" }}>
            · {b.source}
            {b.asOf ? ` · ${b.asOf}` : ""}
            {b.ownership === "market" ? " · market evidence" : b.ownership === "buyer" ? " · buyer-owned" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The honest-absence state — designed, never defaulted (spec §30). */
export function EmptyEvidence({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border border-dashed px-5 py-4"
      style={{ borderColor: "var(--surface-line)", color: "var(--fg-muted)" }}
    >
      <div className="font-medium" style={{ color: "var(--fg)" }}>
        {title}
      </div>
      <p className="mt-1 mb-0 text-[1.00rem] leading-relaxed">{body}</p>
    </div>
  );
}

/** Modelled-value marker — scenario outputs are never dressed as evidence. */
export function ModelledTag({ note }: { note: string }) {
  return (
    <span
      className="code inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[0.87rem] uppercase tracking-[0.12em]"
      style={{ background: "var(--rail-soft)", color: "var(--rail-ink)" }}
      title={note}
    >
      Modelled
    </span>
  );
}
