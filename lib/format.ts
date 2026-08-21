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
