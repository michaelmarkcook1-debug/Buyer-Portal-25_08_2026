/**
 * The approved manual-refresh stage list.
 *
 * This is a MIRROR of `ops/refresh-cloud.sh` in the AG Sourcing Tool repo —
 * the script is the source of truth for what runs and in what order, and this
 * file exists so the Backoffice can name and track stages without owning any
 * ETL. Nothing here executes anything.
 *
 * Order and failure semantics are taken from that script verbatim: stages are
 * independent, a failure is recorded and the run continues, and the run as a
 * whole fails if any stage failed. No stage was added, removed or reordered.
 */

export type StageStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface StageSpec {
  /** Stage name exactly as refresh-cloud.sh logs it. */
  id: string;
  label: string;
  /** The command the AG repo runs for this stage — shown, never executed here. */
  command: string;
  /** What the stage lands, in operator language. */
  what: string;
}

export const REFRESH_STAGES: StageSpec[] = [
  { id: "analystgenius", label: "AnalystGenius signals", command: "pnpm etl:analystgenius", what: "GET-only read of the protected AG API — never writes" },
  { id: "ai-enterprise", label: "AI Enterprise", command: "pnpm etl:ai-enterprise", what: "read-only extract from the AI Enterprise database" },
  { id: "capability-events", label: "Capability events", command: "pnpm etl:capability-events", what: "AI Enterprise partnership family; curated-store family skips loudly if absent" },
  { id: "fred-macro", label: "FRED macro", command: "pnpm etl:fred-macro", what: "FX, wage and CPI series" },
  { id: "sec-events", label: "SEC events", command: "pnpm etl:sec-events", what: "SEC 8-K / 6-K press-release exhibit discovery" },
  { id: "promote", label: "Canonical promote", command: "pnpm promote", what: "deterministic derivation into the canonical spine" },
  { id: "snapshot-primitives", label: "Snapshot primitives", command: "pnpm snapshot:primitives", what: "versioned vendor snapshot claims — 'no change' is a recorded outcome" },
  { id: "snapshot-edgar", label: "Snapshot EDGAR", command: "pnpm snapshot:edgar", what: "SEC companyfacts financial claims" },
];

/** Deliberately outside the manual refresh — stated, never silently folded in. */
export const EXCLUDED_STAGES = [
  { label: "Contract Tracker discovery / import / confirmation", why: "frozen at its confirmed 16 Apr 2026 state until explicitly resumed" },
  { label: "xlsx bridge reload", why: "depends on a manual export from the operator's machine" },
  { label: "Any write to the protected AG production service", why: "that service is read-only; the single touchpoint is a GET" },
  { label: "Scheduling of any kind", why: "refresh is manual until further notice — no cron, no Actions, no auto-run" },
];
