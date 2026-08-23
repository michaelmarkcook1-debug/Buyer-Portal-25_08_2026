import "server-only";
import { cache } from "react";
import { q } from "@/lib/db";
import { assertHistoryMode, mixCoverage, type HistoricalMode, type MixCoverage } from "@/lib/metrics/rules";

/**
 * Reconstructed 12-month+ history (sprint §9/§15).
 *
 * Every series here is built ONLY from observations that genuinely carry their
 * own historical dates (contract signing dates, award publication dates, the
 * AG reputation tracker's own series). They are labelled
 * `historical_mode: "reconstructed"` and must never be presented as snapshots
 * the system calculated contemporaneously — genuine observed snapshots live on
 * the canonical claim ledger (facts.getVendorPrimitives) and carry
 * `observed_snapshot` with real calculated-at timestamps.
 */

const COMMERCIAL_SYSTEMS = ["contract_tracker", "contract_tracker_store"];

export interface HistoryPoint {
  period: string;
  value: number | null;
  n: number;
}

export interface HistorySeries {
  id: string;
  label: string;
  mode: HistoricalMode;
  unit: string | null;
  points: HistoryPoint[];
  source: string;
  note: string;
  /** §10 completeness guard — how much of the observed set the series classifies. */
  coverage?: MixCoverage;
}

function reconstructed(series: Omit<HistorySeries, "mode">): HistorySeries {
  return { ...series, mode: assertHistoryMode("reconstructed", false) };
}

/**
 * Quarterly signing history — a DIFFERENT concept from canonical
 * commercialDealFlow (which is rolling 12 months to the evidence anchor).
 * Kept for shape-over-time inspection; it must never be labelled "deal flow"
 * or compared against the canonical figure as though equivalent.
 */
export const getSpineQuarterlyFlow = cache(async (tickersKey: string): Promise<HistorySeries> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) {
    return reconstructed({ id: "spine-quarterly", label: "Quarterly signing history", unit: "contracts", points: [], source: "Curated contract spine", note: "" });
  }
  const rows = await q<{ quarter: string; n: string }>(
    `SELECT to_char(date_trunc('quarter', d.start_date), 'YYYY') || ' Q' ||
            to_char(d.start_date, 'Q') AS quarter,
            count(*) AS n
       FROM deal d
       JOIN xref_identity x ON x.ag_provider_id = d.ag_provider_id AND x.system = 'ticker'
      WHERE d.source_system = ANY($1::text[])
        AND x.external_id = ANY($2::text[])
        AND d.start_date >= current_date - interval '27 months'
        AND d.start_date <= current_date
      GROUP BY date_trunc('quarter', d.start_date), to_char(d.start_date, 'Q')
      ORDER BY min(d.start_date)`,
    [COMMERCIAL_SYSTEMS, tickers],
  );
  return reconstructed({
    id: "spine-quarterly",
    label: "Quarterly signing history (observed signings per quarter)",
    unit: "contracts",
    points: rows.map((r) => ({ period: r.quarter, value: Number(r.n), n: Number(r.n) })),
    source: "Contract market record",
    note: "Signing dates are the observations; the newest quarters reflect the spine's own data-as-of, not the calendar.",
  });
});

/** Public procurement award flow per month, trailing 12 months — the fresh series. */
export const getProcurementMonthlyFlow = cache(async (tickersKey: string): Promise<HistorySeries> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) {
    return reconstructed({ id: "procurement-monthly", label: "Public award flow", unit: "awards", points: [], source: "Public procurement record", note: "" });
  }
  const rows = await q<{ month: string; n: string }>(
    `SELECT left(p.start_date_raw, 7) AS month, count(*) AS n
       FROM stg_procurement_contract p
       JOIN xref_identity x ON x.ag_provider_id = p.resolved_ag_provider_id AND x.system = 'ticker'
      WHERE p.resolution_status = 'resolved'
        AND x.external_id = ANY($1::text[])
        AND left(p.start_date_raw, 10) > to_char(current_date - interval '12 months', 'YYYY-MM-DD')
        AND left(p.start_date_raw, 10) <= to_char(current_date, 'YYYY-MM-DD')
      GROUP BY 1 ORDER BY 1`,
    [tickers],
  );
  return reconstructed({
    id: "procurement-monthly",
    label: "Public-procurement award flow (monthly)",
    unit: "awards",
    points: rows.map((r) => ({ period: r.month, value: Number(r.n), n: Number(r.n) })),
    source: "Public procurement record (market evidence)",
    note: "Award publication dates are the observations. Flow/context only — never enterprise pricing.",
  });
});

/**
 * Commercial-model mix by signing year (curated spine): the share of
 * consumption/outcome-shaped agreements (Subscription, Performance-related)
 * vs Fixed price — a gain-sharing input observed directly in the record.
 */
export const getPricingModelMixByYear = cache(async (tickersKey: string): Promise<HistorySeries> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) {
    return reconstructed({ id: "pricing-mix", label: "Commercial-model mix", unit: "pct_consumption", points: [], source: "Curated contract spine", note: "" });
  }
  const [rows, windowCounts] = await Promise.all([
    q<{ yr: string; total: string; consumption: string; classified: string }>(
      `SELECT extract(year FROM d.start_date)::int::text AS yr,
              count(*) AS total,
              count(*) FILTER (WHERE sd.pricing_method_raw IN ('Subscription based', 'Performance related')) AS consumption,
              count(*) FILTER (WHERE sd.pricing_method_raw IS NOT NULL) AS classified
         FROM deal d
         JOIN xref_identity x ON x.ag_provider_id = d.ag_provider_id AND x.system = 'ticker'
         LEFT JOIN stg_curated_deal sd
           ON sd.source_system = d.source_system
          AND d.deal_id = substr(encode(digest('deal:' || sd.source_system || ':' || sd.source_record_id, 'sha256'), 'hex'), 1, 32)
        WHERE d.source_system = 'contract_tracker'
          AND x.external_id = ANY($1::text[])
          AND d.start_date >= current_date - interval '4 years'
          AND d.start_date <= current_date
        GROUP BY 1 ORDER BY 1`,
      [tickers],
    ),
    // §10: the OBSERVED universe spans both commercial feeds; only the TG
    // tracker feed carries a pricing-method field. Coverage must say so.
    q<{ source_system: string; c: string }>(
      `SELECT d.source_system, count(*) AS c
         FROM deal d
         JOIN xref_identity x ON x.ag_provider_id = d.ag_provider_id AND x.system = 'ticker'
        WHERE d.source_system = ANY($2::text[])
          AND x.external_id = ANY($1::text[])
          AND d.start_date >= current_date - interval '4 years'
          AND d.start_date <= current_date
        GROUP BY 1`,
      [tickers, COMMERCIAL_SYSTEMS],
    ),
  ]);
  const observedTotal = windowCounts.reduce((a, r) => a + Number(r.c), 0);
  const classifiedTotal = rows.reduce((a, r) => a + Number(r.classified), 0);
  return reconstructed({
    coverage: mixCoverage(observedTotal, classifiedTotal),
    id: "pricing-mix",
    label: "Consumption/outcome-shaped share of observed agreements",
    unit: "pct",
    points: rows.map((r) => {
      const total = Number(r.total);
      return {
        period: r.yr,
        value: total >= 10 ? Number(((Number(r.consumption) / total) * 100).toFixed(1)) : null,
        n: total,
      };
    }),
    source: "Contract market record — commercial model",
    note: "Years below n=10 state their n and assert no share.",
  });
});

/** Mean reputation sentiment series per vendor from the AG tracker's own 8-point series. */
export const getReputationSeries = cache(async (tickersKey: string): Promise<Map<string, HistorySeries>> => {
  const tickers = tickersKey.split(",").filter(Boolean);
  if (tickers.length === 0) return new Map();
  const rows = await q<{ ticker: string; means: number[] | null }>(
    `SELECT s.ticker,
            (SELECT array_agg(avg_val ORDER BY idx)
               FROM (
                 SELECT idx, avg(elem::float8) AS avg_val
                   FROM jsonb_array_elements(s.raw->'sentimentTrend'->'series') ser,
                        jsonb_array_elements(ser->'data') WITH ORDINALITY AS d(elem, idx)
                  GROUP BY idx
               ) t) AS means
       FROM (
         SELECT DISTINCT ON (ticker) ticker, raw
           FROM stg_analystgenius_signal
          WHERE signal_type = 'reputation_trends'
          ORDER BY ticker, ingested_at DESC
       ) s
      WHERE s.ticker = ANY($1::text[])`,
    [tickers],
  );
  const out = new Map<string, HistorySeries>();
  for (const r of rows) {
    if (!r.means || r.means.length < 2) continue;
    out.set(
      r.ticker,
      reconstructed({
        id: `reputation-${r.ticker}`,
        label: "Reputation sentiment (AG tracker series)",
        unit: "score_0_100",
        points: r.means.map((v, i) => ({ period: `t${i + 1}`, value: Math.round(v), n: 1 })),
        source: "AnalystGenius reputation tracker (derived analysis)",
        note: "The tracker's own trailing series; period labels are positional, as published upstream.",
      }),
    );
  }
  return out;
});
