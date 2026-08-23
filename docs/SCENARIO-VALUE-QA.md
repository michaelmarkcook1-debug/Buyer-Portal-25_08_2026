# Scenario value classification — internal QA

**Not buyer-facing.** These labels exist to identify scenarios that may
eventually deserve removal. They are never rendered in the portal.

Method: for each predefined scenario, compare the rendered scenario table
against the baseline on the Accenture + Cognizant + TCS market. A scenario is

- **DECISION_CHANGING** — at least one vendor's *overall* opportunity level
  changes, or its strongest lever changes. The strategic reading moves.
- **USEFUL_CONTEXT** — at least one opportunity family shifts a band, but the
  headline position holds. Informs the conversation without changing it.
- **LOW_VALUE** — nothing moves. Candidate for removal.

Audit run 23 Aug 2026 (`scripts/scenario-audit.ts` for the offline form; the
authoritative run was against the live scenario tables).

| Scenario | Vendor moving most | Family moving most | Strategy changes? | Class |
|---|---|---|---|---|
| `ai-productivity-up` | Cognizant | Automation +1 band | No | USEFUL_CONTEXT |
| `market-pricing-down` | TCS | Pricing +1 band | No | USEFUL_CONTEXT |
| `delivery-costs-up` | Cognizant | Gain sharing +1 band | No | USEFUL_CONTEXT |
| `demand-weakens` | TCS | Pricing +1 band | No | USEFUL_CONTEXT |
| `intensity-up` | Accenture, Cognizant, TCS | Market test +1 band (×2), Pricing +1 | No | USEFUL_CONTEXT |
| `margins-compress` | Cognizant | Gain sharing +1 band | No | USEFUL_CONTEXT |
| `automation-accelerates` | Cognizant | Automation +1 band | No | USEFUL_CONTEXT |
| `leverage-strengthens` | Accenture, Cognizant, TCS | Market test +1 band (×2), Commercial leverage +1 | No | USEFUL_CONTEXT |

**LOW_VALUE candidates: none.** Every scenario moves at least one family, so
none is inert. No scenario is removed.

## The finding that matters for pilot feedback

**No scenario changes any vendor's overall level on this market**, because all
three vendors already sit at Very High — there is no band above to move into.
The scenarios are therefore doing real work at family level while the headline
reading cannot respond. Two consequences worth watching in pilot:

1. If buyers read the overall level first, scenarios will feel inert to them
   even though the underlying families move. The scenario page should keep
   leading with the family shift, not the unchanged overall band.
2. The ceiling effect is a property of this market, not of the scenarios.
   Re-run this audit on a market with mid-band vendors before concluding any
   scenario is low value.

`intensity-up` and `leverage-strengthens` are the strongest performers here —
each moves all three vendors — and are the best candidates to lead with.
