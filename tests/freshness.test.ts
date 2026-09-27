import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FRESHNESS_CAP_DAYS, familyEvidenceLines, summariseEvidence } from "@/lib/freshness";

const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("evidence freshness summary", () => {
  const families = [
    { source: "Curated contract tracker", evidenceDate: "2026-04-16", evidenceDaysSince: 164, commercial: true },
    { source: "SEC 8-K filings", evidenceDate: "2026-08-28", evidenceDaysSince: 30 },
    { source: "Public procurement record", evidenceDate: "2026-08-19", evidenceDaysSince: 39 },
    { source: "AnalystGenius vendor catalog", evidenceDate: null, evidenceDaysSince: null },
  ];

  it("reports the newest evidence date, never an ingest date", () => {
    expect(summariseEvidence(families).newest).toBe("2026-08-28");
  });

  it("calls a family stale only past the cap", () => {
    const s = summariseEvidence(families);
    expect(s.stale.map((f) => f.source)).toEqual(["Curated contract tracker"]);
    const atCap = summariseEvidence([{ source: "x", evidenceDate: "2026-01-01", evidenceDaysSince: FRESHNESS_CAP_DAYS }]);
    expect(atCap.stale).toHaveLength(0);
  });

  it("never calls an undated family fresh or stale, and says it is undated", () => {
    const s = summariseEvidence(families);
    const undated = s.families.find((f) => f.evidenceDate == null)!;
    expect(undated.stale).toBe(false);
    expect(familyEvidenceLines([undated])).toEqual(["AnalystGenius vendor catalog: no evidence date"]);
  });

  it("keeps the commercial flag so the spine banner is not repeated", () => {
    const s = summariseEvidence(families);
    expect(s.stale.filter((f) => !f.commercial)).toHaveLength(0);
  });

  it("returns null rather than a borrowed date when nothing is dated", () => {
    expect(summariseEvidence([{ source: "x", evidenceDate: null, evidenceDaysSince: null }]).newest).toBeNull();
  });
});

/* Source guards: ingest dates must not come back as freshness on the page or
   in the briefing prompt, and the calendar must not age data forwards. */
describe("no ingest date presented as freshness", () => {
  it("the scope bar takes evidence, not the latest ingest", () => {
    const bar = src("components/ScopeBar.tsx");
    expect(bar).not.toMatch(/updatedAt/);
    expect(bar).toMatch(/Newest evidence/);
  });

  it("the briefing prompt states evidence dates, not 'Data updated'", () => {
    const gen = src("lib/insight/generate.ts");
    expect(gen).not.toMatch(/Data updated:/);
    expect(gen).not.toMatch(/run to \$\{intel\.updatedAt\}/);
  });

  it("the footer leads with the evidence date and labels the load date", () => {
    const shell = src("components/PortalShell.tsx");
    expect(shell).toMatch(/evidence to \$\{shortDate\(f\.evidenceDate\)\}/);
    expect(shell).toMatch(/loaded \$\{shortDate\(f\.lastSeen\)\}/);
  });
});

describe("dates the calendar cannot move", () => {
  const facts = src("lib/data/facts.ts");

  it("procurement evidence counts only starts that had happened when the row was landed", () => {
    expect(facts).toMatch(/start_date_raw, 10\)\) FILTER \(WHERE left\(start_date_raw, 10\) <= to_char\(ingested_at/);
    expect(facts).toMatch(/AS last_award/);
    expect(facts).not.toMatch(/max\(left\(p\.start_date_raw, 10\)\) FILTER \(WHERE left\(p\.start_date_raw, 10\) <= to_char\(current_date/);
  });

  it("developments are capped at the day each commercial feed was landed", () => {
    expect(facts).toMatch(/d\.start_date::date <= CASE d\.source_system/);
  });

  it("SEC readings never read the retired table alone", () => {
    expect(facts).toMatch(/sec_items/);
    expect(facts).not.toMatch(/FROM stg_sec_event\s*\n\s*WHERE ticker/);
    expect(facts).not.toMatch(/FROM stg_sec_event e\s*\n\s*LEFT JOIN/);
  });

  it("expiring agreements carry the store's own end-date estimate flag", () => {
    expect(facts).toMatch(/endEstimated: r\.end_estimated === true,\n\s*\}\)\);\n\}/);
  });
});
