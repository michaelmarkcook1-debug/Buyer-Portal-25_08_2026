import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a manual refresh can actually run.
 *
 * The refresh stages are implemented in `@ag/etl`, a workspace package in the
 * AG Sourcing Tool repository. That package is not a dependency of this app
 * and is not uploaded to Vercel, so a deployed instance has no code to run —
 * this is a packaging fact, not a timeout or a permissions problem.
 *
 * Three executors are therefore possible, and the Backoffice reports which one
 * it has rather than assuming:
 *
 *   local-script  the operator's machine, where the AG repo exists on disk.
 *                 This is the existing sanctioned path and is unchanged.
 *   remote-runner a deployment of the AG repo that exposes a trigger. Set
 *                 BACKOFFICE_RUNNER_URL to enable. Not yet provisioned.
 *   none          no runner is reachable. The Backoffice says so plainly and
 *                 refuses to start, rather than reporting a run that is not
 *                 happening.
 */

export type ExecutorKind = "local-script" | "remote-runner" | "none";

export interface ExecutorInfo {
  kind: ExecutorKind;
  /** Operator-facing explanation of what will happen, or why nothing can. */
  detail: string;
  /** Where the stages would actually execute. */
  location: string;
  canRun: boolean;
}

export function localScriptConfig(): { dir: string; script: string } | null {
  const dir = process.env.BACKOFFICE_REFRESH_DIR;
  if (!dir || !existsSync(dir)) return null;
  const script = process.env.BACKOFFICE_REFRESH_SCRIPT ?? "ops/refresh-manual.sh";
  if (!existsSync(join(dir, script))) return null;
  return { dir, script };
}

export function remoteRunnerUrl(): string | null {
  const url = process.env.BACKOFFICE_RUNNER_URL;
  return url && /^https?:\/\//.test(url) ? url : null;
}

export function detectExecutor(): ExecutorInfo {
  const remote = remoteRunnerUrl();
  if (remote) {
    return {
      kind: "remote-runner",
      canRun: true,
      location: new URL(remote).host,
      detail: "A refresh runner is configured. Stages execute there against the canonical Neon spine; this Backoffice starts the run and tracks its progress.",
    };
  }
  const local = localScriptConfig();
  if (local) {
    return {
      kind: "local-script",
      canRun: true,
      location: local.dir,
      detail: `Stages execute on this machine via ${local.script} in the AG Sourcing Tool repository — the same command an operator would run in a terminal.`,
    };
  }
  return {
    kind: "none",
    canRun: false,
    location: "not available in this environment",
    detail:
      "No refresh runner is reachable from this deployment. The refresh stages live in the AG Sourcing Tool repository (@ag/etl), which is not part of this app's deployment, so there is no code here to execute. Freshness below is read live from the canonical spine and is accurate; only starting a refresh is unavailable.",
  };
}
