# Buyer Decision Quality (BDQ)

An internal release gate. It answers one question:

> **Has this release made buyer decision quality better, worse or unchanged?**

BDQ is QA infrastructure. It has no route, no tab, no database table and
nothing rendered to a buyer. It lives in `scripts/bdq/` and `tests/bdq.test.ts`.

## Why it exists

Several phases of manual pilot auditing established a method: simulate a CPO /
Head of Technology Sourcing, give them real portal data, and see whether they
can answer twelve specific buyer questions. That method found real defects —
red "Deteriorating" next to prose explaining the same movement improved buyer
leverage; two evidence families 63 days apart with near-identical names.

Repeating that by hand after every change does not scale, and the parts of it
that are structural do not need a human. BDQ encodes those parts.

## When to run it

After any meaningful change to data, resolver logic, Analyst Insight, market
interpretation, vendor differentiation, opportunity logic, or presentation
semantics. Before cutting a release.

```bash
pnpm test:buyer-quality           # Mode A — deterministic, no LLM
pnpm test:buyer-quality:insight   # Mode A + Mode B (generates briefings)
pnpm test:buyer-quality -- --verbose
```

`pnpm test` runs the harness's own unit and mutation suite (`tests/bdq.test.ts`),
which needs no database, no network and no model.

## The two modes

**Mode A — deterministic.** Grades the canonical resolved intelligence across
six locked scopes. Needs the database; never calls the model. An API outage
cannot produce a false product regression.

**Mode B — Analyst Insight.** Generates a briefing per scope and scores it on
the existing seven-point standard. When the provider is unavailable it reports
`SKIPPED — PROVIDER UNAVAILABLE` and leaves the deterministic verdict alone.

## What the results mean

| Result | Meaning | Exit |
|---|---|---|
| `PASS` | Every check passed. | 0 |
| `PASS WITH REVIEW` | No failures; something needs human judgement. | 0 |
| `FAIL` | A material check failed. Do not release without understanding why. | 1 |
| — | Harness error (couldn't run). | 2 |

**REVIEW does not fail CI.** It is used where a machine should not be the
final judge — headline length, an undated rollup of dated readings. These are
raised for a person, not decided by a regex.

Machine-readable output lands in `scripts/bdq/out/last-run.json`
(`runAt`, `commit`, `mode`, `status`, `scopes`, `vendors`, `tasks`, `checks`,
`reviews`, `failures`, `evidenceBalance`, `insight`, `timingMs`).

## What it checks

Structure, never wording, and never a figure. `$7.3bn` and `146 → 12` move with
the data; whether a finding still carries a source, a date and something to
challenge does not.

- **Buyer tasks** — BDQ-01 … BDQ-12, answerable in each scope
- **Four-question chain** — what changed / why it matters / implication / what to challenge
- **Firewalls** — ownership and proprietary score (a disclaimer is the firewall working, not breaching)
- **Trust** — provenance, evidence dating, freshness semantics
- **Action quality** — every sufficiently-evidenced vendor offers a challenge that names something specific
- **Semantic colour** — buyer effect stays separate from raw direction (locked by `072596c`)
- **Demand vs market heat** — each metric internally consistent with its own definition
- **Cross-page consistency** — the same metric on the same vendor cannot resolve two ways
- **Honest insufficiency** — thin evidence may say so; it may not over-claim
- **AG / contract balance** — reported as a diagnostic, never a gate

## What it does NOT prove

**BDQ does not replace real buyer testing.** It cannot tell you whether a
finding is *interesting*, whether a challenge would land in a real QBR, or
whether the analysis is *right*. It tests that the structure supporting a good
answer is present — not that the answer is good.

It will not catch: an analytically wrong but well-formed conclusion; a finding
that is accurate but useless; a briefing that reads well and says nothing;
prose a buyer would find condescending or confusing. Those need people.

A green BDQ means nothing has structurally regressed. It does not mean the
release is good.

## Extending it

Detectors are pure functions in `scripts/bdq/checks.ts` — no I/O, so each one
can be driven by a fixture. Add a detector there, add a healthy-and-mutated
pair to `tests/bdq.test.ts`, and wire it into `scripts/buyer-quality.ts`.

Two rules: never pin a figure that legitimately moves, and never weaken a
detector to make a baseline green. If BDQ finds something real, that is the
harness working.
