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
 * During testing, execution is local by design: the refresh runs on the AG
 * machine and writes its progress to the shared operational table, which the
 * deployed portal reads. A deployed instance therefore reports status rather
 * than executing, and that is a healthy state, not a missing runner.
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
      executor,
      run,
      history,
    });
  } catch (e) {
    return NextResponse.json(
      {
        executor,
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
    /* Refuse rather than claim a run nothing will execute — but this is the
       intended operating mode, so it is stated plainly rather than as a fault. */
    return NextResponse.json(
      { started: false, mode: executor.mode, reason: executor.reason, detail: executor.detail },
      { status: 409 },
    );
  }

  await reapStaleRuns();
  const already = await activeRun();
  if (already) {
    return NextResponse.json({ error: "REFRESH ALREADY RUNNING", run: already }, { status: 409 });
  }

  const run = await claimRun(executor.runner);
  if (!run) {
    // Another instance claimed the slot between the check and the insert.
    return NextResponse.json({ error: "REFRESH ALREADY RUNNING", run: await activeRun() }, { status: 409 });
  }

  if (executor.mode === "remote-runner") {
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

  /* Serialised so transitions cannot overwrite each other, and so the run is
     not closed before its last stage result is durable. */
  let writes: Promise<unknown> = Promise.resolve();
  const record = (fn: () => Promise<void>) => {
    writes = writes.then(fn, fn);
  };

  const onLine = (line: string) => {
    const start = /stage:\s+(\S+)/.exec(line);
    const ok = /stage OK:\s+(\S+)/.exec(line);
    const fail = /stage FAILED:\s+(\S+)/.exec(line);
    if (ok) record(() => setStage(run.id, ok[1]!, "success"));
    else if (fail) record(() => setStage(run.id, fail[1]!, "failed", line.trim()));
    else if (start) record(() => setStage(run.id, start[1]!, "running"));
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
    void writes.then(() => finishRun(run.id, code === 0 ? null : `Refresh script exited with code ${code}.`));
  });
  child.on("error", (e) => {
    void finishRun(run.id, scrubSecrets(e.message));
  });
  child.unref();

  return NextResponse.json({ started: true, run });
}
