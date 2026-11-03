# Which detectors fire on uploaded statements

Stage 1, item 6 of the controller roadmap. `src/accuracy/csv/detector-sweep.ts` runs every detector allowed on real accounts (68; the 59 advice topics stay blocked) over the CSV bench's 100 synthetic people, through the real upload path, with Claude off. Nobody real, and no database. To run it again:

```bash
DETECTOR_SWEEP=sweep.json npx vitest run src/accuracy/csv/detector-sweep.cli.test.ts
```

`src/accuracy/csv/detector-sweep.test.ts` fails if a detector that fires today stops firing.

**The bench can't settle everything.** It has 3 to 6 months of history, and no payday, student loan, collector, HSA, moving or tuition lines. So the ones marked "bench has no such line" were checked with one-off probes instead (realistic bank wording through the same path). Real statements haven't been run: that needs the beta.

## Fires on the bench (24)

| Detector | People of 100 | Note |
|---|---|---|
| cost:bill_negotiation | 83 |  |
| close:month_close | 73 |  |
| cost:duplicate_charge | 64 |  |
| subscriptions:subscriptions | 57 |  |
| cost:bank_fees | 56 |  |
| insurance:auto_insurance | 54 |  |
| safe_to_spend:emergency_fund | 54 |  |
| debt:card_interest | 44 |  |
| spending:budget_overrun | 39 |  |
| safe_to_spend:low_balance | 34 | Fires, then hidden: its button goes to a page the beta hides |
| life_event:life_checklist | 32 | Fires, then hidden: its button goes to a page the beta hides |
| investing:idle_cash | 31 |  |
| subscriptions:duplicate_subscription | 25 |  |
| subscriptions:trial_conversion | 25 |  |
| debt:rent_reporting | 24 |  |
| debt:medical_bills | 21 |  |
| debt:balance_transfer | 18 |  |
| subscriptions:price_increase | 18 |  |
| cost:late_fees | 15 |  |
| two:bill_split | 12 | Fires, then hidden: its button goes to a page the beta hides |
| debt:bnpl | 11 |  |
| taxes:vehicle_deduction | 10 | Fires, then hidden: its button goes to a page the beta hides |
| steady_pay:income_smoothing | 7 | Fires, then hidden: its button goes to a page the beta hides |
| debt:family_loans | 1 | Fires, then hidden: its button goes to a page the beta hides |

## Never fires on the bench, and why

| Detector | Class | Why |
|---|---|---|
| debt:bnpl | Had a bug, fixed | Reads `LOAN_PAYMENTS_BNPL` (`debt.ts:372`); rules file Affirm and Klarna as `LOAN_PAYMENTS_OTHER_PAYMENT` (`rules.ts:371`). 11 of 100 bench people have the lines. Now fires on the bench. |
| debt:car_addons | Had a bug, fixed | Refund is worked out from the line alone; the auto account is only a gate (`debt.ts:122`), and uploads never have one. |
| debt:debt_plan | Had a bug, fixed | `debt_trouble`'s payday route is unreachable on uploads (`build.ts:616`). The other two routes fire (card debt 3+ months of income; payments over 40% with cash spent). |
| debt:hardship_plan | Had a bug, fixed | Same cause as debt_plan. |
| debt:rent_increase | Had a bug, fixed | Rents are flat on the bench, and on top of that `RENT_NAME` drops rent lines the rules already filed as rent (`config/renting.ts:8`, `build.ts:513`). |
| debt:student_repayment | Had a bug, fixed | The figures use only payments and income; the student account is only a gate (`debt.ts:43`), and uploads never have one. |
| insurance:card_cover | Had a bug, fixed | Fires on `ANNUAL FEE`, not on `ANNUAL MEMBERSHIP FEE` (`insurance.ts:477`), the wording the rules (`rules.ts:110`) and the bench (`people.ts:2280`) use. |
| insurance:insurance_negotiation | Had a bug, fixed | Groups premiums by the raw description (`insurance.ts:359`), so ACH lines with a changing ID or date never add up to 3 charges. |
| price_rises:promo_ending | Had a bug, fixed | Bench history is too short to ever reach it; and with enough history, BofA ACH lines still don't group (`planning/price-rises.ts:65,80`). |
| steady_pay:income_smoothing | Had a bug, fixed | Gig pay with a pay word is filed as salary, so the pattern is never "uneven" (`rules.ts:198-202` beats `rules.ts:662-665`). Now fires on the bench. |
| taxes:hsa_over_limit | Had a bug, fixed | Its reader counts HSA deposits out of checking by name, but `has_hsa` is true only with an HSA account (`taxes.ts:900`, `build.ts:679`). |
| taxes:vehicle_deduction | Had a bug, fixed | Same cause as income_smoothing: 11 of the 15 gig people have 6+ gas lines. Hidden in the beta even when fixed: "Log your miles" goes to a hidden page. Now fires on the bench. |
| debt:cash_advance | Bench has no such line; fired on a probe | Fired on `CASH ADVANCE FEE`, `CASH ADVANCE INTEREST CHARGE`, `CASH ADV ATM`, on a card. |
| debt:credit_report_errors | Bench has no such line; fired on a probe | Fired on `PORTFOLIO RECOVERY ASSOC PMT` and `MIDLAND CREDIT MGMT`. |
| debt:high_cost_loans | Bench has no such line; fired on a probe | Fired on Advance America pairs, `SPEEDY CASH PMT` alone, Dave, EarnIn with the tip inside the repayment. Doesn't fire when tips can't be matched (see "Other things found"). |
| figures:figure_check | Bench has no such line; fired on a probe | Needs 24+ `INCOME_OTHER` deposits, which only the after-import step makes (the bench skips it) and the bench has no shop. With that step run on weekly cash, Square or Clover deposits: fires. |
| insurance:cover_change | Bench has no such line; fired on a probe | Fired on GEICO plus `U-HAUL MOVING & STORAGE`. |
| insurance:employer_benefits | Bench has no such line; fired on a probe | Fired on `NEW YORK LIFE INS PREM`, `BLUE CROSS BLUE SHIELD PREM`. Not on `OSCAR HEALTH INSURANCE`: the name list is short (`insurance.ts:513`), minor. |
| insurance:insurance_claim | Bench has no such line; fired on a probe | Fired on GEICO plus `CALIBER COLLISION` $2,600, and `MAACO AUTO BODY`. Hidden in the beta: "Start a claim" goes to a hidden page. |
| subscriptions:student_discounts | Bench has no such line; fired on a probe | Fired on tuition, campus bookstore and Spotify. |
| taxes:cash_flow | Bench has no such line; fired on a probe | Fired on Stripe plus `EFTPS PAYROLL TAX` or `FL DEPT OF REVENUE SALES TAX`. `TX COMPTROLLER SALES TAX` and `CA CDTFA EPMT SALES TAX` got no category with Claude off, so they didn't (Claude may place them live). |
| taxes:charity_receipts | Bench has no such line; fired on a probe | Fired on one `AMERICAN RED CROSS` $300. Bench gifts are all under the $250 line. |
| taxes:medical_deduction | Bench has no such line; fired on a probe | Fired on $30,000 of hospital bills. Bench medical lines are far too small. |
| taxes:ptc_repayment | Bench has no such line; fired on a probe | Fired on `HEALTHCARE.GOV PREMIUM` x10 with income rising. |
| books:data_problems | Needs what a statement can't give | Reads `extras.books` (`controller.ts:25`), from the daily books check. Automatic in the app and it covers CSV accounts (`planning/books.ts:233`); the bench gives no extras. |
| debt:auto_refinance | Needs what a statement can't give | Payment is on the statement, but the worth and the "on $X owed" line need the loan balance (`debt.ts:85-86,97`). Patched auto account: fires. Linking by Plaid only; I found no manual loan entry. Borderline: could fire with no dollar figure, a product call. |
| debt:cosign_risk | Needs what a statement can't give | `data.familyCredit`, told on /loans/helping, a page hidden in the beta (`hidden-pages.ts:46`), so not today. |
| debt:credit_building | Needs what a statement can't give | Card limit (`debt.ts:312`). Comes from Plaid's available balance, or a credit report only demo people get (`lib/credit.ts:19-29`). Link by Plaid only. |
| debt:family_credit | Needs what a statement can't give | Children show on a statement, the card limit doesn't (`family-credit.ts:20`). Same as credit_building. |
| debt:mortgage_extra | Needs what a statement can't give | Rate and balance (`debt.ts:219-221`), from Plaid Liabilities. Patched: fires. Link by Plaid only. |
| debt:student_forgiveness | Needs what a statement can't give | The worth is balance minus 120 payments (`debt.ts:474`), so it needs the loan balance. Patched: fires. Link by Plaid only. |
| insurance:deductible_met | Needs what a statement can't give | `data.healthPlan`, from a confirmed policy document (/insurance, available today). Also October onward only. |
| insurance:fsa_deadline | Needs what a statement can't give | `fsaElectionCents` (pay stub) and `healthPlan` (`health-year.ts:54-55`). Also the last 90 days of the year only. |
| insurance:medical_bill_dispute | Needs what a statement can't give | `data.healthPlan`, as deductible_met. |
| insurance:policy_documents | Needs what a statement can't give | `unreadPolicyDocuments`: an uploaded policy waiting to be confirmed. Available today. |
| investing:beneficiaries | Needs what a statement can't give | Needs a retirement account balance and `namedAccountIds` (bench gives none, the loader does). Positions upload on /import gives the account today. |
| investing:costly_products | Needs what a statement can't give | An `annuity` account (`holdings.ts:284`). Plaid only: not among the positions upload's types. |
| investing:invested_cash | Needs what a statement can't give | `data.holdings`. Positions upload on /import, available today. |
| investing:investment_fees | Needs what a statement can't give | `data.holdings`. Positions upload on /import, available today. |
| life_event:household_setup | Needs what a statement can't give | `extras.householdMembers` (`life.ts:104`); the loader always gives it, the bench never. With it, two payrolls fire. Hidden in the beta: /household is hidden and "Set up" isn't a look. |
| taxes:disaster_relief | Needs what a statement can't give | `extras.disasterRelief`, from a feed only demo-bank people have (`build.ts:144`), so never on a real account today. |
| taxes:draft_return_check | Needs what a statement can't give | `extras.draftReturn`, from a confirmed draft; /taxes/draft is hidden in the beta, so not today. |
| taxes:inherited_ira | Needs what a statement can't give | An account named as inherited, plus the year the owner died, told. The positions upload names accounts from the file; not probed. |
| taxes:irmaa_watch | Needs what a statement can't give | Pre-tax account balances and near-Medicare age or stage. Positions upload and a told age, today. |
| tradeoffs:goal_tradeoffs | Needs what a statement can't give | `extras.goals`, 2 or more. /goals is available today. Patched: fires. |
| taxes:file_return | Only at certain dates | Jan 15 to Apr 15 (`config/detectors.ts:202-203`). Fired at Feb 10, not at Oct 24. |
| taxes:identity_ip_pin | Only at certain dates | Jan 1 to Apr 15 (`config/detectors.ts:181-182`). Fired at Feb 10. Hidden in the beta even then: "Get your IP PIN" goes to a hidden page. |

## Bugs fixed (each has a test in `src/detectors/sweep-fixes.test.ts` or `src/detectors/debt.test.ts`)

- **Pay-later plans** read a category no rule gives: now also by the company.
- **Student loan payments** needed a linked loan: now the payments are enough, with wider servicer wordings.
- **Dealer add-ons** needed a linked car loan: a car payment on a statement counts. `GAP` alone no longer matches the clothes shop.
- **Payday and pay-app repayments** had no rule, so `debt_plan` and `hardship_plan`'s payday route was unreachable: rules added.
- **Rent** was dropped unless its name said RENT, APARTMENTS or PROPERT, though the rules had filed it as rent, and a Zelle the person said was rent. This also fed `housing` and `rent_reporting`: `rent_reporting` went from 12 to 24 people on the bench.
- **Gig pay** written `DIR DEP` read as a salary: the gig rule now comes first. `income_smoothing` and `vehicle_deduction` fire, then stay hidden in the beta (their buttons go to hidden pages).
- **Insurance premium rises** grouped by raw description, so ACH lines with changing IDs never reached 3 charges.
- **Premium cards** missed `ANNUAL MEMBERSHIP FEE`.
- **Promo endings**: ACH lines with changing IDs were each their own payee.
- **HSA over the limit** needed an HSA account, though its reader counts deposits from checking. `HSA` no longer matches inside other words.
- **Also found:** steady pay with no pay word read as a business, so `figure_check` called a salary "the shop's sales" at 95% sure. One payer, about the same each time, is now pay.

## Found, not fixed

- `debt_plan` and `hardship_plan` on the payments route can read "cost you $0.00" when no interest lines are seen.
- `EARNIN TIP` beside `EARNIN ACTIVEHOURS` doesn't match, and a monthly `BRIGIT MEMBERSHIP` isn't counted as a cost.
- Pay-app names are loose: `/earnin/` also matches EARNINGS, `empower` matches Empower Retirement.
- `debt:auto_refinance` could fire on the payment alone with no dollar figure. That's a product decision, so it's left as it is.
