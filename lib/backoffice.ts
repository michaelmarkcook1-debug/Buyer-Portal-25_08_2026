import "server-only";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Backoffice manual-refresh control (testing-phase directive, 22 Aug 2026:
 * REFRESH IS MANUAL UNTIL FURTHER NOTICE).
 *
 * The portal remains a CONSUMER: this module owns no ETL. It only invokes the
 * AG repo's single sanctioned entry point (ops/refresh-manual.sh) — the same
 * command the operator would run in a terminal — and reports its progress.
 * No parameters ever reach the shell; the script path is fixed by env config.
 *
 * Config (.env.local, not secret):
 *   BACKOFFICE_REFRESH_DIR    absolute path of the AG Sourcing Tool repo
 *   BACKOFFICE_REFRESH_SCRIPT relative script path (default ops/refresh-manual.sh)
 */

const STATE_DIR = join(process.cwd(), ".backoffice");
const STATE_FILE = join(STATE_DIR, "state.json");
const LOG_FILE = join(STATE_DIR, "refresh-latest.log");

export interface RefreshState {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string[];
}

interface Persisted {
  pid: number;
  startedAt: string;
}

export function refreshConfig(): { dir: string; script: string } | null {
  const dir = process.env.BACKOFFICE_REFRESH_DIR;
  if (!dir || !existsSync(dir)) return null;
  const script = process.env.BACKOFFICE_REFRESH_SCRIPT ?? "ops/refresh-manual.sh";
  if (!existsSync(join(dir, script))) return null;
  return { dir, script };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readState(): Persisted | null {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Persisted;
  } catch {
    return null;
  }
}

function logTail(lines: number): string[] {
  try {
    const all = readFileSync(LOG_FILE, "utf8").split("\n");
    return all.slice(Math.max(0, all.length - lines)).filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

export function refreshStatus(): RefreshState {
  const st = readState();
  const tail = logTail(40);
  const exitLine = tail.findLast?.((l) => l.startsWith("BACKOFFICE-EXIT:")) ?? [...tail].reverse().find((l) => l.startsWith("BACKOFFICE-EXIT:"));
  const exitCode = exitLine ? Number(exitLine.split(":")[1]) : null;
  const finishedLine = [...tail].reverse().find((l) => l.startsWith("BACKOFFICE-FINISHED:"));
  const running = Boolean(st && alive(st.pid) && exitCode == null);
  return {
    running,
    pid: st?.pid ?? null,
    startedAt: st?.startedAt ?? null,
    finishedAt: finishedLine ? finishedLine.slice("BACKOFFICE-FINISHED:".length) : null,
    exitCode,
    logTail: tail.filter((l) => !l.startsWith("BACKOFFICE-")),
  };
}

export function startRefresh(): { ok: true; pid: number } | { ok: false; reason: string; status?: number } {
  const cfg = refreshConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 501,
      reason:
        "Backoffice refresh is not configured. Set BACKOFFICE_REFRESH_DIR (the AG Sourcing Tool repo path) in .env.local.",
    };
  }
  const current = refreshStatus();
  if (current.running) {
    return { ok: false, status: 409, reason: "A refresh is already running — one at a time, by design." };
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOG_FILE, `BACKOFFICE-STARTED:${new Date().toISOString()}\n`);
  // Fixed command; no user input reaches the shell. Exit code + finish time
  // are stamped into the log so status survives the detached process.
  const cmd = `./${cfg.script} >> ${JSON.stringify(LOG_FILE)} 2>&1; ec=$?; echo "BACKOFFICE-FINISHED:$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> ${JSON.stringify(LOG_FILE)}; echo "BACKOFFICE-EXIT:$ec" >> ${JSON.stringify(LOG_FILE)}`;
  const child = spawn("/bin/bash", ["-c", cmd], { cwd: cfg.dir, detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid ?? -1;
  writeFileSync(STATE_FILE, JSON.stringify({ pid, startedAt: new Date().toISOString() } satisfies Persisted));
  return { ok: true, pid };
}
