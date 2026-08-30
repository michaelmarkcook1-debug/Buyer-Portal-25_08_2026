import { movementEffect } from "@/lib/metrics/dictionary";
import type { TwelveMonthDimension } from "@/lib/metrics/types";
import { CONFIDENCE_LABEL, EmptyEvidence, MovementText, Panel } from "./ui";

/**
 * The 12-month retrospective view (spec §3/§10) — only material movement is
 * shown when `materialOnly` is set; the honest empty state is a legitimate
 * product state, not a failure.
 */
export function TwelveMonthChange({
  changes,
  materialOnly = false,
}: {
  changes: TwelveMonthDimension[];
  materialOnly?: boolean;
}) {
  const rows = materialOnly
    ? changes.filter((c) => c.movement.includes("improving") || c.movement.includes("deteriorating"))
    : changes;

  if (rows.length === 0) {
    return (
      <EmptyEvidence
        title="No material change detected across your selected vendors today."
        body="The retrospective window shows no movement the record can support. That is a finding, not a gap — nothing here is manufactured to fill the page."
      />
    );
  }

  return (
    <Panel>
      <ul className="m-0 list-none divide-y p-0" style={{ borderColor: "var(--surface-line-soft)" }}>
        {rows.map((c) => (
          <li
            key={c.dimension}
            className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-5"
            style={{ borderColor: "var(--surface-line-soft)" }}
          >
            <div className="w-52 shrink-0 font-medium" style={{ color: "var(--fg)" }}>
              {c.dimension}
            </div>
            <MovementText
              movement={c.movement}
              /* Undefined metricId renders the direction neutral — a row with no
                 governing variable states its direction without a verdict. */
              effect={c.metricId ? movementEffect(c.metricId, c.movement) : undefined}
              className="w-44 shrink-0 text-[0.94rem]"
            />
            <div className="min-w-0 text-[0.94rem] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              {c.detail}
              <span className="code ml-2 text-[0.76rem]" style={{ color: "var(--fg-dim)" }}>
                · {c.source} · confidence {CONFIDENCE_LABEL[c.confidence]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
