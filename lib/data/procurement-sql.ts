/**
 * The public-procurement records the portal counts: ONE row per award.
 *
 * Staging is append-only by content hash, so every refresh that changes a
 * record adds another version of it. Counting staging rows directly counted
 * each award once per version — 1.6x before the 27 Sep weekly corpus landed,
 * 2.4x after, so a 90-day award count read 407 against a true 288. This takes
 * the newest RESOLVED version of each record: a fresh version still queued
 * for resolution never displaces the resolved one already attributed to a
 * vendor, and never adds a second count beside it.
 *
 * Callers bind it as a MATERIALIZED CTE (`WITH p_latest AS MATERIALIZED
 * ${PROCUREMENT_LATEST_SQL}`), never as a FROM subquery: as a subquery the
 * planner put it on the inner side of a nested loop and re-ran the whole
 * de-duplication once per vendor in scope — 4s for a 20-vendor scope against
 * 0.45s materialised. Only the columns the award counts read are carried;
 * `raw` alone averages 619 bytes a row and made the sort four times wider.
 */
export const PROCUREMENT_LATEST_SQL = `(
  SELECT DISTINCT ON (source_system, source_record_id)
         source_system, source_record_id, resolved_ag_provider_id, resolution_status,
         start_date_raw, end_date_raw, value_usd_raw, ingested_at
    FROM stg_procurement_contract
   WHERE resolution_status = 'resolved'
   ORDER BY source_system, source_record_id, ingested_at DESC
)`;
