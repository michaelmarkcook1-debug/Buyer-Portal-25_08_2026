"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  configured: boolean;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string[];
}

/** Manual-refresh trigger + live status. Polls only while a run is active. */
export function BackofficeRefresh() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/backoffice/refresh", { cache: "no-store" });
      setStatus((await r.json()) as Status);
    } catch {
      /* transient — next poll retries */
    }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(() => void poll(), 5000);
    return () => clearInterval(t);
  }, [status?.running, poll]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/backoffice/refresh", { method: "POST" });
      const body = (await r.json()) as { error?: string };
      if (!r.ok) setError(body.error ?? "Refresh could not be started.");
      await poll();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || status?.running || status?.configured === false}
          className="tap rounded-[var(--radius-md)] px-5 py-2.5 font-medium disabled:opacity-50"
          style={{ background: "var(--accent-fill)", color: "#07142a" }}
        >
          {status?.running ? "Refresh running…" : "Run manual refresh"}
        </button>
        <span className="code text-[0.82rem]" style={{ color: "var(--fg-dim)" }}>
          {status?.running
            ? `Started ${status.startedAt ?? ""} — one run at a time.`
            : status?.exitCode != null
              ? `Last run finished ${status.finishedAt ?? ""} · exit ${status.exitCode} ${status.exitCode === 0 ? "(clean)" : "(with stage failures — see log)"}`
              : "No run recorded via this panel yet."}
        </span>
      </div>

      {status?.configured === false ? (
        <p className="mt-3 mb-0 text-[0.94rem]" style={{ color: "var(--data-watch-ink)" }}>
          Not configured: set BACKOFFICE_REFRESH_DIR in .env.local to the AG Sourcing Tool repo path.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 mb-0 text-[0.94rem]" style={{ color: "var(--data-risk-ink)" }}>
          {error}
        </p>
      ) : null}

      {status?.logTail?.length ? (
        <pre
          className="code mt-4 max-h-72 overflow-auto rounded-[var(--radius-md)] px-4 py-3 text-[0.82rem] leading-relaxed"
          style={{ background: "var(--bg-elev-2)", color: "var(--fg-muted)", border: "1px solid var(--surface-line-soft)" }}
        >
          {status.logTail.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}
