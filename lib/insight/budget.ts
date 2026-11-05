import "server-only";
import { q } from "@/lib/db";

/**
 * A ceiling on model calls per hour, shared by every server instance.
 *
 * With PUBLIC_ACCESS on, anyone can open any vendor subset, tab and scenario,
 * and each new combination is a fresh briefing of up to three model calls.
 * Caching bounds repeat views, not novel ones, so without a ceiling a script
 * cycling `?vendors=` subsets spends without limit on the owner's key (audit
 * 5 Nov 2026). Past the ceiling the briefing reads as briefly unavailable;
 * every canonical figure on the page is unaffected.
 *
 * The counter lives in a portal-owned table beside portal_user. Nothing
 * canonical is written. INSIGHT_HOURLY_CALL_CAP=0 removes the ceiling.
 */

export const DEFAULT_HOURLY_CALL_CAP = 150;

export function hourlyCallCap(): number {
  const raw = process.env.INSIGHT_HOURLY_CALL_CAP;
  const n = raw == null || raw.trim() === "" ? DEFAULT_HOURLY_CALL_CAP : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_HOURLY_CALL_CAP;
}

let ensured = false;

/** Claims one model call against this hour's ceiling. False once it is spent. */
export async function takeModelCall(): Promise<boolean> {
  const cap = hourlyCallCap();
  if (cap === 0) return true;
  try {
    if (!ensured) {
      await q(`CREATE TABLE IF NOT EXISTS portal_llm_spend (
                 hour  timestamptz PRIMARY KEY,
                 calls integer NOT NULL DEFAULT 0
               )`);
      ensured = true;
    }
    const [row] = await q<{ calls: number }>(
      `INSERT INTO portal_llm_spend (hour, calls) VALUES (date_trunc('hour', now()), 1)
       ON CONFLICT (hour) DO UPDATE SET calls = portal_llm_spend.calls + 1
       RETURNING calls`,
    );
    return Number(row?.calls ?? 0) <= cap;
  } catch (e) {
    /* The counter is a spend guard, not a truth control: if it cannot be read
       the call proceeds, and the failure is logged. */
    console.warn(`[insight-budget] counter unavailable: ${(e as Error).message}`);
    return true;
  }
}
