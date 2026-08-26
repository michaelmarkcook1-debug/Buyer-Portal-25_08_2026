import Link from "next/link";

/**
 * The masthead — AG navy at full strength, the one place the brand speaks as a
 * ground for cream type. Type on it never inverts with the theme.
 */

const NAV = [
  { href: "/", label: "Home", id: "home" },
  { href: "/market", label: "Market", id: "market" },
  { href: "/vendors", label: "Vendors", id: "vendors" },
  { href: "/opportunities", label: "Opportunities", id: "opportunities" },
  { href: "/scenarios", label: "Scenarios", id: "scenarios" },
  { href: "/reputation", label: "Reputation", id: "reputation" },
] as const;

export type NavId = (typeof NAV)[number]["id"];

export function Masthead({ active, dateLabel }: { active: NavId; dateLabel: string }) {
  return (
    <header style={{ background: "var(--navy)", borderBottom: "1px solid var(--surface-line-soft)" }}>
      <div className="mx-auto flex max-w-[var(--max-width)] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 sm:px-8 sm:py-4">
        <Link href="/" className="flex items-center gap-3">
          {/* Approved brand mark — white variant on the navy masthead (the
              supplied asset, untouched; the indigo variant is used only on
              light grounds). 372px source stays sharp at 3x DPI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/ag-mark-on-dark.png"
            alt="AnalystGenius"
            width={34}
            height={34}
            className="h-[30px] w-[30px] shrink-0 select-none sm:h-[34px] sm:w-[34px]"
          />
          <div>
            <h1
              className="display m-0 whitespace-nowrap text-[17px] font-normal sm:text-[21px]"
              style={{ color: "var(--on-navy)" }}
            >
              AnalystGenius
            </h1>
            <div className="eyebrow hidden text-[9px] sm:block" style={{ color: "var(--on-navy-muted)" }}>
              Buyer Portal
            </div>
          </div>
        </Link>

        <nav
          aria-label="Primary"
          className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 sm:order-none sm:w-auto sm:overflow-visible"
        >
          {NAV.map((item) => {
            const isActive = item.id === active;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className="tap shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors"
                style={{
                  color: isActive ? "var(--on-navy)" : "var(--on-navy-muted)",
                  background: isActive ? "color-mix(in srgb, var(--ag-dark-gold-bright) 14%, transparent)" : undefined,
                  transitionDuration: "var(--motion-fast)",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden text-right sm:block">
          <div className="eyebrow text-[9px]" style={{ color: "var(--on-navy-muted)" }}>
            Intelligence briefing
          </div>
          <div
            className="code tabular whitespace-nowrap text-[11px] sm:text-[13px]"
            style={{ color: "var(--on-navy)" }}
          >
            {dateLabel}
          </div>
        </div>
      </div>
    </header>
  );
}
