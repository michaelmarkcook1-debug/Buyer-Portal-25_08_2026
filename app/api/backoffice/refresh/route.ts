import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  detectExecutor,
  githubConfig,
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

/**
 * Recent executions of the refresh workflow, read with the server-side token.
 *
 * The Backoffice needs this to link an operator to the real logs, and a
 * validation dispatch is otherwise invisible from outside GitHub. Only the
 * identity, state and URL of each run are returned — never the token.
 */
async function recentWorkflowRuns(): Promise<
  { id: number; status: string; conclusion: string | null; url: string; created: string; event: string }[]
> {
  const gh = githubConfig();
  if (!gh) return [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/workflows/${gh.workflow}/runs?per_page=5`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${gh.token}`,
          "x-github-api-version": "2022-11-28",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { workflow_runs?: Record<string, unknown>[] };
    const runs = (body.workflow_runs ?? []).map((r) => ({
      id: Number(r.id),
      status: String(r.status),
      conclusion: r.conclusion ? String(r.conclusion) : null,
      url: String(r.html_url),
      created: String(r.created_at),
      event: String(r.event),
      failedSteps: [] as string[],
      logTail: "" as string,
    }));

    /* For the newest run only, name the steps that failed. Without this a
       failed workflow is opaque from the product: the operator sees "failure"
       and has to leave to find out what broke. */
    const newest = runs[0];
    if (newest && newest.conclusion && newest.conclusion !== "success") {
      try {
        const jr = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/runs/${newest.id}/jobs`, {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${gh.token}`,
            "x-github-api-version": "2022-11-28",
          },
          cache: "no-store",
        });
        if (jr.ok) {
          const jb = (await jr.json()) as {
            jobs?: { id: number; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[];
          };
          let failedJobId: number | null = null;
          for (const job of jb.jobs ?? []) {
            for (const st of job.steps ?? []) {
              if (st.conclusion && st.conclusion !== "success" && st.conclusion !== "skipped") {
                newest.failedSteps.push(`${st.name} (${st.conclusion})`);
                failedJobId = job.id;
              }
            }
          }
          /* The tail of the failing job, so the reason is visible in the
             product instead of only inside GitHub. Bounded and scrubbed —
             GitHub masks its own secrets, and this never trusts that alone. */
          if (failedJobId) {
            const lr = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/jobs/${failedJobId}/logs`, {
              headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${gh.token}`,
                "x-github-api-version": "2022-11-28",
              },
              cache: "no-store",
            });
            if (lr.ok) {
              const text = await lr.text();
              /* Blind-tailing a job log returns post-job cleanup, which says
                 nothing. Prefer the lines that actually diagnose. */
              const lines = text.split("\n").map((l) => l.replace(/^\S+Z\s/, "")).filter((l) => l.trim());
              const signal = lines.filter((l) =>
                /VALIDATION|MISSING|problems:|Error|error:|failed|refus|unreachable|REJECTED|stages discovered|write target|reachable|readable|credential/i.test(
                  l,
                ),
              );
              newest.logTail = scrubSecrets((signal.length ? signal : lines.slice(-40)).slice(-45).join("\n").slice(-4000));
            }
          }
        }
      } catch {
        /* diagnostics only — never fail the status read */
      }
    }
    return runs;
  } catch {
    return [];
  }
}

/** Dispatch one workflow run. Returns null on success, a scrubbed reason otherwise. */
async function dispatchWorkflow(runId: string, mode: "validation" | "refresh"): Promise<string | null> {
  const gh = githubConfig()!;
  const res = await fetch(
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/workflows/${gh.workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${gh.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: gh.ref, inputs: { refresh_run_id: runId, mode } }),
    },
  );
  if (res.ok) return null;
  return scrubSecrets(`HTTP ${res.status}. ${(await res.text()).slice(0, 300)}`);
}

/** GET — status for the Backoffice UI. Safe to poll while a run is active. */
export async function GET(): Promise<NextResponse> {
  const executor = detectExecutor();
  try {
    await reapStaleRuns();
    const [run, history, workflowRuns] = await Promise.all([
      latestRun(),
      recentRuns(10),
      executor.mode === "github-actions" ? recentWorkflowRuns() : Promise.resolve([]),
    ]);
    return NextResponse.json({ executor, run, history, workflowRuns });
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
export async function POST(req: NextRequest): Promise<NextResponse> {
  const executor = detectExecutor();

  /* Validation dispatch: infrastructure check only. It claims no run and
     touches no operational row, because a check must never leave a trace that
     looks like a completed refresh. */
  const mode = new URL(req.url).searchParams.get("mode");
  if (mode === "validation") {
    if (executor.mode !== "github-actions") {
      return NextResponse.json(
        { started: false, detail: "Validation runs on the GitHub Actions executor only." },
        { status: 409 },
      );
    }
    const failure = await dispatchWorkflow("validation", "validation");
    if (failure) return NextResponse.json({ started: false, error: failure }, { status: 502 });
    return NextResponse.json({ started: true, mode: "validation", note: "VALIDATION ONLY — NO DATA WRITTEN." });
  }

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

  if (executor.mode === "github-actions") {
    /* Dispatch and return. The workflow claims the run for its own execution
       id and reports progress into the shared operational row, which the
       Backoffice polls — the HTTP request never waits for the pipeline. */
    try {
      const failure = await dispatchWorkflow(run.id, "refresh");
      if (failure) {
        /* Release the slot rather than leaving a run nothing is executing. */
        await finishRun(run.id, `GitHub did not accept the workflow dispatch. ${failure}`);
        return NextResponse.json({ started: false, error: "GitHub did not accept the workflow dispatch." }, { status: 502 });
      }
    } catch (e) {
      await finishRun(run.id, scrubSecrets(e instanceof Error ? e.message : String(e)));
      return NextResponse.json({ started: false, error: "Could not reach GitHub to dispatch the refresh." }, { status: 502 });
    }
    return NextResponse.json({ started: true, run });
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

  /* Everything the child says that ISN'T a stage marker used to be parsed and
     dropped, so a failing stage recorded only "stage FAILED: x" and the actual
     error — the one line that would explain it — was lost. Keep a small rolling
     tail and attach it to the failure, which is what makes a spawn-only failure
     diagnosable at all. */
  const TAIL = 40;
  let tail: string[] = [];

  const onLine = (line: string) => {
    const start = /stage:\s+(\S+)/.exec(line);
    const ok = /stage OK:\s+(\S+)/.exec(line);
    const fail = /stage FAILED:\s+(\S+)/.exec(line);
    if (ok) {
      tail = [];
      record(() => setStage(run.id, ok[1]!, "success"));
    } else if (fail) {
      /* Wide enough to carry a stack-framed error: the first capture cut the
         Prisma message off above the pnpm wrapper's own failure lines. */
      const why = tail.filter((l) => l.trim()).slice(-18).join(" ⏎ ");
      record(() => setStage(run.id, fail[1]!, "failed", why ? `${line.trim()} — ${why}` : line.trim()));
      tail = [];
    } else if (start) {
      tail = [];
      record(() => setStage(run.id, start[1]!, "running"));
    } else {
      tail.push(line);
      if (tail.length > TAIL) tail.shift();
    }
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
