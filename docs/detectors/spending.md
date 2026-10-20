# Spending, bills and cash: detector inventory (step 263)

For each spending, bills and cash capability (steps 1 to 80 and Phases AC and AK): what it looks at
(trigger signals), what it is worth (value formula), what raises or lowers the confidence, how urgent
it is, which of step 252's eight people it should and should not fire for, and which detector covers
it (`src/detectors/money.ts` for the first ones, `src/detectors/spending.ts` for step 263's, rates in
`src/config/detectors.ts` and `src/config/detectors-spending.ts`). Nothing here is new behaviour: it
describes what the detection engine (`src/detection/`), the alerts and the insights already compute,
so a detector can stay a thin reader of the same signals over the profile's transactions.

Conventions are those of `docs/detectors/debt.md`: value is dollars a year or at risk; confidence is
`confidenceOf` (told 100%, seen gains with months and matches, guessed capped at 75%) and the
weakest piece wins; urgency is *now* (money is leaving or a deadline is here), *soon* (a better option
exists today), *later* (worth a look). People: R Maya, F the Reyes family, L Sam, H Priya, C Dan and
Lena, T Ruth, D Chris, B Jo.

What the eight carry (from `src/data-sources/demo/demo-people.ts`): every one has a phone bill; R, F,
H and D pay for Netflix and Hulu (F adds Disney+), R, F, C, T and B an internet or utility bill; R's
checking holds $1,120 and savings $640 against about $2,100 of regular bills, D's checking holds $38;
H, C and T keep large cash balances; L's and B's months swing, B's are all positive.

## Subscriptions and recurring charges (steps 8 to 20, 88, 152)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Subscriptions** (`subscriptions`) | Three or more small monthly charges (under $100) in subscription-like categories, each in 3+ months | About a quarter of the yearly total, the share people drop when they look | Up: 12 months, many charges. Down: 3 charges | later | R, F, L, H, T, D | C (one or two) | `subscriptions` (money.ts) |
| **Duplicate subscription** (`duplicate_subscription` finding, 11) | Two or more regular charges in the same kind (two streaming services, two music apps) | The cheapest of each group, a year | Up: 12 months of both. Down: charges that stopped | later | R, F, H, D (Netflix + Hulu) | L, C, T, B | `duplicate_subscription` |
| **Price increase** (`price_increase`, 12) | A fixed-price charge whose latest amount is 5%+ and $1+ above the earlier median, over 4+ charges. Not a bill that moves every month | The rise times 12 | Up: 6+ charges at the old price. Down: 4 charges | soon | whoever is charged more | everyone with steady prices (all eight today) | `price_increase` (proved on made-up charges) |
| **Free trial that converted** (`trial_conversion`, 14) | A charge of $2 or less, then a $5+ charge from the same merchant after it | The new price times 12 | Up: several charges after the trial. Down: one | soon | whoever forgot a trial | none of the eight | `trial_conversion` (made-up charges) |
| **Charge after cancel** (`charge_after_cancel`, 13) | A charge from a merchant the person cancelled through Jane | The charge | Up: a cancel confirmed in Jane | now | on a cancel | all eight (none cancelled) | none: needs the cancel record, which the profile does not hold |
| **Covered by a card** (`covered_by_card`, 152) | A plan paid that a held card already covers | The plan's cost | Up: the card's benefit known | later | on a match | all eight | none: needs the card benefit catalog |

## Fees and bills (steps 21 to 40, 80)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Bank fees** (`bank_fees`, 25) | Two or more overdraft, insufficient-funds or ATM fees in the year | The fees, a year | Up: more fees, 12 months. Down: two | soon | R, D | H (written list) | `bank_fees` (money.ts) |
| **Late fees** | One late fee | The fees | Up: more than one | soon | D | R, H | `late_fees` (money.ts) |
| **Bill negotiation** (`bill_negotiation`, 33) | A regular internet or cable bill of $70+ a month, or a phone bill of $80+ | 12% of the yearly bills | Up: 12 payments seen. Down: a new bill | later | R (Xfinity), F, H, C, T, B | L ($70 phone is under the line), D | `bill_negotiation` |
| **Duplicate charge** (`duplicate_charge`, 24) | The same description and amount on the same account twice within 3 days | The duplicate | Up: exact match. Down: one pair | now | whoever was charged twice | none of the eight | `duplicate_charge` (made-up charges) |
| **Bills due** (`coming_up`, `bills_paid`) | A bill within days of due | Late fee avoided | n/a | the due date | all | none | none: lists what is due (exempt) |
| **Bill pay** (money moves, 132) | A bill the person set to pay | n/a | n/a | the due date | on request | n/a | none: an action |

## Cash, the forecast and safety (steps 41 to 60, 162, 195)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Safe to spend and the forecast** (`safe_to_spend`, `low_balance_risk`, 28) | Checking and savings hold less than one month of regular bills | The shortfall, or the overdraft fees already paid, if larger | Up: 12 months of bills seen. Down: few regular bills | soon | R, D | F, H, C, T, B (cash covers a month) | `low_balance` |
| **Emergency fund** (`safe_to_spend`) | Cash under 3 months of spending (6 if income is uneven) | The shortfall | Up: income pattern told. Down: guessed | soon | R, F, L, D, B | H, C, T (written list) | `emergency_fund` (money.ts) |
| **Idle cash** (`idle_cash`, 26, 162) | Cash beyond 6 months of spending, at least $10,000 over | The excess times the gap between a high-yield rate and checking's | Up: 12 months of accounts. Down: a few | later | H, C, T | R, D | `idle_cash` (money.ts) |
| **Steady pay** (240) | Uneven income and a low month 30% under the average | The gap between the average and the lowest month | Up: income pattern told | later | L | steady earners | `income_smoothing` (work.ts) |
| **Paycheck plan** (`payday`) | A paycheck landed | n/a | n/a | payday | all with a paycheck | none | none: an action on payday (exempt) |

## Budgets, spending, goals and what changed (steps 61 to 80, Phases AC and AK)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Budget overrun** (`spending`, `over_budget` alert) | A category's last full month is 40%+ and $150+ over its three-month average, outside housing, loans, insurance, childcare and transfers | The overrun that month | Up: 4 months in the category. Down: a category that moves a lot | later | whoever overspends | none of the eight (their months are steady) | `budget_overrun` (made-up charges) |
| **What changed** (`saved`, `changes`) | Spending that moved since last month | n/a | n/a | n/a | all | none | none: a report (exempt) |
| **Goals** (`goals`) | A goal the person set, and the pace needed | n/a | n/a | the goal's date | on request | n/a | none: goals live in the database, not the profile; the emergency fund detector suggests the first one |
| **Saved** (`saved`) | Savings Jane proved | n/a | n/a | n/a | n/a | n/a | none (reports, exempt) |
