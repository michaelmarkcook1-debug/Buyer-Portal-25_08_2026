import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  detectExecutor,
  localScriptConfig,
  remoteRunnerUrl,
} from "@/lib/backoffice/executor";
import {
  activeRun,
  claimRun,
  finishRun,
  latestRun,
  reapStaleRuns,
  recentRuns,
  scrubSecrets,
  setStage,
} from "@/lib/backoffice/run-state";

export const dynamic = "force-dynamic";

/**
 * Manual refresh control.
 *
 * A run is started ONLY by an explicit POST from the Backoffice button. There
 * is no schedule, no cron, no auto-run on deploy and no auto-run on page load.
 *
 * Run state lives in the canonical Neon spine rather than in this process, so
 * status survives the request that started it and is visible from any Vercel
 * instance. A run is never reported as running unless a runner genuinely has
 * it.
 */

/** GET — status for the Backoffice UI. Safe to poll while a run is active. */
export async function GET(): Promise<NextResponse> {
  const executor = detectExecutor();
  try {
    await reapStaleRuns();
    const [run, history] = await Promise.all([latestRun(), recentRuns(10)]);
    return NextResponse.json({
      executor: { kind: executor.kind, canRun: executor.canRun, detail: executor.detail, location: executor.location },
      run,
      history,
    });
  } catch (e) {
    return NextResponse.json(
      {
        executor: { kind: executor.kind, canRun: executor.canRun, detail: executor.detail, location: executor.location },
        run: null,
        history: [],
        error: scrubSecrets(e instanceof Error ? e.message : String(e)),
      },
      { status: 200 },
    );
  }
}

/** POST — start one manual refresh. */
export async function POST(_req: NextRequest): Promise<NextResponse> {
  const executor = detectExecutor();

  if (!executor.canRun) {
    // Never claim a run that nothing can execute (§17).
    return NextResponse.json(
      { error: "No refresh runner is available in this environment.", detail: executor.detail, executor: executor.kind },
      { status: 409 },
    );
  }

  await reapStaleRuns();
  const already = await activeRun();
  if (already) {
    return NextResponse.json({ error: "REFRESH ALREADY RUNNING", run: already }, { status: 409 });
  }

  const run = await claimRun(executor.kind);
  if (!run) {
    // Another instance claimed the slot between the check and the insert.
    return NextResponse.json({ error: "REFRESH ALREADY RUNNING", run: await activeRun() }, { status: 409 });
  }

  if (executor.kind === "remote-runner") {
    const url = remoteRunnerUrl()!;
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      if (!res.ok) {
        await finishRun(run.id, `Runner rejected the request (HTTP ${res.status}).`);
        return NextResponse.json({ error: "Runner rejected the request." }, { status: 502 });
      }
    } catch (e) {
      await finishRun(run.id, scrubSecrets(e instanceof Error ? e.message : String(e)));
      return NextResponse.json({ error: "Could not reach the refresh runner." }, { status: 502 });
    }
    return NextResponse.json({ started: true, run });
  }

  /* local-script — the existing sanctioned path, unchanged in what it runs.
     Stage transitions come from the script's own log lines, which
     refresh-cloud.sh emits as "stage: X" / "stage OK: X" / "stage FAILED: X",
     so progress reflects the real run rather than a guess. */
  const cfg = localScriptConfig()!;
  const child = spawn("/bin/bash", [cfg.script], {
    cwd: cfg.dir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const onLine = (line: string) => {
    const start = /stage:\s+(\S+)/.exec(line);
    const ok = /stage OK:\s+(\S+)/.exec(line);
    const fail = /stage FAILED:\s+(\S+)/.exec(line);
    if (ok) void setStage(run.id, ok[1], "success");
    else if (fail) void setStage(run.id, fail[1], "failed", line.trim());
    else if (start) void setStage(run.id, start[1], "running");
  };

  let buf = "";
  const consume = (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) onLine(l);
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("close", (code) => {
    void finishRun(run.id, code === 0 ? null : `Refresh script exited with code ${code}.`);
  });
  child.on("error", (e) => {
    void finishRun(run.id, scrubSecrets(e.message));
  });
  child.unref();

  return NextResponse.json({ started: true, run });
}
