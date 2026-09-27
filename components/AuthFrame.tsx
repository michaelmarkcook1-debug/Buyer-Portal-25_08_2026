import type { ReactNode } from "react";
import { Panel } from "./ui";

/** The frame for sign-in and sign-up: brand, one panel, nothing else to navigate. */
export function AuthFrame({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[30rem] flex-col justify-center px-5 py-12">
      <div className="mb-6 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ag-mark-on-light.png" alt="" width={28} height={28} className="h-7 w-7 rounded-[6px] bg-[#f6f1e7] p-1" />
        <span className="display text-title" style={{ color: "var(--fg)" }}>AnalystGenius</span>
        <span className="eyebrow ml-1">Buyer Portal</span>
      </div>
      <Panel hero className="px-6 py-7 sm:px-8">
        <div className="eyebrow" style={{ color: "var(--accent-ink)" }}>{eyebrow}</div>
        <h1 className="display mt-2 text-section leading-tight" style={{ color: "var(--fg)" }}>{title}</h1>
        <div className="mt-5">{children}</div>
      </Panel>
    </main>
  );
}

export function Field({
  id,
  label,
  type,
  autoComplete,
  defaultValue,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-label font-semibold" style={{ color: "var(--fg)" }}>{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        required
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="mt-1.5 block w-full rounded-md px-3 py-2.5 text-body outline-none focus-visible:ring-2"
        style={{
          background: "var(--bg-elev-2)",
          border: "1px solid var(--surface-line)",
          color: "var(--fg)",
        }}
      />
      {hint ? <span className="mt-1 block text-meta" style={{ color: "var(--fg-dim)" }}>{hint}</span> : null}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 mt-0 rounded-md px-3 py-2.5 text-label"
      style={{ background: "var(--data-watch-soft)", color: "var(--data-watch-ink)" }}
    >
      {message}
    </p>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="tap mt-5 w-full cursor-pointer rounded-md px-5 py-2.5 text-body font-semibold"
      style={{ background: "var(--accent-fill)", color: "#07142a", border: "none" }}
    >
      {children}
    </button>
  );
}
