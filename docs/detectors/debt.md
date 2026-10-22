# Debt and credit: detector inventory (step 260)

For each debt and credit capability from Phases Y, AG and AN (and the two Phase AQ steps already
built): what it looks at (trigger signals), what it is worth (value formula), what raises or lowers
the confidence, how urgent it is, which of step 252's eight people it should and should not fire
for, and whether a detector for it exists yet (`src/detectors/debt.ts`, with the older ones in
`money.ts` and `home.ts`). It describes what the code in `src/lib/`, `src/planning/` and
`src/config/debt*.ts` already does, so a detector can stay a thin reader of the same signals.

Conventions:

- **Value** is dollars a year, or the dollars at risk. The rates and thresholds live in
  `src/config/detectors.ts` and `src/config/detectors-debt.ts`, never in a detector.
- **Confidence** is `confidenceOf` (src/profile/confidence.ts): a fact the person told is 100%; one
  Jane saw gains with months of data and clean matches; one she guessed is capped at 75%. A
  suggestion takes the weakest of the facts it rests on. Where approval or an outcome depends on
  something Jane cannot see (a lender's decision, a contract's terms), the detector adds a guessed
  piece so the percentage stays honest.
- **Urgency**: *now* when money is leaving at a punishing rate or a payment is late; *soon* when a
  cheaper option exists today; *later* when it is worth a look but nothing is lost this month.
- **Fires for / not for** uses the eight people: R Maya (young renter), F the Reyes family (mortgage
  with PMI), L Sam (freelancer), H Priya (high earner, stock pay), C Dan and Lena (near retirement),
  T Ruth (retiree), D Chris (debt trouble), B Jo (small-business owner).
- **Detector** says what exists: a topic from `SUGGESTION_TOPICS` that fires on the eight, a topic
  proven on made-up people only (the sample people carry no such signal), or why none can exist yet.

What the eight sample people carry (from `src/data-sources/demo/demo-people.ts`): R a $14,200 student
loan ($160 a month), a $1,940 card with $557 of interest and 3 overdrafts; F a $338,000 mortgage at
3.25% with PMI, a $21,400 car loan, a $3,120 card paid off monthly; L a card paid off monthly; H a
$910,000 mortgage at 6.9%, $106,000 in cash, a $3,400 card paid off; C a $61,500 mortgage at 3.5%,
$67,000 in cash; T a card paid off; D three cards with $10,090 and $2,856 of interest, a car loan
(16% of income), 12 cash-advance loan repayments, 6 overdrafts, 3 late fees; B a card with $6,900 and
an equipment loan.

## Seeing and ordering what you owe (steps 109, 110, 117, 230)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Every debt, one list** (109) | Any loan, card or pay-later plan with a balance; a debt with no rate | Not dollars: it is the base for the rest. A missing rate blocks the others | Up: rate from the bank (Liabilities). Down: typed or guessed rate | none | all with a debt | T with no debt | none (a view, not a suggestion) |
| **Payoff plan** (110) | Two or more cards with balances and interest charged; no plan started | The interest saved by the better order and extra payment (avalanche vs snowball, `payoffPlan`) | Up: 6+ interest charges seen, rates from the bank. Down: rates typed | soon when interest charged is rising | R, D | F, L, H, C, T (paid in full every month), B unless carrying a balance | `debt_plan` (D) |
| **Debt on autopilot, rate watch, due dates** (117) | A rate the bank changed; a payment due within 5 days before payday | The extra interest from the new rate; late fees avoided | Up: rate change seen in Liabilities. Down: variable-rate guess | now for a late payment, else later | R, D | those with fixed rates and no due date near payday | none (watches; reported through the other detectors) |
| **Yearly debt review** (230) | Once a year, and after a raise, a new loan or a missed payment | Not dollars: it gathers the items below | n/a | the review's own dates | all with a debt | none | none (the strategist, step 256, uses it) |

## Costly interest and fees (steps 113, 176, 177, 224, 247)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Card interest** (224) | `BANK_FEES_INTEREST_CHARGE` of at least $200 in the year | The interest charged, saved if the balance is paid off | Up: 6+ monthly charges. Down: 1 to 2 | soon | R, D | F, L, H, C, T, B (no interest) | `card_interest` |
| **Balance transfer** (113) | Card balance of at least $1,500 and at least $300 of interest in the year | Interest less the transfer fee (3% of the balance) | Up: 12 interest charges, balance from the bank. Down: approval is not certain, so capped at a guessed 75% when the person is in debt trouble | soon | R, D | F, L, H, C, T, B (pay in full) | `balance_transfer` |
| **Card cash advance** (247) | `BANK_FEES_CASH_ADVANCE`, or a "cash advance" payment on a card | The fee plus interest from day one (29.99% for about 30 days) | Up: several advances. Down: one | soon | anyone who takes one | none by default | `cash_advance` (made-up people only: none of the eight takes one) |
| **Payday loans and pay advance apps** (177, 247) | `LOAN_PAYMENTS_CASH_ADVANCES` or `_EWA` repayments | Fees are about a quarter of what is repaid | Up: 6+ repayments | now | D | everyone else | `high_cost_loans` |
| **Overdraft and late fees** (247) | `BANK_FEES_OVERDRAFT_FEES`, `_INSUFFICIENT_FUNDS`, `_LATE_FEES` | The fees paid | Up: more fees. Down: one | soon, now for late fees | R, D | H (must not: not a fee payer) | `bank_fees`, `late_fees` |
| **Buy now, pay later** (176) | `LOAN_PAYMENTS_BNPL` payments, stacking plans | Late-fee risk; not dollars | Up: several plans | later | few | all eight (none carry BNPL) | none (no sample signal; the forecast detectors in step 263 cover the cash it takes) |
| **Money is tight** (177) | The forecast dips under its cushion | Not dollars: the plan and the requests | Up: forecast of 30 days seen | now | D | those with a cushion | `hardship_plan` is the closest; the forecast itself is step 263 |
| **Hardship and too much debt** (229) | Debt payments at or above 40% of income, or debt trouble | The fees and interest that a plan could stop | Up: `debt_trouble` told | now | D | all others (must not for F, L, H, C, B) | `hardship_plan`, `debt_plan` |

## Loans you already have (steps 111, 112, 114, 115, 225, 226, 228, 245, 246)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Refinance** (111) | A mortgage rate at least 0.5 points above today's | Balance times the gap, a year, before closing costs | Up: rate from Liabilities. Down: rate typed | soon | H (6.9%) | F, C (below market), T, R, D, B | `refinance` |
| **Mortgage: PMI** (115, 228) | `has_pmi` true and a balance | About 0.5% of the loan a year | Up: lender's records. Down: guessed | soon | F | everyone else | `pmi_removal` |
| **Mortgage: extra money** (228, 246) | Mortgage rate at least 5% and at least $10,000 of cash beyond six months of spending | The excess times (mortgage rate minus the high-yield rate): paying down earns the rate for certain | Up: rate from Liabilities, 12 months of accounts. Down: rate typed | later | H | F, C (3.25% and 3.5%: cash earns more), R, L, T, D, B (no mortgage) | `mortgage_extra` |
| **Escrow check** (228) | A mortgage with an escrow balance and the person's tax and insurance bills | The surplus above a year of bills and the two-month cushion | Up: bills given by the person. Down: bills not given | soon after an analysis | F | none | none: needs the person's bills, which the profile does not hold (a question for step 257) |
| **Student loans: plan** (114) | Student loan payments of at least 3, balance, payment well above 7% of monthly income | (payment minus 7% of income) times 12 | Up: 12 payments, income from the profile. Down: income guessed | later | borrowers paying more than the estimate | R (her $160 is already under it), all others | `student_repayment` (proved on made-up people) |
| **Student loans: long game** (225) | PSLF employer certification, income-driven recertification dates | The tax on forgiven debt; payments counted | Up: dates told | the dates, from `src/lib/student-long-game.ts` | borrowers in public service | all eight | none: needs the person to say they work in public service |
| **Car loan: refinance** (111, 245) | Car payments 15% of income or more, a balance | Balance times 2 points | Up: 6+ payments seen. Down: rate unknown | later | D | F (4% of income), B | `auto_refinance` |
| **Car loan: dealer add-ons** (245) | A payment of $200 or more with GAP, warranty or service-contract words on an account with a car loan | The pro-rata refund less the cancellation fee (`refundFor`) | Capped at a guessed 75%: the words are a hint until the person says yes | soon | anyone with one | no car loan | `car_addons` (made-up people only) |
| **Recast vs refinance vs extra** (246) | A lump sum or extra monthly money and a mortgage | Interest saved, fees counted, against investing it | Up: rate and end date from the bank | later | H | as `mortgage_extra` | `mortgage_extra` (the detector offers the comparison) |
| **Family and friends** (226) | Payment-app transfers of $200 or more that a person later repays | The loan outstanding; not a saving | Capped at a guessed 75% until the person says it was a loan | later | few | all eight (none uses payment apps) | none: no sample signal |

## Credit score and borrowing (steps 116, 174, 175, 181, 227, 245 to 247)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for | Detector |
|---|---|---|---|---|---|---|---|
| **Credit score and utilisation** (116) | Card use above 30% of limits, or a score that moved 10 points | Not dollars: the rate bands the score unlocks | Up: a pulled score. Down: no limits in the profile | soon when card use is high | D (cards near their limits), R | T, C, H, F | none: the profile holds balances but not limits; needs `card_limit_cents` |
| **Build credit** (175) | A thin file, a statement closing within six days | Not dollars | Up: statement dates from Liabilities | soon | people starting out | H, C, T (must not `credit_building`) | none: needs the limits and account ages above |
| **Cards: rewards and fees** (174) | Card spending by category and a card with a fee | The rewards a better card would earn minus its fee | Up: 12 months of spending. Down: rewards guessed | later | F, H, B | D, R (must be fixing debt first) | none: needs the card's reward terms from the card catalog |
| **Credit report fixes** (181) | A collection or error on a pulled report | The debt disputed or the score points back | Up: report pulled | soon (the dispute clocks) | D | the others | none: needs a pulled report |
| **Credit score goal** (227) | The person asks | n/a | n/a | the date they set | on request | n/a | none (on request) |
| **Medical bills** (180) | Medical payments and statements | The reduction a request could get | Up: bills matched | soon | F, C, T | the others | none: needs a medical-bill signal the profile does not hold |
| **Buying a home or a car** (178, 179) | The person asks, or a saved goal | The affordability and the offers | n/a | on request | on request | n/a | none (on request) |
| **Out of costly borrowing** (247) | See "Costly interest and fees" | | | | | | `high_cost_loans`, `cash_advance`, `bank_fees` |

## Not built, deferred with Phase AQ

Rent reporting and deposit deadlines (248), helping family with credit (249), what you could borrow
(250) and credit autopilot round three (251) are not built; when they are, they add rows here.
