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

export type ExecutorMode = "local-manual" | "github-actions" | "remote-runner";

export interface GithubConfig {
  owner: string;
  repo: string;
  workflow: string;
  ref: string;
  token: string;
}

/**
 * GitHub Actions as manual compute for the existing pipeline.
 *
 * Configured entirely through the environment, so no credential reaches the
 * source tree and the executor can be switched off by removing the variables —
 * which is also the rollback: the deployed Backoffice simply returns to the
 * local-manual status surface and the local script is unaffected.
 */
export function githubConfig(): GithubConfig | null {
  const owner = process.env.BACKOFFICE_GITHUB_OWNER;
  const repo = process.env.BACKOFFICE_GITHUB_REPO;
  const token = process.env.BACKOFFICE_GITHUB_TOKEN;
  if (!owner || !repo || !token) return null;
  return {
    owner,
    repo,
    token,
    workflow: process.env.BACKOFFICE_GITHUB_WORKFLOW ?? "data-refresh.yml",
    ref: process.env.BACKOFFICE_GITHUB_REF ?? "main",
  };
}

export interface ExecutorInfo {
  mode: ExecutorMode;
  /** Whether THIS instance can start a refresh. */
  canRun: boolean;
  /** True whenever the portal is working as intended — including when it cannot execute. */
  healthy: boolean;
  /** Machine-readable cause, so the UI never has to infer intent from a missing value. */
  reason: "local-execution" | "local-testing-mode" | "github-actions" | "remote-runner";
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
  /* Local first: on the AG machine the operator's own repo is the most direct
     path, and dispatching a cloud job from there would be indirection for its
     own sake. */
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

  const gh = githubConfig();
  if (gh) {
    return {
      mode: "github-actions",
      canRun: true,
      healthy: true,
      reason: "github-actions",
      location: `${gh.owner}/${gh.repo}`,
      runner: "github-actions",
      detail:
        "Refresh runs manually using the AnalystGenius data pipeline in GitHub Actions. Nothing is scheduled: pressing the button dispatches one workflow, which runs the same stages as the local script and writes progress here as it goes.",
    };
  }

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
