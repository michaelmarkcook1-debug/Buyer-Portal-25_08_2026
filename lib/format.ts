/** Formatting helpers. Figures render tabular; absence renders as "—", never 0. */

export function money(usd: number | null | undefined): string {
  if (usd == null) return "—";
  const abs = Math.abs(usd);
  if (abs >= 1e9) return `$${(usd / 1e9).toFixed(1)}bn`;
  if (abs >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(usd / 1e3).toFixed(0)}k`;
  return `$${usd.toFixed(0)}`;
}

export function count(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-GB");
}

export function signed(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-GB")}`;
}

/** "21 Aug 2026" from a YYYY-MM-DD string — no Date parsing, no timezone drift. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthsRemaining(days: number): string {
  if (days < 31) return `${days}d`;
  const months = Math.round(days / 30.4);
  return `${months}mo`;
}

export function agoDays(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}


/* ── value provenance (2026-08-23 directive) ─────────────────────────────────
   Disclosed and inferred value must never blend silently. This is the ONLY
   sanctioned formatter for mixed-provenance sums; inferred values render as
   ranges (or an explicitly-approximate unbanded figure), never as bare fact. */

export interface ValueMix {
  disclosedUsd: number | null;
  inferredLowUsd: number | null;
  inferredMidUsd: number | null;
  inferredHighUsd: number | null;
}

export function formatValueMix(v: ValueMix): string {
  const d = v.disclosedUsd ?? 0;
  const hasInf = (v.inferredMidUsd ?? 0) > 0 || (v.inferredLowUsd ?? 0) > 0;
  if (!hasInf) return money(d || null);
  const banded = (v.inferredLowUsd ?? 0) > 0 && (v.inferredHighUsd ?? 0) > 0;
  const inf = banded
    ? `${money(v.inferredLowUsd)}\u2013${money(v.inferredHighUsd)} inferred`
    : `\u2248${money(v.inferredMidUsd)} inferred (unbanded)`;
  if (d > 0) return `${money(d)} disclosed + ${inf}`;
  return inf;
}

/** True when inferred value outweighs disclosed — downstream confidence must step down. */
export function inferredDominates(v: ValueMix): boolean {
  return (v.inferredMidUsd ?? 0) > (v.disclosedUsd ?? 0);
}

export interface TcvDisplayInput {
  tcvUsd?: number | null;
  valueProvenance?: string | null;
  tcvLowUsd?: number | null;
  tcvMidUsd?: number | null;
  tcvHighUsd?: number | null;
}

/**
 * The only three TCV states a buyer ever sees: a known value, an estimated
 * range, or an explicit withholding. Never a confidence score, comparable
 * count, model version, or anything about how the estimate was derived.
 */
export function formatTcvDisplay(v: TcvDisplayInput): string {
  if (v.tcvUsd != null && v.tcvUsd > 0) return money(v.tcvUsd);
  if (v.valueProvenance === "inferred") {
    if (v.tcvLowUsd != null && v.tcvHighUsd != null && v.tcvHighUsd > 0) {
      return `${money(v.tcvLowUsd)}–${money(v.tcvHighUsd)} est.`;
    }
    if (v.tcvMidUsd != null && v.tcvMidUsd > 0) return `≈${money(v.tcvMidUsd)} est.`;
  }
  return "Not reliably estimable";
}
