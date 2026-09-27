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
 */
export const PROCUREMENT_LATEST_SQL = `(
  SELECT DISTINCT ON (source_system, source_record_id) *
    FROM stg_procurement_contract
   WHERE resolution_status = 'resolved'
   ORDER BY source_system, source_record_id, ingested_at DESC
)`;
