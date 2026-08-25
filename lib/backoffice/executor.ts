import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a manual refresh can actually run.
 *
 * The operating model during testing is deliberate and simple: refreshes are
 * run by hand from the AG development machine, which writes to the shared
 * canonical Neon spine. The deployed portal reads that same spine, so it sees
 * the results without any deployment of its own.
 *
 * That means a deployed instance cannot start a refresh — not because
 * something is broken or missing, but because execution is intentionally
 * local. This module reports that as a healthy mode, never as an error.
 *
 *   local-manual   the sanctioned model. `canRun` is true on the AG machine,
 *                  where the repo and its scripts exist, and false everywhere
 *                  else — the deployed portal shows status instead.
 *   remote-runner  a dormant option. If BACKOFFICE_RUNNER_URL is ever set,
 *                  the portal will hand runs to that service. Nothing in the
 *                  testing model requires it and none is deployed.
 */

export type ExecutorMode = "local-manual" | "remote-runner";

export interface ExecutorInfo {
  mode: ExecutorMode;
  /** Whether THIS instance can start a refresh. */
  canRun: boolean;
  /** True whenever the portal is working as intended — including when it cannot execute. */
  healthy: boolean;
  /** Machine-readable cause, so the UI never has to infer intent from a missing value. */
  reason: "local-execution" | "local-testing-mode" | "remote-runner";
  /** Operator-facing explanation of what happens, or where it happens instead. */
  detail: string;
  /** Where the stages actually execute. */
  location: string;
  /** Label recorded against the run, so history shows where it ran. */
  runner: string;
}

export function localScriptConfig(): { dir: string; script: string } | null {
  const dir = process.env.BACKOFFICE_REFRESH_DIR;
  if (!dir || !existsSync(dir)) return null;
  const script = process.env.BACKOFFICE_REFRESH_SCRIPT ?? "ops/refresh-manual.sh";
  if (!existsSync(join(dir, script))) return null;
  return { dir, script };
}

/** Dormant by design: unset in every environment during the testing phase. */
export function remoteRunnerUrl(): string | null {
  const url = process.env.BACKOFFICE_RUNNER_URL;
  return url && /^https?:\/\//.test(url) ? url : null;
}

export function detectExecutor(): ExecutorInfo {
  const remote = remoteRunnerUrl();
  if (remote) {
    return {
      mode: "remote-runner",
      canRun: true,
      healthy: true,
      reason: "remote-runner",
      location: new URL(remote).host,
      runner: "remote-runner",
      detail:
        "A refresh runner is configured, so stages execute there against the canonical spine. This is optional — the testing model runs refreshes locally.",
    };
  }

  const local = localScriptConfig();
  if (local) {
    return {
      mode: "local-manual",
      canRun: true,
      healthy: true,
      reason: "local-execution",
      location: local.dir,
      runner: "local-script",
      detail: `Stages execute on this machine via ${local.script} in the AG Sourcing Tool repository — the same command an operator would run in a terminal.`,
    };
  }

  return {
    mode: "local-manual",
    canRun: false,
    healthy: true,
    reason: "local-testing-mode",
    location: "the AG development machine",
    runner: "local-script",
    detail:
      "Refresh execution is intentionally local during testing. Refreshes are run from the AG development environment and write to the shared canonical spine, which this portal reads — so the results below appear here without any deployment. Everything on this page is live.",
  };
}
