import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a refresh can actually run.
 *
 *   github-actions  the deployed portal with BACKOFFICE_GITHUB_* set: the button
 *                   dispatches the AG data-refresh workflow, which also runs on
 *                   its own every Monday 06:00 UTC.
 *   local-manual    the AG development machine (BACKOFFICE_REFRESH_DIR), where
 *                   the repo and its scripts exist; anywhere else without a
 *                   GitHub config the page reports status only, a healthy mode.
 *   remote-runner   a dormant option (BACKOFFICE_RUNNER_URL); none is deployed.
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
        "The AnalystGenius data pipeline runs in GitHub Actions every Monday at 06:00 UTC. Pressing the button dispatches one more run of the same cloud-safe stages, which writes progress here as it goes.",
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
