import "server-only";
import { q } from "@/lib/db";
import { stagesFor, type StageStatus } from "./stages";

/**
 * Operational run state for the manual refresh.
 *
 * BOUNDARY NOTE. `lib/db.ts` states that this app issues SELECTs only. That
 * remains true of every CANONICAL table: nothing here touches deal, signal,
 * claim or snapshot semantics. This module owns one purpose-built OPERATIONAL
 * table so that a refresh started in one Vercel instance is visible from
 * another — a process-local flag cannot do that on serverless, and the run
 * status has to survive the request that started it.
 *
 * The table is created on first use so no migration tooling is introduced for
 * a single operational table, and it is trivially reversible: DROP TABLE
 * portal_refresh_run.
 */

export type RunStatus = "running" | "success" | "failed";

export interface StageResult {
  id: string;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

export interface RefreshRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  requestedBy: string;
  currentStage: string | null;
  stages: StageResult[];
  errorSummary: string | null;
  runner: string;
  /** External execution reference — e.g. the GitHub Actions run id. */
  runnerRef: string | null;
}

let ensured = false;

/** Create the operational table once per process. Never touches canonical tables. */
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS portal_refresh_run (
      id            text PRIMARY KEY,
      started_at    timestamptz NOT NULL DEFAULT now(),
      finished_at   timestamptz,
      status        text NOT NULL,
      requested_by  text NOT NULL DEFAULT 'backoffice',
      current_stage text,
      stages        jsonb NOT NULL DEFAULT '[]'::jsonb,
      error_summary text,
      runner        text NOT NULL DEFAULT 'unknown',
      runner_ref    text
    )
  `);
  // Existing installations predate runner_ref; adding it is idempotent.
  await q(`ALTER TABLE portal_refresh_run ADD COLUMN IF NOT EXISTS runner_ref text`);
  ensured = true;
}

/**
 * Secrets must never reach the Backoffice UI, so every stored message is
 * scrubbed at the point of writing rather than at the point of rendering.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted-key]")
    .replace(
      /\b([A-Za-z0-9_.-]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_.-]*)(\s*[=:]\s*)(\S+)/gi,
      (_m, name: string, sep: string) => `${name}${sep}[redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b[a-z0-9._-]+:[^@\s/]{6,}@/gi, "[redacted]@")
    .slice(0, 4000);
}

function toRun(r: Record<string, unknown>): RefreshRun {
  return {
    id: String(r.id),
    startedAt: new Date(String(r.started_at)).toISOString(),
    finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
    status: String(r.status) as RunStatus,
    requestedBy: String(r.requested_by ?? "backoffice"),
    currentStage: r.current_stage ? String(r.current_stage) : null,
    stages: (r.stages as StageResult[]) ?? [],
    errorSummary: r.error_summary ? String(r.error_summary) : null,
    runner: String(r.runner ?? "unknown"),
    runnerRef: r.runner_ref ? String(r.runner_ref) : null,
  };
}

/** The most recent run, whatever its state. */
export async function latestRun(): Promise<RefreshRun | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(
    `SELECT * FROM portal_refresh_run ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/** Recent history for the operator (§21 — recent runs, not an observability system). */
export async function recentRuns(limit = 10): Promise<RefreshRun[]> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(
    `SELECT * FROM portal_refresh_run ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toRun);
}

/** A run counts as active only while status = running. */
export async function activeRun(): Promise<RefreshRun | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(
    `SELECT * FROM portal_refresh_run WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * Claim the single run slot. Returns null when another run already holds it,
 * so two Backoffice tabs — or two Vercel instances — cannot both start one.
 * The insert is conditional in SQL rather than checked-then-written, so the
 * check and the claim cannot interleave.
 */
export async function claimRun(runner: string, requestedBy = "backoffice"): Promise<RefreshRun | null> {
  await ensureTable();
  const id = `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  /* Seeded from what THIS runner runs, so a local run has slots for the
     local-file stages and a cloud run does not show stages it will never
     report. */
  const stages: StageResult[] = stagesFor(runner).map((s) => ({
    id: s.id,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    message: null,
  }));
  const rows = await q<Record<string, unknown>>(
    `INSERT INTO portal_refresh_run (id, status, requested_by, stages, runner)
     SELECT $1, 'running', $2, $3::jsonb, $4
     WHERE NOT EXISTS (SELECT 1 FROM portal_refresh_run WHERE status = 'running')
     RETURNING *`,
    [id, requestedBy, JSON.stringify(stages), runner],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * When each stage last COMPLETED SUCCESSFULLY — the operational answer to
 * "did the pipeline run?", taken from the refresh-run record rather than
 * inferred from table timestamps.
 *
 * The distinction matters: a source checked today that contained nothing new
 * leaves its rows' ingested_at exactly where they were, so a table timestamp
 * cannot tell a successful no-op apart from a pipeline that stopped running.
 * Only the run record knows.
 *
 * A failed stage contributes nothing, so a family whose stage errored is
 * never reported as checked.
 */
export async function lastSuccessfulChecks(): Promise<Map<string, string>> {
  await ensureTable();
  const rows = await q<{ stage: string; last_ok: string | null }>(
    `SELECT s->>'id' AS stage,
            to_char(max((s->>'finishedAt')::timestamptz), 'YYYY-MM-DD') AS last_ok
       FROM portal_refresh_run r, jsonb_array_elements(r.stages) s
      WHERE s->>'status' = 'success' AND s->>'finishedAt' IS NOT NULL
      GROUP BY 1`,
  );
  const out = new Map<string, string>();
  for (const r of rows) if (r.stage && r.last_ok) out.set(r.stage, r.last_ok);
  return out;
}

/** Record a stage transition against an active run. */
export async function setStage(
  runId: string,
  stageId: string,
  status: StageStatus,
  message?: string | null,
): Promise<void> {
  await ensureTable();
  const now = new Date().toISOString();
  /* Only the fields this transition actually changes. startedAt survives a
     later success/failure, so durations stay real. */
  const patch: Record<string, unknown> = { status };
  if (status === "running") {
    patch.startedAt = now;
    patch.finishedAt = null;
  } else {
    patch.finishedAt = now;
  }
  if (message != null) patch.message = scrubSecrets(message);

  /* One statement, so two transitions cannot read the same array and write
     back over each other. A read-modify-write here loses stage results
     whenever transitions land close together. */
  await q(
    `WITH target AS (
       SELECT e.ord
         FROM portal_refresh_run p,
              LATERAL jsonb_array_elements(p.stages) WITH ORDINALITY AS e(val, ord)
        WHERE p.id = $1 AND e.val->>'id' = $2
        LIMIT 1
     )
     UPDATE portal_refresh_run r
        SET stages = jsonb_set(
              r.stages,
              ARRAY[(t.ord - 1)::text],
              (r.stages -> (t.ord - 1)::int) || $4::jsonb
            ),
            current_stage = CASE WHEN $3 = 'running' THEN $2 ELSE r.current_stage END
       FROM target t
      WHERE r.id = $1`,
    [runId, stageId, status, JSON.stringify(patch)],
  );
}

/**
 * Close a run. A run is SUCCESS only when no stage failed — a failed stage can
 * never be reported as a clean finish (§13).
 */
export async function finishRun(runId: string, errorSummary?: string | null): Promise<RefreshRun | null> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(`SELECT * FROM portal_refresh_run WHERE id = $1`, [runId]);
  if (!rows[0]) return null;
  const run = toRun(rows[0]);
  const failed = run.stages.filter((s) => s.status === "failed");
  const status: RunStatus = failed.length > 0 || errorSummary ? "failed" : "success";
  const summary =
    errorSummary != null
      ? scrubSecrets(errorSummary)
      : failed.length > 0
        ? `Failed stages: ${failed.map((s) => s.id).join(", ")}`
        : null;
  const out = await q<Record<string, unknown>>(
    `UPDATE portal_refresh_run
        SET status = $2, finished_at = now(), current_stage = NULL, error_summary = $3
      WHERE id = $1 RETURNING *`,
    [runId, status, summary],
  );
  return out[0] ? toRun(out[0]) : null;
}

/**
 * Release a run slot left behind by an instance that died mid-run. Without
 * this a crashed invocation would block every future refresh, and the UI would
 * claim work was continuing when nothing was (§17).
 */
export async function reapStaleRuns(maxMinutes = 30): Promise<number> {
  await ensureTable();
  const rows = await q<Record<string, unknown>>(
    `UPDATE portal_refresh_run
        SET status = 'failed',
            finished_at = now(),
            current_stage = NULL,
            error_summary = 'Run did not report completion within ' || $1 || ' minutes; the runner stopped without finishing.'
      WHERE status = 'running' AND started_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(maxMinutes)],
  );
  return rows.length;
}
