/**
 * Adapter boundary: AI Enterprise capability pillars.
 *
 * The upstream asset (47 vendors × 6 pillars with evidence grades) is the only
 * source in the estate that can assess AI vendors with no contract history —
 * and it is currently BLOCKED: every landed row carries data_status_hint
 * "seed", and the estate's own audit records the extractor reading a stale
 * seed path with scores wrong by 14–35 points.
 *
 * This adapter therefore reports the blocked status and nothing else. When the
 * upstream extractor is fixed and re-landed without the seed hint, this is the
 * single place the portal connects it. Displaying the seeded values would be
 * fabrication — the exact failure the estate exists to refuse.
 */

export interface AiEnterpriseStatus {
  status: "blocked";
  reason: string;
}

export function aiEnterpriseStatus(): AiEnterpriseStatus {
  return {
    status: "blocked",
    reason:
      "AI Enterprise capability scores are seeded baselines pending an upstream extractor fix; they are withheld from every surface until re-landed as verified data.",
  };
}
