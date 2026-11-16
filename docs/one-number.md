# One number, one source (gate B)

A figure shown in more than one place (a Home tile, its pop-up, an area page or tree, the report,
the suggestion dock, the chat, the weekly email, the month close) is the same to the cent
everywhere, and rounds the same way. Each comes from one function; the surfaces read it, never
work it out again.

The guard is the cross-surface tests, `src/lib/one-number*.integration.test.ts`. They load every
surface the way its page, tool or email loads it, for each of the eight sample people on the demo
bank (whose second login is an account linked twice), plus a hand-built person for what the sample
people don't have. They hold each figure equal. Each failed on main before its fix.

## The figures and their one source

| Figure | Shown on | The one source | Test |
| --- | --- | --- | --- |
| Net worth today | Home headline and the last day of its line, Money page, money hub, /net-worth, chat `net_worth`, "explain this figure", the weekly email, the month close, the monthly report | `loadNetWorthInputs` (src/lib/net-worth-history.ts): each account once, what the person owns at their values, crypto; `netWorth` over them | `one-number` |
| Net worth on a past day | Home's line and its day boxes, the weekly email's change, /net-worth's months | `dailyNetWorth` / `netWorthLine` over `loadNetWorthInputs` | `one-number` |
| What's owed | Home's Loans tile, the Money page, the money hub, the Loans page, chat `debts`, Plans (less the mortgage, as the debt planner) | `loadDebts` (the debt book): its lines' sum, a card in credit owing nothing; `owedSummary` | `one-number-owed` |
| Investments | the Investing page's total, net worth's investments | accounts once (src/lib/account-copies.ts) in `loadInvestments` and net worth | `one-number-investments` |
| Bank fees a year | the report's finding per account, the dock's suggestion, chat `open_findings` | `bankFeesByAccount` over `feeMonthsOf`'s months; a reversal pairs off on its account | `one-number-fees` |
| A month's spending and income | Money page, Home's Money tile, Insights, budgets, chat `monthly_totals` and `spending_by_category`, the month close, the monthly report | `spendingInsights` (`kindOf`) over `loadInsightTransactions` | `one-number-spending` |
| "Spent this month" | Home's Money tile, the Money page's tree, the money hub | `shownSpendingMonth`: the newest month with spending, by name | `one-number-this-month` |
| A finding's worth and % | the report and the dock, for a topic both show | `Finding.annualSavingsCents` (`reportsWorth` in the detectors); the finding's band (`bandCeiling`) | `one-number-worth` |
| Goals on track | Home's Plans tile, the Money page, the money hub, the Plans tree | `goalsOnTrack`: of the goals not reached, on the way and in time with the others (`goalsLate`) | `one-number-goals` |
| Safe to spend and its parts | Home tile, its Why and How pop-ups, /figures, chat | `safeToSpend` via `homeSummary` | |
| Coming-up bills | Home strip, Plans, chat | `comingUpBills` via `loadComingUp` | |
| Pay and the next payday | Home cash flow, safe to spend, chat | `expectedPaydays` / `nextPayday` | |
| Saved, confirmed and estimated | Home's Saved tile, chat, the monthly report | `verifiedSavings` | |

## Rounding

Each surface shows the same cents in its own format, one rule each:
- whole dollars, rounded (`formatWholeDollars`): Home's tiles and the dock;
- cents (`formatCents`): the chat, the report and emails;
- `shortMoney` ($1.4k): the trees.

A sum's lines add up to the total they show: `wholeDollarParts` (src/lib/round-parts.ts) rounds the
parts of a sum that adds up in cents so they add up to the rounded total.

## One figure each, labelled apart (not splits)

- **Money found, against "Your plan".** Money found is everything found, with what investing costs.
  The plan is what's left to decide, overlaps counted once. Each tile says which it is.
- **Saved so far, against its list.** The headline is confirmed money. The list shows the confirmed
  amounts and, on their own line, what's expected and not confirmed yet.
- **A subscription's yearly cost, against the dock's "cancel the ones you don't use".** The report
  lists each subscription at its full cost. The dock's figure is the share people usually cancel.
