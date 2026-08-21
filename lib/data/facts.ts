import "server-only";
import { cache } from "react";
import { q } from "@/lib/db";

/**
 * FACTS — the only place this app reads the canonical AG spine.
 *
 * Everything here is a SELECT over authoritative landed data: the curated
 * contract spine, the AG Intelligence signal snapshots (which already embed
 * the upstream extraction honesty gate), SEC 8-K events, and the provider
 * catalog. No score, weight or inference is computed here — states and labels
 * belong to lib/metrics, interpretation to AG services and the insight layer.
 *
 * Conventions inherited from the estate:
 *   · dates leave SQL as text (to_char) — a bare date through the serverless
 *     driver shifts a day in local timezones;
 *   · staging is versioned by content-hash: always take the LATEST row per
 *     ticker (DISTINCT ON … ORDER BY ingested_at DESC);
 *   · sums over nothing stay null — never collapsed to a verified-looking 0;
 *   · nothing hardcodes a count; every figure is computed at request time.
 */

/**
 * The commercial spine now has two curated feeds: the TG structured dataset
 * ('contract_tracker', via the xlsx bridge) and the Contract Tracker curated
 * store's validated non-TG discoveries ('contract_tracker_store'). Both are
 * market evidence; store values land only when the store marks them explicit.
 */
const COMMERCIAL_SYSTEMS = ["contract_tracker", "contract_tracker_store"];

/* ───────────────────────── Freshness ───────────────────────── */

export interface SourceFreshness {
  source: string;
  feeds: string;
  rows: number;
  snapshots: number;
  firstSeen: string | null;
  lastSeen: string | null;
  daysSince: number | null;
}

const FRESHNESS_SOURCES = [
  { table: "stg_curated_deal", source: "Curated contract tracker", feeds: "contract spine — awards, renewals, values" },
  { table: "stg_contract_store", source: "Contract Tracker curated store", feeds: "validated discovered contracts, renewal intelligence" },
  { table: "stg_procurement_contract", source: "Public procurement record", feeds: "award flow across 6 jurisdictions — market evidence" },
  { table: "stg_analystgenius_signal", source: "AnalystGenius signals", feeds: "talent, reputation, top issues, claims vs delivery" },
  { table: "stg_analystgenius_provider", source: "AnalystGenius vendor catalog", feeds: "revenue, growth, AI readiness" },
  { table: "stg_sec_event", source: "SEC 8-K filings", feeds: "corporate events, US-listed vendors" },
] as const;

export const getFreshness = cache(async (): Promise<SourceFreshness[]> => {
  return Promise.all(
    FRESHNESS_SOURCES.map(async ({ table, source, feeds }) => {
      // Table names come from the const list above, never from user input.
      const [r] = await q<{
        rows: string; snapshots: string; first_seen: string | null; last_seen: string | null; days_since: string | null;
      }>(
        `SELECT count(*) AS rows,
                count(DISTINCT ingested_at::date) AS snapshots,
                to_char(min(ingested_at), 'YYYY-MM-DD') AS first_seen,
                to_char(max(ingested_at), 'YYYY-MM-DD') AS last_seen,
                (current_date - max(ingested_at)::date) AS days_since
           FROM ${table}`,
      );
      return {
        source,
        feeds,
        rows: Number(r?.rows ?? 0),
        snapshots: Number(r?.snapshots ?? 0),
        firstSeen: r?.first_seen ?? null,
        lastSeen: r?.last_seen ?? null,
        daysSince: r?.days_since == null ? null : Number(r.days_since),
      };
    }),
  );
});

export interface SpineAnchor {
  /** Last INGEST — pipeline provenance only, never presented as data freshness. */
  lastIngest: string;
  daysStale: number;
  /**
   * DATA-AS-OF — the newest observation date the commercial evidence itself
   * carries (max curated announcement date, max started store contract).
   * Freshness must never be inferred from ingestion timestamps (§1).
   */
  dataAsOf: string | null;
  dataAgeDays: number | null;
}

export const getSpineAnchor = cache(async (): Promise<SpineAnchor> => {
  const [r] = await q<{ last: string; days: string; as_of: string | null; age: string | null }>(
    `WITH curated AS (
       SELECT to_timestamp(((max(NULLIF(announcement_date_raw, '')::float8)) - 25569) * 86400)::date AS d
         FROM stg_curated_deal
     ), store AS (
       SELECT max(left(start_date_raw, 10))::date AS d
         FROM stg_contract_store
        WHERE left(start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')
     )
     SELECT to_char(max(sd.ingested_at), 'YYYY-MM-DD') AS last,
            (current_date - max(sd.ingested_at)::date) AS days,
            to_char(GREATEST((SELECT d FROM curated), (SELECT d FROM store)), 'YYYY-MM-DD') AS as_of,
            (current_date - GREATEST((SELECT d FROM curated), (SELECT d FROM store))) AS age
       FROM stg_curated_deal sd`,
  );
  return {
    lastIngest: r?.last ?? "",
    daysStale: Number(r?.days ?? 0),
    dataAsOf: r?.as_of ?? null,
    dataAgeDays: r?.age == null ? null : Number(r.age),
  };
});

/* ───────────────────────── Vendor universe ───────────────────────── */

export interface UniverseVendor {
  ticker: string;
  name: string;
  contracts: number;
  inPlay24: number;
  signalTypes: number;
  hasSec: boolean;
}

/**
 * The supported vendor universe: every AG-covered vendor (landed catalog ∩
 * ticker crosswalk). The count is whatever the database holds today.
 */
export const getUniverse = cache(async (): Promise<UniverseVendor[]> => {
  const rows = await q<{
    ticker: string; name: string; contracts: string; in_play_24: string; signal_types: string; sec_events: string;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (ticker) ticker, COALESCE(display_name, name) AS name
         FROM stg_analystgenius_provider
        ORDER BY ticker, ingested_at DESC
     ), xr AS (
       SELECT x.external_id AS ticker, x.ag_provider_id
         FROM xref_identity x WHERE x.system = 'ticker'
     )
     SELECT l.ticker, l.name,
            (SELECT count(*) FROM deal d
              WHERE d.ag_provider_id = xr.ag_provider_id AND d.source_system = ANY($1::text[])) AS contracts,
            (SELECT count(*) FROM deal d
              WHERE d.ag_provider_id = xr.ag_provider_id AND d.source_system = ANY($1::text[])
                AND d.end_date >= current_date
                AND d.end_date < current_date + interval '24 months') AS in_play_24,
            (SELECT count(DISTINCT s.signal_type) FROM stg_analystgenius_signal s
              WHERE s.ticker = l.ticker) AS signal_types,
            (SELECT count(*) FROM stg_sec_event e WHERE e.ticker = l.ticker) AS sec_events
       FROM latest l
       JOIN xr ON xr.ticker = l.ticker
      ORDER BY l.name ASC`,
    [COMMERCIAL_SYSTEMS],
  );
  return rows.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    contracts: Number(r.contracts),
    inPlay24: Number(r.in_play_24),
    signalTypes: Number(r.signal_types),
    hasSec: Number(r.sec_events) > 0,
  }));
});

/* ───────────────────────── Contract facts per vendor ───────────────────────── */

export interface VendorDealFacts {
  ticker: string;
  contracts: number;
  tcvUsd: number | null;
  industries: number;
  inPlay12: number;
  inPlay12Tcv: number | null;
  inPlay24: number;
  inPlay24Tcv: number | null;
  nearestEnd: string | null;
  nearestEndDays: number | null;
  expiredPast12: number;
  /** Awards in the 12 months ending at the spine's last ingest… */
  awardsT12: number;
  awardsT12Tcv: number | null;
  /** …vs the 12 months before that. */
  awardsPrior12: number;
  awardsPrior12Tcv: number | null;
  topLines: Array<{ line: string; contracts: number }>;
}

export const getVendorDealFacts = cache(async (tickersKey: string): Promise<Map<string, VendorDealFacts>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();

  const [aggRows, lineRows] = await Promise.all([
    q<{
      ticker: string; contracts: string; tcv: string | null; industries: string;
      in12: string; in12_tcv: string | null; in24: string; in24_tcv: string | null;
      nearest_end: string | null; nearest_days: string | null; expired12: string;
      aw_t12: string; aw_t12_tcv: string | null; aw_p12: string; aw_p12_tcv: string | null;
    }>(
      `WITH anchor AS (SELECT max(ingested_at)::date AS d FROM stg_curated_deal),
       xr AS (SELECT external_id AS ticker, ag_provider_id FROM xref_identity WHERE system='ticker'
               AND external_id = ANY($2::text[]))
       SELECT xr.ticker,
              count(*) AS contracts,
              sum(d.tcv_usd) AS tcv,
              count(DISTINCT d.client_vertical_id) AS industries,
              count(*) FILTER (WHERE d.end_date >= current_date
                AND d.end_date < current_date + interval '12 months') AS in12,
              sum(d.tcv_usd) FILTER (WHERE d.end_date >= current_date
                AND d.end_date < current_date + interval '12 months') AS in12_tcv,
              count(*) FILTER (WHERE d.end_date >= current_date
                AND d.end_date < current_date + interval '24 months') AS in24,
              sum(d.tcv_usd) FILTER (WHERE d.end_date >= current_date
                AND d.end_date < current_date + interval '24 months') AS in24_tcv,
              to_char(min(d.end_date) FILTER (WHERE d.end_date >= current_date), 'YYYY-MM-DD') AS nearest_end,
              (min(d.end_date) FILTER (WHERE d.end_date >= current_date))::date - current_date AS nearest_days,
              count(*) FILTER (WHERE d.end_date >= current_date - interval '12 months'
                AND d.end_date < current_date) AS expired12,
              count(*) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '12 months'
                AND d.start_date <= (SELECT d FROM anchor)) AS aw_t12,
              sum(d.tcv_usd) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '12 months'
                AND d.start_date <= (SELECT d FROM anchor)) AS aw_t12_tcv,
              count(*) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '24 months'
                AND d.start_date <= (SELECT d FROM anchor) - interval '12 months') AS aw_p12,
              sum(d.tcv_usd) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '24 months'
                AND d.start_date <= (SELECT d FROM anchor) - interval '12 months') AS aw_p12_tcv
         FROM deal d
         JOIN xr ON xr.ag_provider_id = d.ag_provider_id
        WHERE d.source_system = ANY($1::text[])
        GROUP BY xr.ticker`,
      [COMMERCIAL_SYSTEMS, tickers],
    ),
    q<{ ticker: string; line: string; n: string }>(
      `WITH xr AS (SELECT external_id AS ticker, ag_provider_id FROM xref_identity WHERE system='ticker'
               AND external_id = ANY($2::text[]))
       SELECT xr.ticker, t.display_name AS line, count(*) AS n
         FROM deal d
         JOIN xr ON xr.ag_provider_id = d.ag_provider_id
         JOIN service_taxonomy t ON t.taxonomy_id = d.taxonomy_id
        WHERE d.source_system = ANY($1::text[])
        GROUP BY 1, 2
        ORDER BY 1, count(*) DESC`,
      [COMMERCIAL_SYSTEMS, tickers],
    ),
  ]);

  const linesByTicker = new Map<string, Array<{ line: string; contracts: number }>>();
  for (const r of lineRows) {
    const list = linesByTicker.get(r.ticker) ?? [];
    if (list.length < 3) list.push({ line: r.line, contracts: Number(r.n) });
    linesByTicker.set(r.ticker, list);
  }

  const out = new Map<string, VendorDealFacts>();
  for (const t of tickers) {
    const r = aggRows.find((x) => x.ticker === t);
    out.set(t, {
      ticker: t,
      contracts: Number(r?.contracts ?? 0),
      tcvUsd: r?.tcv == null ? null : Number(r.tcv),
      industries: Number(r?.industries ?? 0),
      inPlay12: Number(r?.in12 ?? 0),
      inPlay12Tcv: r?.in12_tcv == null ? null : Number(r.in12_tcv),
      inPlay24: Number(r?.in24 ?? 0),
      inPlay24Tcv: r?.in24_tcv == null ? null : Number(r.in24_tcv),
      nearestEnd: r?.nearest_end ?? null,
      nearestEndDays: r?.nearest_days == null ? null : Number(r.nearest_days),
      expiredPast12: Number(r?.expired12 ?? 0),
      awardsT12: Number(r?.aw_t12 ?? 0),
      awardsT12Tcv: r?.aw_t12_tcv == null ? null : Number(r.aw_t12_tcv),
      awardsPrior12: Number(r?.aw_p12 ?? 0),
      awardsPrior12Tcv: r?.aw_p12_tcv == null ? null : Number(r.aw_p12_tcv),
      topLines: linesByTicker.get(t) ?? [],
    });
  }
  return out;
});

export interface ExposureContract {
  client: string;
  line: string | null;
  industry: string | null;
  tcvUsd: number | null;
  endDate: string;
  daysRemaining: number;
}

/** A vendor's agreements reaching their end date — their defensive position. */
export async function getVendorExposure(ticker: string, limit = 8): Promise<ExposureContract[]> {
  const rows = await q<{
    client_name: string; line: string | null; industry: string | null;
    tcv_usd: number | null; end_date: string; days: string;
  }>(
    `SELECT d.client_name, t.display_name AS line, v.display_name AS industry,
            d.tcv_usd, to_char(d.end_date, 'YYYY-MM-DD') AS end_date,
            (d.end_date::date - current_date) AS days
       FROM deal d
       JOIN xref_identity x ON x.ag_provider_id = d.ag_provider_id AND x.system = 'ticker'
       LEFT JOIN service_taxonomy t ON t.taxonomy_id = d.taxonomy_id
       LEFT JOIN vertical v ON v.vertical_id = d.client_vertical_id
      WHERE d.source_system = ANY($1::text[]) AND x.external_id = $2
        AND d.end_date >= current_date
        AND d.end_date < current_date + interval '24 months'
      ORDER BY d.end_date ASC
      LIMIT $3`,
    [COMMERCIAL_SYSTEMS, ticker, limit],
  );
  return rows.map((r) => ({
    client: r.client_name,
    line: r.line,
    industry: r.industry,
    tcvUsd: r.tcv_usd,
    endDate: r.end_date,
    daysRemaining: Number(r.days),
  }));
}

/* ───────────────────────── AG signals (latest per ticker) ───────────────────────── */

export interface TalentFacts {
  netFlow: number | null;
  totalHeadcount: number | null;
  headcountTrend: string | null;
  avgTenureYears: number | null;
  /** e.g. "AI estimate" — rendered as a label whenever present. */
  avgTenureSource: string | null;
  topFunction: string | null;
  sourcedAt: string;
}

export interface TopIssuesFacts {
  riskScore: number | null;
  summary: string | null;
  issueTitles: string[];
  monitoringPriorities: string[];
  isStale: boolean;
  sourcedAt: string;
}

export interface ReputationFacts {
  /** Mean of section sentiment scores, 0–100, as computed fields exist. */
  sentimentScore: number | null;
  trendsUp: number;
  trendsDown: number;
  insightTitle: string | null;
  insightBody: string | null;
  sourcedAt: string;
}

export interface SentimentFacts {
  riskScore: number | null;
  summary: string | null;
  earlyWarnings: string[];
  sourcedAt: string;
}

export interface NrgFacts {
  gapScore: number | null;
  direction: string | null;
  headline: string | null;
  /** The analysis' own as-of date — can be older than the ingest. */
  generatedAt: string | null;
  divergences: Array<{ theme: string; delta: number | null; interpretation: string | null }>;
  sourcedAt: string;
}

export interface VendorSignals {
  talent?: TalentFacts;
  topIssues?: TopIssuesFacts;
  reputation?: ReputationFacts;
  sentiment?: SentimentFacts;
  nrg?: NrgFacts;
}

type Raw = Record<string, unknown>;
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown, max: number): string[] =>
  asArr(v).map((x) => (typeof x === "string" ? x : asStr((x as Raw)?.title) ?? asStr((x as Raw)?.label))).filter((s): s is string => Boolean(s)).slice(0, max);

export const getVendorSignals = cache(async (tickersKey: string): Promise<Map<string, VendorSignals>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();

  const rows = await q<{ ticker: string; signal_type: string; raw: Raw; sourced_at: string }>(
    `SELECT DISTINCT ON (ticker, signal_type) ticker, signal_type, raw,
            to_char(ingested_at, 'YYYY-MM-DD') AS sourced_at
       FROM stg_analystgenius_signal
      WHERE ticker = ANY($1::text[])
        AND signal_type IN ('talent_overview','top_issues','reputation_trends','stakeholder_sentiment','narrative_reality_gap')
      ORDER BY ticker, signal_type, ingested_at DESC`,
    [tickers],
  );

  const out = new Map<string, VendorSignals>();
  for (const r of rows) {
    const entry = out.get(r.ticker) ?? {};
    const raw = r.raw ?? {};
    if (r.signal_type === "talent_overview") {
      const d = (raw.data ?? {}) as Raw;
      entry.talent = {
        netFlow: asNum(d.netFlow),
        totalHeadcount: asNum(d.totalHeadcount),
        headcountTrend: asStr(d.headcountTrend),
        avgTenureYears: asNum(d.avgTenureYears),
        avgTenureSource: asStr(d.avgTenureSource),
        topFunction: asStr(d.topFunction),
        sourcedAt: r.sourced_at,
      };
    } else if (r.signal_type === "top_issues") {
      entry.topIssues = {
        riskScore: asNum(raw.riskScore),
        summary: asStr(raw.summary),
        issueTitles: strList(raw.topIssues, 3),
        monitoringPriorities: strList(raw.monitoringPriorities, 3),
        isStale: raw.isStale === true,
        sourcedAt: r.sourced_at,
      };
    } else if (r.signal_type === "reputation_trends") {
      const sections = asArr(raw.sections) as Raw[];
      const scores = sections.map((s) => asNum(s.sentimentScore)).filter((n): n is number => n != null);
      const trends = sections.map((s) => asStr(s.trend));
      entry.reputation = {
        sentimentScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        trendsUp: trends.filter((t) => t === "up").length,
        trendsDown: trends.filter((t) => t === "down").length,
        insightTitle: asStr(raw.insightTitle),
        insightBody: asStr(raw.insightBody),
        sourcedAt: r.sourced_at,
      };
    } else if (r.signal_type === "stakeholder_sentiment") {
      entry.sentiment = {
        riskScore: asNum(raw.riskScore),
        summary: asStr(raw.summary),
        earlyWarnings: strList(raw.earlyWarningSignals, 3),
        sourcedAt: r.sourced_at,
      };
    } else if (r.signal_type === "narrative_reality_gap") {
      const div = (asArr(raw.topDivergences) as Raw[]).slice(0, 3).map((x) => ({
        theme: asStr(x.theme) ?? "—",
        delta: asNum(x.delta),
        interpretation: asStr(x.interpretation),
      }));
      entry.nrg = {
        gapScore: asNum(raw.gapScore),
        direction: asStr(raw.direction),
        headline: asStr(raw.headline),
        generatedAt: asStr(raw.generatedAt)?.slice(0, 10) ?? null,
        divergences: div,
        sourcedAt: r.sourced_at,
      };
    }
    out.set(r.ticker, entry);
  }
  return out;
});

/** Change in signal scalars since tracking began (first vs latest snapshot). */
export interface SignalDelta {
  ticker: string;
  gapScoreDelta: number | null;
  netFlowDelta: number | null;
  aiReadinessDelta: number | null;
  trackedSince: string;
}

export const getSignalDeltas = cache(async (tickersKey: string): Promise<Map<string, SignalDelta>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();

  const [nrg, talent, catalog] = await Promise.all([
    q<{ ticker: string; first_v: number | null; last_v: number | null; since: string }>(
      `WITH f AS (SELECT DISTINCT ON (ticker) ticker, gap_score, to_char(ingested_at,'YYYY-MM-DD') AS d
                    FROM stg_analystgenius_signal WHERE signal_type='narrative_reality_gap' AND ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at ASC),
            l AS (SELECT DISTINCT ON (ticker) ticker, gap_score
                    FROM stg_analystgenius_signal WHERE signal_type='narrative_reality_gap' AND ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at DESC)
       SELECT f.ticker, f.gap_score AS first_v, l.gap_score AS last_v, f.d AS since
         FROM f JOIN l ON l.ticker = f.ticker`,
      [tickers],
    ),
    q<{ ticker: string; first_v: string | null; last_v: string | null; since: string }>(
      `WITH f AS (SELECT DISTINCT ON (ticker) ticker, raw->'data'->>'netFlow' AS v, to_char(ingested_at,'YYYY-MM-DD') AS d
                    FROM stg_analystgenius_signal WHERE signal_type='talent_overview' AND ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at ASC),
            l AS (SELECT DISTINCT ON (ticker) ticker, raw->'data'->>'netFlow' AS v
                    FROM stg_analystgenius_signal WHERE signal_type='talent_overview' AND ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at DESC)
       SELECT f.ticker, f.v AS first_v, l.v AS last_v, f.d AS since
         FROM f JOIN l ON l.ticker = f.ticker`,
      [tickers],
    ),
    q<{ ticker: string; first_v: number | null; last_v: number | null; since: string }>(
      `WITH f AS (SELECT DISTINCT ON (ticker) ticker, ai_readiness_score AS v, to_char(ingested_at,'YYYY-MM-DD') AS d
                    FROM stg_analystgenius_provider WHERE ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at ASC),
            l AS (SELECT DISTINCT ON (ticker) ticker, ai_readiness_score AS v
                    FROM stg_analystgenius_provider WHERE ticker = ANY($1::text[])
                   ORDER BY ticker, ingested_at DESC)
       SELECT f.ticker, f.v AS first_v, l.v AS last_v, f.d AS since
         FROM f JOIN l ON l.ticker = f.ticker`,
      [tickers],
    ),
  ]);

  const out = new Map<string, SignalDelta>();
  for (const t of tickers) {
    const n = nrg.find((x) => x.ticker === t);
    const ta = talent.find((x) => x.ticker === t);
    const c = catalog.find((x) => x.ticker === t);
    const delta = (first: number | null, last: number | null) =>
      first == null || last == null ? null : last - first;
    const taFirst = ta?.first_v == null ? null : Number(ta.first_v);
    const taLast = ta?.last_v == null ? null : Number(ta.last_v);
    out.set(t, {
      ticker: t,
      gapScoreDelta: delta(n?.first_v ?? null, n?.last_v ?? null),
      netFlowDelta: delta(taFirst, taLast),
      aiReadinessDelta: delta(c?.first_v ?? null, c?.last_v ?? null),
      trackedSince: n?.since ?? ta?.since ?? c?.since ?? "",
    });
  }
  return out;
});

/* ───────────────────────── Vendor catalog (latest) ───────────────────────── */

export interface CatalogFacts {
  ticker: string;
  name: string;
  hq: string | null;
  employeeCount: number | null;
  revenueUsd: number | null;
  revenueGrowthYoy: number | null;
  aiReadinessScore: number | null;
  sourcedAt: string;
}

export const getCatalog = cache(async (tickersKey: string): Promise<Map<string, CatalogFacts>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();
  const rows = await q<{
    ticker: string; name: string; hq: string | null; employee_count: number | null;
    revenue_usd: number | null; revenue_growth_yoy: number | null; ai: number | null; sourced_at: string;
  }>(
    `SELECT DISTINCT ON (ticker) ticker, COALESCE(display_name, name) AS name, headquarters AS hq,
            employee_count, revenue_usd, revenue_growth_yoy, ai_readiness_score AS ai,
            to_char(ingested_at, 'YYYY-MM-DD') AS sourced_at
       FROM stg_analystgenius_provider
      WHERE ticker = ANY($1::text[])
      ORDER BY ticker, ingested_at DESC`,
    [tickers],
  );
  return new Map(rows.map((r) => [r.ticker, {
    ticker: r.ticker,
    name: r.name,
    hq: r.hq,
    employeeCount: r.employee_count,
    revenueUsd: r.revenue_usd,
    revenueGrowthYoy: r.revenue_growth_yoy,
    aiReadinessScore: r.ai,
    sourcedAt: r.sourced_at,
  }]));
});

/* ───────────────────────── SEC events ───────────────────────── */

export interface SecSummary {
  ticker: string;
  total12mo: number;
  byItem: Record<string, number>;
  latest: Array<{ date: string; itemCode: string | null; label: string | null; url: string | null }>;
}

export const getSecSummaries = cache(async (tickersKey: string): Promise<Map<string, SecSummary>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();

  const [counts, latest] = await Promise.all([
    q<{ ticker: string; item_code: string | null; n: string }>(
      `SELECT ticker, item_code, count(*) AS n
         FROM stg_sec_event
        WHERE ticker = ANY($1::text[])
          AND filed_at >= current_date - interval '12 months'
        GROUP BY 1, 2`,
      [tickers],
    ),
    q<{ ticker: string; d: string; item_code: string | null; item_label: string | null; url: string | null; rn: string }>(
      `SELECT ticker, to_char(filed_at, 'YYYY-MM-DD') AS d, item_code, item_label, document_url AS url,
              row_number() OVER (PARTITION BY ticker ORDER BY filed_at DESC) AS rn
         FROM stg_sec_event
        WHERE ticker = ANY($1::text[])
          AND filed_at >= current_date - interval '12 months'`,
      [tickers],
    ),
  ]);

  const out = new Map<string, SecSummary>();
  for (const t of tickers) {
    const byItem: Record<string, number> = {};
    let total = 0;
    for (const c of counts.filter((x) => x.ticker === t)) {
      const n = Number(c.n);
      total += n;
      if (c.item_code) byItem[c.item_code] = (byItem[c.item_code] ?? 0) + n;
    }
    if (total === 0) continue;
    out.set(t, {
      ticker: t,
      total12mo: total,
      byItem,
      latest: latest
        .filter((x) => x.ticker === t && Number(x.rn) <= 4)
        .map((x) => ({ date: x.d, itemCode: x.item_code, label: x.item_label, url: x.url })),
    });
  }
  return out;
});

/* ───────────────────────── Developments (scoped, dated, citable) ───────────────────────── */

export type DevelopmentKind = "award" | "filing";

export interface Development {
  kind: DevelopmentKind;
  date: string;
  ticker: string;
  vendor: string;
  headline: string;
  detail: string | null;
  tcvUsd: number | null;
  sourceUrl: string | null;
  itemCode: string | null;
}

/**
 * Dated, citable events for the scoped vendors, newest first. No general news
 * feed: an award is a signed contract on the spine; a filing is an SEC 8-K.
 * The buyer implication is attached in lib/metrics/watch.ts from the event
 * semantics — never invented prose.
 */
export const getDevelopments = cache(async (tickersKey: string, limit = 30): Promise<Development[]> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return [];

  const [awards, filings] = await Promise.all([
    q<{ d: string; ticker: string; vendor: string; client: string; line: string | null; tcv: number | null; url: string | null }>(
      `SELECT to_char(d.start_date, 'YYYY-MM-DD') AS d, x.external_id AS ticker,
              pr.canonical_name AS vendor, d.client_name AS client,
              t.display_name AS line, d.tcv_usd AS tcv, sd.reference_links AS url
         FROM deal d
         JOIN provider pr ON pr.ag_provider_id = d.ag_provider_id
         JOIN xref_identity x ON x.ag_provider_id = d.ag_provider_id AND x.system = 'ticker'
         LEFT JOIN service_taxonomy t ON t.taxonomy_id = d.taxonomy_id
         LEFT JOIN stg_curated_deal sd
           ON sd.source_system = d.source_system
          AND d.deal_id = substr(encode(digest('deal:' || sd.source_system || ':' || sd.source_record_id, 'sha256'), 'hex'), 1, 32)
        WHERE d.source_system = ANY($1::text[])
          AND x.external_id = ANY($2::text[])
          AND d.start_date <= current_date
          AND d.start_date >= current_date - interval '12 months'
        ORDER BY d.start_date DESC
        LIMIT $3`,
      [COMMERCIAL_SYSTEMS, tickers, limit],
    ),
    q<{ d: string; ticker: string; vendor: string; code: string | null; label: string | null; url: string | null }>(
      `SELECT to_char(e.filed_at, 'YYYY-MM-DD') AS d, e.ticker,
              COALESCE(pr.canonical_name, e.company_name) AS vendor,
              e.item_code AS code, e.item_label AS label, e.document_url AS url
         FROM stg_sec_event e
         LEFT JOIN xref_identity x ON x.external_id = e.ticker AND x.system = 'ticker'
         LEFT JOIN provider pr ON pr.ag_provider_id = x.ag_provider_id
        WHERE e.ticker = ANY($1::text[])
          AND e.filed_at >= current_date - interval '12 months'
        ORDER BY e.filed_at DESC
        LIMIT $2`,
      [tickers, limit],
    ),
  ]);

  const merged: Development[] = [
    ...awards.map((a) => ({
      kind: "award" as const,
      date: a.d,
      ticker: a.ticker,
      vendor: a.vendor,
      headline: `Signed: ${a.client}`,
      detail: a.line,
      tcvUsd: a.tcv,
      sourceUrl: a.url,
      itemCode: null,
    })),
    ...filings.map((f) => ({
      kind: "filing" as const,
      date: f.d,
      ticker: f.ticker,
      vendor: f.vendor,
      headline: f.label ?? "8-K filing",
      detail: "SEC 8-K",
      tcvUsd: null,
      sourceUrl: f.url,
      itemCode: f.code,
    })),
  ];
  return merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
});

/* ───────────────────────── AI capability events (canonical ai_shift signals) ───────────────────────── */

export interface AiEvent {
  ticker: string;
  eventType: string;
  headline: string;
  body: string | null;
  materiality: number;
  date: string;
}

export interface VendorAiEvents {
  events: AiEvent[];
  materialT12: number;
  highT12: number;
  latestDate: string | null;
}

/**
 * Materiality-gated AI/automation capability events, derived upstream from
 * curated sources onto the canonical signal model. Only materiality ≥3 events
 * reach the metric layer — a generic announcement never moves a metric (§6).
 */
export const getAiEvents = cache(async (tickersKey: string): Promise<Map<string, VendorAiEvents>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();
  const rows = await q<{ ticker: string; headline: string; body: string | null; materiality: number; d: string }>(
    `SELECT x.external_id AS ticker, s.headline, s.body, s.materiality,
            to_char(s.digest_date, 'YYYY-MM-DD') AS d
       FROM signal s
       JOIN xref_identity x ON x.ag_provider_id = s.ag_provider_id AND x.system = 'ticker'
      WHERE s.signal_type = 'ai_shift'
        AND s.materiality >= 3
        AND x.external_id = ANY($1::text[])
        AND s.digest_date > current_date - interval '18 months'
      ORDER BY s.digest_date DESC`,
    [tickers],
  );
  const out = new Map<string, VendorAiEvents>();
  const t12 = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  for (const r of rows) {
    const entry = out.get(r.ticker) ?? { events: [], materialT12: 0, highT12: 0, latestDate: null };
    const type = r.headline.match(/^\[([a-z_]+)\]/)?.[1] ?? "event";
    entry.events.push({ ticker: r.ticker, eventType: type, headline: r.headline.replace(/^\[[a-z_]+\]\s*/, ""), body: r.body, materiality: r.materiality, date: r.d });
    if (r.d >= t12) {
      entry.materialT12++;
      if (r.materiality >= 5) entry.highT12++;
    }
    if (!entry.latestDate || r.d > entry.latestDate) entry.latestDate = r.d;
    out.set(r.ticker, entry);
  }
  return out;
});

/* ───────────────────────── Macro/FX/wage deltas (market-level context) ───────────────────────── */

export interface MacroSeriesReading {
  seriesId: string;
  label: string | null;
  latest: number;
  latestDate: string;
  yoyPct: number | null;
}

/** Latest value + year-over-year change per landed macro series. */
export const getMacroReadings = cache(async (): Promise<Map<string, MacroSeriesReading>> => {
  const rows = await q<{ series_id: string; label: string | null; latest: number; latest_date: string; prior: number | null }>(
    `WITH latest AS (
       SELECT DISTINCT ON (series_id) series_id, series_label AS label, value AS latest, observation_date AS latest_date
         FROM stg_macro_series WHERE value IS NOT NULL
        ORDER BY series_id, observation_date DESC
     )
     SELECT l.series_id, l.label, l.latest, l.latest_date,
            (SELECT m.value FROM stg_macro_series m
              WHERE m.series_id = l.series_id AND m.value IS NOT NULL
                AND m.observation_date <= to_char(l.latest_date::date - interval '365 days', 'YYYY-MM-DD')
              ORDER BY m.observation_date DESC LIMIT 1) AS prior
       FROM latest l`,
  );
  const out = new Map<string, MacroSeriesReading>();
  for (const r of rows) {
    out.set(r.series_id, {
      seriesId: r.series_id,
      label: r.label,
      latest: r.latest,
      latestDate: r.latest_date,
      yoyPct: r.prior == null || r.prior === 0 ? null : Number((((r.latest - r.prior) / r.prior) * 100).toFixed(2)),
    });
  }
  return out;
});

/* ───────────────────────── Scope service-line breakdown ───────────────────────── */

export interface ScopeLine {
  line: string;
  contracts: number;
  inPlay24: number;
}

/** Broad service families as an attribute of the scoped intelligence (spec §11). */
export const getScopeLines = cache(async (tickersKey: string): Promise<ScopeLine[]> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return [];
  const rows = await q<{ line: string; n: string; in_play: string }>(
    `WITH xr AS (SELECT external_id AS ticker, ag_provider_id FROM xref_identity
             WHERE system='ticker' AND external_id = ANY($2::text[]))
     SELECT t.display_name AS line, count(*) AS n,
            count(*) FILTER (WHERE d.end_date >= current_date
              AND d.end_date < current_date + interval '24 months') AS in_play
       FROM deal d
       JOIN xr ON xr.ag_provider_id = d.ag_provider_id
       JOIN service_taxonomy t ON t.taxonomy_id = d.taxonomy_id
      WHERE d.source_system = ANY($1::text[])
      GROUP BY 1
      ORDER BY count(*) DESC`,
    [COMMERCIAL_SYSTEMS, tickers],
  );
  return rows.map((r) => ({ line: r.line, contracts: Number(r.n), inPlay24: Number(r.in_play) }));
});

/* ───────────────────────── Public procurement flow (fresh market evidence) ───────────────────────── */

export interface ProcurementFlow {
  ticker: string;
  awardsT90: number;
  awardsPrior90: number;
  awardsT365: number;
  valueT365: number | null;
  lastAwardDate: string | null;
  /** Procurement records with end dates inside the next 12 months. */
  inPlayNext12: number;
}

export interface ScopeProcurement {
  byVendor: Map<string, ProcurementFlow>;
  totalT90: number;
  totalPrior90: number;
  distinctWinners180: number;
  lastIngest: string | null;
}

/**
 * Fresh public-procurement award flow for the scoped vendors — MARKET evidence,
 * flow/context only. Values here NEVER feed pricing benchmarks (public-sector
 * awards are not enterprise pricing); the curated spine remains the pricing
 * substrate. Only rows the resolver actually resolved are counted.
 */
export const getProcurementFlow = cache(async (tickersKey: string): Promise<ScopeProcurement> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  const empty: ScopeProcurement = { byVendor: new Map(), totalT90: 0, totalPrior90: 0, distinctWinners180: 0, lastIngest: null };
  if (tickers.length === 0) return empty;

  const [rows, [scope]] = await Promise.all([
    q<{
      ticker: string; t90: string; p90: string; t365: string; v365: string | null;
      last_award: string | null; inplay12: string;
    }>(
      `SELECT x.external_id AS ticker,
              count(*) FILTER (WHERE left(p.start_date_raw, 10) > to_char(current_date - interval '90 days', 'YYYY-MM-DD')
                                 AND left(p.start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')) AS t90,
              count(*) FILTER (WHERE left(p.start_date_raw, 10) > to_char(current_date - interval '180 days', 'YYYY-MM-DD')
                                 AND left(p.start_date_raw, 10) <= to_char(current_date - interval '90 days', 'YYYY-MM-DD')) AS p90,
              count(*) FILTER (WHERE left(p.start_date_raw, 10) > to_char(current_date - interval '365 days', 'YYYY-MM-DD')
                                 AND left(p.start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')) AS t365,
              sum(p.value_usd_raw) FILTER (WHERE left(p.start_date_raw, 10) > to_char(current_date - interval '365 days', 'YYYY-MM-DD')
                                 AND left(p.start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')) AS v365,
              max(left(p.start_date_raw, 10)) FILTER (WHERE left(p.start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')) AS last_award,
              count(*) FILTER (WHERE left(p.end_date_raw, 10) >= to_char(current_date, 'YYYY-MM-DD')
                                 AND left(p.end_date_raw, 10) < to_char(current_date + interval '12 months', 'YYYY-MM-DD')) AS inplay12
         FROM stg_procurement_contract p
         JOIN xref_identity x ON x.ag_provider_id = p.resolved_ag_provider_id AND x.system = 'ticker'
        WHERE p.resolution_status = 'resolved'
          AND x.external_id = ANY($1::text[])
        GROUP BY 1`,
      [tickers],
    ),
    q<{ winners: string; last_ingest: string | null }>(
      `SELECT count(DISTINCT p.resolved_ag_provider_id) FILTER (
                WHERE left(p.start_date_raw, 10) > to_char(current_date - interval '180 days', 'YYYY-MM-DD')) AS winners,
              to_char(max(p.ingested_at), 'YYYY-MM-DD') AS last_ingest
         FROM stg_procurement_contract p
         JOIN xref_identity x ON x.ag_provider_id = p.resolved_ag_provider_id AND x.system = 'ticker'
        WHERE p.resolution_status = 'resolved'
          AND x.external_id = ANY($1::text[])`,
      [tickers],
    ),
  ]);

  const byVendor = new Map<string, ProcurementFlow>();
  let totalT90 = 0;
  let totalPrior90 = 0;
  for (const r of rows) {
    const flow: ProcurementFlow = {
      ticker: r.ticker,
      awardsT90: Number(r.t90),
      awardsPrior90: Number(r.p90),
      awardsT365: Number(r.t365),
      valueT365: r.v365 == null ? null : Number(r.v365),
      lastAwardDate: r.last_award,
      inPlayNext12: Number(r.inplay12),
    };
    byVendor.set(r.ticker, flow);
    totalT90 += flow.awardsT90;
    totalPrior90 += flow.awardsPrior90;
  }
  return {
    byVendor,
    totalT90,
    totalPrior90,
    distinctWinners180: Number(scope?.winners ?? 0),
    lastIngest: scope?.last_ingest ?? null,
  };
});

/* ───────────────────────── Canonical vendor-primitive claims ───────────────────────── */

export interface PrimitivePoint {
  value: number;
  asOf: string;
  calculatedAt: string;
}

export interface VendorPrimitive {
  value: number;
  unit: string | null;
  asOf: string;
  evidenceGrade: string;
  dataStatus: string;
  confidence: number;
  sourceUrl: string | null;
  /** Full version chain, oldest→newest — genuine observed snapshots (§10/§15). */
  series: PrimitivePoint[];
}

/**
 * Reads the vendor-level primitives snapshotted upstream onto the canonical
 * claim ledger (claim versioning IS the snapshot history). The portal derives
 * market-relative intelligence from these; it never writes them.
 */
export const getVendorPrimitives = cache(async (tickersKey: string): Promise<Map<string, Map<string, VendorPrimitive>>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();

  const rows = await q<{
    ticker: string; claim_type: string; numeric_value: number | null; unit: string | null;
    as_of: string | null; valid_from: string; is_current: boolean;
    evidence_grade: string; data_status: string; confidence: string;
    source_url: string | null;
  }>(
    `SELECT x.external_id AS ticker,
            c.claim_type,
            c.numeric_value,
            c.unit,
            to_char(c.as_of, 'YYYY-MM-DD') AS as_of,
            to_char(c.valid_from, 'YYYY-MM-DD') AS valid_from,
            (c.valid_to IS NULL) AS is_current,
            c.evidence_grade::text AS evidence_grade,
            c.data_status::text AS data_status,
            c.confidence_score::float8::text AS confidence,
            (SELECT e.source_url FROM claim_evidence ce
               JOIN evidence e ON e.evidence_id = ce.evidence_id
              WHERE ce.claim_id = c.claim_id LIMIT 1) AS source_url
       FROM claim c
       JOIN xref_identity x ON x.ag_provider_id = c.ag_provider_id AND x.system = 'ticker'
      WHERE c.claim_type LIKE 'metric.%'
        AND x.external_id = ANY($1::text[])
      ORDER BY x.external_id, c.claim_type, c.valid_from ASC`,
    [tickers],
  );

  const out = new Map<string, Map<string, VendorPrimitive>>();
  for (const r of rows) {
    if (r.numeric_value == null) continue;
    const metric = r.claim_type.replace(/^metric\./, "");
    const vendor = out.get(r.ticker) ?? new Map<string, VendorPrimitive>();
    const point: PrimitivePoint = { value: r.numeric_value, asOf: r.as_of ?? r.valid_from, calculatedAt: r.valid_from };
    const existing = vendor.get(metric);
    if (existing) {
      existing.series.push(point);
      if (r.is_current) {
        existing.value = r.numeric_value;
        existing.asOf = r.as_of ?? r.valid_from;
        existing.evidenceGrade = r.evidence_grade;
        existing.dataStatus = r.data_status;
        existing.confidence = Number(r.confidence);
        existing.sourceUrl = r.source_url;
      }
    } else {
      vendor.set(metric, {
        value: r.numeric_value,
        unit: r.unit,
        asOf: r.as_of ?? r.valid_from,
        evidenceGrade: r.evidence_grade,
        dataStatus: r.data_status,
        confidence: Number(r.confidence),
        sourceUrl: r.source_url,
        series: [point],
      });
    }
    out.set(r.ticker, vendor);
  }
  return out;
});

/* ───────────────────────── Scope-level aggregates ───────────────────────── */

export interface ScopeAggregates {
  vendors: number;
  vendorsWithContracts: number;
  contracts: number;
  inPlay12: number;
  inPlay12Tcv: number | null;
  inPlay24: number;
  inPlay24Tcv: number | null;
  expiredPast12: number;
  awardsT12: number;
  awardsT12Vendors: number;
  awardsPrior12: number;
  awardsPrior12Vendors: number;
  industries: number;
}

export const getScopeAggregates = cache(async (tickersKey: string): Promise<ScopeAggregates> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) {
    return {
      vendors: 0, vendorsWithContracts: 0, contracts: 0,
      inPlay12: 0, inPlay12Tcv: null, inPlay24: 0, inPlay24Tcv: null,
      expiredPast12: 0, awardsT12: 0, awardsT12Vendors: 0, awardsPrior12: 0, awardsPrior12Vendors: 0,
      industries: 0,
    };
  }
  const [r] = await q<Record<string, string | null>>(
    `WITH anchor AS (SELECT max(ingested_at)::date AS d FROM stg_curated_deal),
     xr AS (SELECT external_id AS ticker, ag_provider_id FROM xref_identity
             WHERE system='ticker' AND external_id = ANY($2::text[]))
     SELECT count(DISTINCT xr.ticker) AS vendors_with_contracts,
            count(*) AS contracts,
            count(DISTINCT d.client_vertical_id) AS industries,
            count(*) FILTER (WHERE d.end_date >= current_date
              AND d.end_date < current_date + interval '12 months') AS in12,
            sum(d.tcv_usd) FILTER (WHERE d.end_date >= current_date
              AND d.end_date < current_date + interval '12 months') AS in12_tcv,
            count(*) FILTER (WHERE d.end_date >= current_date
              AND d.end_date < current_date + interval '24 months') AS in24,
            sum(d.tcv_usd) FILTER (WHERE d.end_date >= current_date
              AND d.end_date < current_date + interval '24 months') AS in24_tcv,
            count(*) FILTER (WHERE d.end_date >= current_date - interval '12 months'
              AND d.end_date < current_date) AS expired12,
            count(*) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '12 months'
              AND d.start_date <= (SELECT d FROM anchor)) AS aw_t12,
            count(DISTINCT d.ag_provider_id) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '12 months'
              AND d.start_date <= (SELECT d FROM anchor)) AS aw_t12_v,
            count(*) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '24 months'
              AND d.start_date <= (SELECT d FROM anchor) - interval '12 months') AS aw_p12,
            count(DISTINCT d.ag_provider_id) FILTER (WHERE d.start_date > (SELECT d FROM anchor) - interval '24 months'
              AND d.start_date <= (SELECT d FROM anchor) - interval '12 months') AS aw_p12_v
       FROM deal d
       JOIN xr ON xr.ag_provider_id = d.ag_provider_id
      WHERE d.source_system = ANY($1::text[])`,
    [COMMERCIAL_SYSTEMS, tickers],
  );
  const n = (k: string) => Number(r?.[k] ?? 0);
  const m = (k: string) => (r?.[k] == null ? null : Number(r[k]));
  return {
    vendors: tickers.length,
    vendorsWithContracts: n("vendors_with_contracts"),
    contracts: n("contracts"),
    inPlay12: n("in12"),
    inPlay12Tcv: m("in12_tcv"),
    inPlay24: n("in24"),
    inPlay24Tcv: m("in24_tcv"),
    expiredPast12: n("expired12"),
    awardsT12: n("aw_t12"),
    awardsT12Vendors: n("aw_t12_v"),
    awardsPrior12: n("aw_p12"),
    awardsPrior12Vendors: n("aw_p12_v"),
    industries: n("industries"),
  };
});
