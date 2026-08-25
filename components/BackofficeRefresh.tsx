"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REFRESH_STAGES, type StageStatus } from "@/lib/backoffice/stages";

/**
 * Manual refresh control.
 *
 * The only client component in the portal, and deliberately small: it starts a
 * run when the operator presses the button and polls status while one is
 * genuinely active. It never starts anything on mount, never polls when idle,
 * and stops the moment a run reaches a terminal state.
 *
 * Where a refresh cannot be started from — the deployed portal, during the
 * local testing model — it shows no button at all rather than a dead one, and
 * says where refreshes do run. Everything else on the page stays live, because
 * status is read from the shared spine either way.
 */

interface StageResult {
  id: string;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

interface Run {
  id: string;
  runnerRef?: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  currentStage: string | null;
  stages: StageResult[];
  errorSummary: string | null;
  runner: string;
}

interface Executor {
  mode: "local-manual" | "github-actions" | "remote-runner";
  canRun: boolean;
  healthy: boolean;
  reason: "local-execution" | "local-testing-mode" | "github-actions" | "remote-runner";
  detail: string;
  location: string;
}

interface Status {
  executor: Executor;
  run: Run | null;
  history: Run[];
  error?: string;
}

const POLL_MS = 4000;

const MODE_LABEL: Record<Status["executor"]["reason"], string> = {
  "local-execution": "Manual mode — runs on this machine",
  "local-testing-mode": "Local manual mode",
  "github-actions": "Manual mode — GitHub Actions",
  "remote-runner": "Remote runner configured",
};

const TONE: Record<StageStatus, { ink: string; label: string }> = {
  pending: { ink: "var(--fg-dim)", label: "Pending" },
  running: { ink: "var(--accent-ink)", label: "Running" },
  success: { ink: "var(--data-positive-ink)", label: "Success" },
  failed: { ink: "var(--data-risk-ink)", label: "Failed" },
  skipped: { ink: "var(--fg-muted)", label: "Skipped" },
};

function clock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function duration(a: string | null, b: string | null): string {
  if (!a) return "—";
  const end = b ? new Date(b).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function BackofficeRefresh({ initial }: { initial: Executor }) {
  /* Seeded from the server's own detection so the first paint states the real
     mode. Without it the page briefly claims it cannot run while the status
     request is still in flight. */
  const [status, setStatus] = useState<Status | null>({ executor: initial, run: null, history: [] });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backoffice/refresh", { cache: "no-store" });
      setStatus((await res.json()) as Status);
    } catch {
      /* transient — the next poll or a manual reload recovers */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a run is genuinely active; stop on any terminal state.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (status?.run?.status === "running") {
      timer.current = setTimeout(() => void load(), POLL_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [status, load]);

  const start = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/backoffice/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) setNote(body.error ?? "Could not start a refresh.");
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not start a refresh.");
    } finally {
      setBusy(false);
    }
  };

  const run = status?.run ?? null;
  /* Built from the repo identity the status endpoint reports — never from a
     token, which is server-side only and never reaches this component. */
  const ghBase =
    status?.executor.mode === "github-actions" && status.executor.location.includes("/")
      ? `https://github.com/${status.executor.location}`
      : null;
  const running = run?.status === "running";
  const canRun = status?.executor.canRun ?? initial.canRun;
  const stages = run?.stages ?? REFRESH_STAGES.map((s) => ({ id: s.id, status: "pending" as StageStatus, startedAt: null, finishedAt: null, message: null }));

  return (
    <div className="flex flex-col gap-5">
      {/* The operating mode, stated before anything else. A deployed portal
          that cannot execute is working as intended, so this is written in the
          ordinary voice of the page — never in a warning colour. */}
      <div
        className="rounded-[var(--radius-sm)] px-4 py-3 text-[0.94rem] leading-relaxed"
        style={{
          background: "var(--bg-elev-2)",
          color: "var(--fg-muted)",
          border: "1px solid var(--surface-line)",
        }}
      >
        <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          {MODE_LABEL[(status ?? { executor: initial }).executor.reason]}
        </span>{" "}
        {(status ?? { executor: initial }).executor.detail}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {canRun ? (
          <button
            type="button"
            onClick={start}
            disabled={running || busy}
            className="tap rounded-[var(--radius-sm)] px-5 py-2.5 text-[0.95rem] font-medium transition-colors"
            style={{
              background: running || busy ? "var(--bg-elev-2)" : "var(--accent-fill)",
              color: running || busy ? "var(--fg-dim)" : "var(--on-accent, #0b1220)",
              border: "1px solid var(--surface-line)",
              cursor: running || busy ? "not-allowed" : "pointer",
            }}
          >
            {running ? "Refresh already running" : busy ? "Starting…" : "Run manual refresh"}
          </button>
        ) : (
          /* No dead button: the honest statement is where it runs instead. */
          <span
            className="rounded-[var(--radius-sm)] px-4 py-2.5 text-[0.95rem]"
            style={{ background: "var(--bg-elev-2)", border: "1px solid var(--surface-line)", color: "var(--fg-muted)" }}
          >
            Run from the local AG environment
          </span>
        )}
        {run ? (
          <span className="code text-[0.86rem]" style={{ color: "var(--fg-muted)" }}>
            {run.status === "running" ? "RUNNING" : run.status === "success" ? "SUCCESS" : "FAILED"} · started{" "}
            {clock(run.startedAt)} · {duration(run.startedAt, run.finishedAt)}
            {run.currentStage ? ` · ${run.currentStage}` : ""}
          </span>
        ) : null}
        {run?.runnerRef && status?.executor.mode === "github-actions" && ghBase ? (
          <a
            href={`${ghBase}/actions/runs/${run.runnerRef}`}
            target="_blank"
            rel="noreferrer"
            className="tap-link code text-[0.86rem] underline-offset-4 hover:underline"
            style={{ color: "var(--fg-muted)" }}
          >
            View workflow run
          </a>
        ) : (
          <span className="code text-[0.86rem]" style={{ color: "var(--fg-dim)" }}>
            {canRun ? "IDLE — no run recorded" : "LOCAL EXECUTION ONLY — no run recorded yet"}
          </span>
        )}
      </div>

      {note ? (
        <p className="m-0 text-[0.94rem]" style={{ color: "var(--data-watch-ink)" }}>
          {note}
        </p>
      ) : null}

      {run?.errorSummary ? (
        <p className="m-0 text-[0.94rem]" style={{ color: "var(--data-risk-ink)" }}>
          {run.errorSummary}
        </p>
      ) : null}

      {/* Stages */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.95rem]" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th className="eyebrow px-3 py-2.5 text-left font-semibold">Stage</th>
              <th className="eyebrow px-3 py-2.5 text-left font-semibold">What it lands</th>
              <th className="eyebrow px-3 py-2.5 text-left font-semibold">Status</th>
              <th className="eyebrow px-3 py-2.5 text-left font-semibold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {REFRESH_STAGES.map((spec) => {
              const s = stages.find((x) => x.id === spec.id);
              const st = s?.status ?? "pending";
              return (
                <tr key={spec.id} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                  <td className="px-3 py-3">
                    <div style={{ color: "var(--fg)" }}>{spec.label}</div>
                    <div className="code text-[0.8rem]" style={{ color: "var(--fg-dim)" }}>
                      {spec.command}
                    </div>
                  </td>
                  <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>
                    {spec.what}
                  </td>
                  <td className="px-3 py-3">
                    <span className="code text-[0.86rem]" style={{ color: TONE[st].ink }}>
                      {TONE[st].label}
                    </span>
                    {s?.message ? (
                      <div className="mt-1 text-[0.84rem]" style={{ color: "var(--data-risk-ink)" }}>
                        {s.message}
                      </div>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-3" style={{ color: "var(--fg-muted)" }}>
                    {s?.startedAt ? duration(s.startedAt, s.finishedAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent runs */}
      {status?.history && status.history.length > 0 ? (
        <div className="mt-2">
          <div className="eyebrow" style={{ color: "var(--fg-dim)" }}>
            Recent runs
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-[0.95rem]" style={{ minWidth: 460 }}>
              <thead>
                <tr>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Started</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Duration</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Result</th>
                  <th className="eyebrow px-3 py-2.5 text-left font-semibold">Failed stage</th>
                </tr>
              </thead>
              <tbody>
                {status.history.map((h) => (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--surface-line-soft)" }}>
                    <td className="tabular px-3 py-3" style={{ color: "var(--fg-muted)" }}>{clock(h.startedAt)}</td>
                    <td className="tabular px-3 py-3" style={{ color: "var(--fg-muted)" }}>{duration(h.startedAt, h.finishedAt)}</td>
                    <td className="px-3 py-3">
                      <span
                        className="code text-[0.86rem]"
                        style={{ color: h.status === "success" ? "var(--data-positive-ink)" : h.status === "failed" ? "var(--data-risk-ink)" : "var(--accent-ink)" }}
                      >
                        {h.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3" style={{ color: "var(--fg-muted)" }}>
                      {h.stages.filter((s) => s.status === "failed").map((s) => s.id).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
