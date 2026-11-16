# One number, one source (gate B)

A figure shown in more than one place (a Home tile, its pop-up, an area page or tree, the report,
the suggestion dock, the chat, the weekly email, the month close) is the same to the cent
everywhere, and rounds the same way. Each comes from one function; the surfaces read it, never
work it out again. `src/lib/one-number.integration.test.ts` loads every surface for each sample
person on the demo bank (whose second login is an account linked twice) and holds them equal.

## The figures and their one source

| Figure | Shown on | The one source |
| --- | --- | --- |
| Net worth today | Home headline and the last day of its line, Money page, money hub, /net-worth, chat `net_worth`, "explain this figure", the weekly email, the month close, the monthly report | `loadNetWorthInputs` (src/lib/net-worth-history.ts): each account once, what the person owns at their values, crypto; `netWorth` over them |
| Net worth on a past day | Home's line and its day boxes, the weekly email's change, /net-worth's months | `dailyNetWorth` / `netWorthLine` over `loadNetWorthInputs` |
| Safe to spend and its parts | Home tile, its Why and How pop-ups, /figures, chat | `safeToSpend` via `homeSummary` |
| Coming-up bills | Home strip, Plans, chat | `comingUpBills` via `loadComingUp` |
| Pay and the next payday | Home cash flow, safe to spend, chat | `expectedPaydays` / `nextPayday` |
| Spending and income by month | Money page, Home's Money tile, Insights, budgets, the monthly report | `spendingInsights` over `loadInsightTransactions` |
| A finding's saving | report, its own page, chat | `Finding.annualSavingsCents` |
| Saved, confirmed and estimated | Home's Saved tile, chat, the monthly report | `verifiedSavings` |

## Rounding

Each surface shows the same cents in its own format, one rule each: whole dollars rounded
(`formatWholeDollars`) on Home's tiles and the dock, cents (`formatCents`) in the chat, the report
and emails, and `shortMoney` ($1.4k) on the trees. A sum's lines round as its total does.

## Still split (being moved to one source)

- Debt owed: four sums (Home's Loans tile, the Money node, the Loans page and chat's `debts`, Plans).
- Investments: the Investing page keeps an account linked twice; net worth doesn't.
- Bank fees a year: the report's rule and the dock's `bankFeesYear` pace differently past 200 days.
- Chat spending and the month close's in and out: their own sums, not `spendingInsights`.
- A finding's worth and how sure it is: the report's rule and the dock's detector each work it out.
- Home: Money found against the plan's total; Saved against its list; this month's spending and
  goals on track, tile against tree.
