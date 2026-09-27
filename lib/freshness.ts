/**
 * EVIDENCE FRESHNESS — what the page may say about how current it is.
 *
 * Every family reports the date its newest genuine evidence is ABOUT; the
 * ingestion date answers a different question (when we last landed it) and is
 * never presented as freshness. A family landed yesterday can still describe
 * months-old evidence, and a no-op re-run must not make the page look newer.
 *
 * Pure and dependency-free so the rules are testable without the database.
 */

/** The age past which a family is called stale on the page — the same line
    the commercial banner has always used. */
export const FRESHNESS_CAP_DAYS = 45;

export interface FamilyEvidenceInput {
  source: string;
  /** Newest date the family's evidence is about, or null where it carries none. */
  evidenceDate: string | null;
  evidenceDaysSince: number | null;
  /** Commercial contract families, whose staleness the spine banner already states. */
  commercial?: boolean;
}

export interface FamilyEvidence extends FamilyEvidenceInput {
  stale: boolean;
}

export interface EvidenceSummary {
  /** Newest genuine evidence date across all dated families, or null. */
  newest: string | null;
  families: FamilyEvidence[];
  /** Dated families past the cap. Undated families are never called fresh or stale. */
  stale: FamilyEvidence[];
}

export function summariseEvidence(families: readonly FamilyEvidenceInput[]): EvidenceSummary {
  const out: FamilyEvidence[] = families.map((f) => ({
    source: f.source,
    evidenceDate: f.evidenceDate,
    evidenceDaysSince: f.evidenceDaysSince,
    commercial: f.commercial ?? false,
    stale: f.evidenceDaysSince != null && f.evidenceDaysSince > FRESHNESS_CAP_DAYS,
  }));
  const newest =
    out
      .map((f) => f.evidenceDate)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  return { newest, families: out, stale: out.filter((f) => f.stale) };
}

/**
 * One line per family for a tooltip or a prompt: "SEC 8-K filings: 2026-08-28
 * (30 days)". Undated families say so rather than borrowing another date.
 */
export function familyEvidenceLines(families: readonly FamilyEvidence[]): string[] {
  return families.map((f) =>
    f.evidenceDate
      ? `${f.source}: ${f.evidenceDate}${f.evidenceDaysSince != null ? ` (${f.evidenceDaysSince} days)` : ""}${f.stale ? " — stale" : ""}`
      : `${f.source}: no evidence date`,
  );
}
