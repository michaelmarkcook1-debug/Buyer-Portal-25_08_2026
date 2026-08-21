# AnalystGenius — Services Buyer Portal

Buyer-side intelligence for executives who source, buy and govern IT Services,
consulting and BPO providers. **Select the vendors you care about; AnalystGenius
continuously identifies where market change has created new commercial opportunity.**

A standalone application, deliberately separate from the SourcingGenius desk
(`../AG Sourcing Tool 20_06_2026`), which is never modified from here.

## Integration boundaries (the architecture rule)

```
Authoritative AG intelligence/data
  → stable read / API / adapter boundary
    → Buyer Portal canonical buyer metrics
      → buyer-specific interpretation and UX
```

No AG truth, evidence, scoring or inference logic is duplicated here. Per data
family, the authoritative read-only path is:

| Data family | Authoritative source | Path used here |
|---|---|---|
| Vendor universe (~65 AG-covered vendors) | Landed AG Intelligence catalog + ticker crosswalk in the canonical Neon spine | read-only SQL (`lib/vendors.ts`) — count resolved live, never hardcoded |
| Contract spine (curated commercial contracts) | Canonical `deal` table (promoted from Contract Tracker) | read-only SQL (`lib/data/facts.ts`) |
| AG provider signals (talent, reputation, top issues, claims-vs-delivery) | `stg_analystgenius_signal` — the landed copy that already embeds AG's extraction honesty gate | read-only SQL, latest-version reads |
| SEC 8-K events | `stg_sec_event` | read-only SQL |
| Per-renewal decision briefs (AG interpretation) | SourcingGenius `/api/decision` service (bearer token; built for cross-app consumption) | HTTP adapter (`lib/adapters/decision-api.ts`) — consumed, never reimplemented; renders not-configured when absent |
| AI Enterprise capability scores | Blocked upstream (seed data; extractor under repair) | adapter reports blocked status (`lib/adapters/ai-enterprise.ts`); never displayed |
| Truth gate (`canRenderAsVerified`) | `@ag/truth` shared package | not linked yet — the canonical evidence ledger is empty; when it lands, consume the package via `link:`, do not fork |

The estate's own architecture rule (its ARCHITECTURE.md) is that upstreams land
in the canonical database and are **never queried live at request time** — the
canonical Neon spine is therefore the sanctioned request-time read surface for
facts. Interpretation stays in AG services.

Portal-owned (genuinely new, buyer-specific): the `MarketScope` vendor-market
model, the canonical buyer metric/opportunity layer, ACT/WATCH/KNOW
classification, predefined scenarios, and per-tab Analyst Insight orchestration
with grounding validation.

## Setup

```bash
pnpm install
cp "../AG Sourcing Tool 20_06_2026/.env" .env.local   # DATABASE_URL + AI keys
pnpm dev                                               # http://localhost:3100
```

Without `DATABASE_URL` the portal renders an explicit "data connection not
configured" state. Without an LLM key, Analyst Insight renders its
not-configured state. Neither ever falls back to invented content.

## Evidence ownership (truth rule — correction pass 2026-08-21)

The buyer provides **only a vendor selection**. Their contracts, values, spend,
renewal dates, rates, commitments and SLAs are **not held**. Two evidence
classes are therefore enforced end-to-end:

- **Market evidence** — observed contracts/awards between the vendors and
  *other* organisations, public procurement, SEC filings, AG-derived signals.
  Everything the portal holds today. Labelled "market evidence" in the UI and
  `[market observation]` in the Analyst Insight context.
- **Buyer-owned evidence** — reserved (`ownership: "buyer"` on `Basis`) for a
  future authoritative integration such as Contract Tracker. Nothing produces
  it yet.

A market observation must never be rendered or narrated as the buyer's own —
no "your contract", "your renewal", "your spend", no advice keyed to a market
contract date as if it were the reader's deadline. Enforced three ways: fact
tagging at source (`lib/metrics`), ownership rules in the insight prompt, and a
programmatic **ownership firewall** (`lib/insight/validate.ts`) that blocks
violating output alongside the numeric grounding firewall. Buyer-LEVEL inferred
signals (Buyer Leverage, Savings Opportunity, "your market", "your position")
remain legitimate.

## Credentials

`.env.local` is git-ignored and never committed. Minimum services: the Neon
canonical spine (read-only, `DATABASE_URL`) and the Anthropic API
(`ANTHROPIC_API_KEY`). The current Anthropic key is a **temporary development
dependency borrowed from the AI Enterprise project** — replace it with a
portal-owned key before any deployment. No credential values appear in any
source-controlled file.

## Non-negotiables

- **Selected vendors define the market.** Every metric, ranking, benchmark and
  insight is scoped to the user's vendor selection (or Whole Market = the full
  AG-covered universe). Enforced by threading one `MarketScope` through every read.
- **Zero fabricated figures.** Numbers originate in SQL only. Model prose passes
  a grounding firewall: any figure not present in the supplied context blocks
  the output.
- **Insufficient evidence is a first-class state**, preferred over mock data.
- **No proprietary inference exposed** — result, direction, confidence,
  freshness and analyst interpretation only; never weights, formulas or thresholds.
