import "server-only";

/**
 * Adapter: the SourcingGenius `/api/decision` service — AG's per-renewal
 * decision briefs, CONSUMED over its stable server-to-server API rather than
 * reimplemented here (integration-boundary rule). Bearer-token auth, exactly
 * as that service specifies.
 *
 * Not configured / unreachable are rendered states: the vendor detail page
 * says AG renewal briefs are not connected, and never substitutes its own.
 */

export interface AgRenewal {
  dealId: string;
  client: string;
  line: string | null;
  industry: string | null;
  capability: string[];
  tcvUsd: number | null;
  endDate: string;
  daysRemaining: number;
  domain: { id: string; label: string; question: string } | null;
}

export type DecisionApiResult =
  | { status: "ok"; provider: string | null; count: number; renewals: AgRenewal[]; coverageNote: string | null }
  | { status: "not-configured"; reason: string }
  | { status: "error"; reason: string };

export async function fetchAgRenewals(ticker: string, horizon: 6 | 12 | 24 = 12): Promise<DecisionApiResult> {
  const base = process.env.DECISION_API_URL;
  if (!base) {
    return {
      status: "not-configured",
      reason:
        "AG renewal briefs are not connected. Set DECISION_API_URL and DECISION_API_TOKEN to consume the SourcingGenius decision service.",
    };
  }
  const headers: Record<string, string> = {};
  if (process.env.DECISION_API_TOKEN) headers.authorization = `Bearer ${process.env.DECISION_API_TOKEN}`;

  try {
    const res = await fetch(`${base}?ticker=${encodeURIComponent(ticker)}&horizon=${horizon}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return { status: "error", reason: `Decision service returned ${res.status}.` };
    const body = (await res.json()) as {
      provider?: string | null;
      count?: number;
      renewals?: AgRenewal[];
      coverage?: { reason?: string | null };
    };
    return {
      status: "ok",
      provider: body.provider ?? null,
      count: body.count ?? 0,
      renewals: body.renewals ?? [],
      coverageNote: body.coverage?.reason ?? null,
    };
  } catch (e) {
    return { status: "error", reason: `Decision service unreachable: ${(e as Error).message}` };
  }
}
