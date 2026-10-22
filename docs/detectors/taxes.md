# Taxes: detector inventory (step 261)

Input for step 254's contract and step 261's detectors. For each tax capability from Phases Z,
AF and AM: what it looks at (trigger signals), what it is worth (value formula), what raises or
lowers the confidence, how urgent it is (the deadline that drives it), and which of step 252's
eight people it should and should not fire for. Nothing here is new behaviour: it describes what
the code in `src/lib/tax-*.ts`, `src/planning/` and `src/config/tax*.ts` already does, so each
detector can be a thin reader of the same loaders.

Conventions used below:

- **Value** is dollars a year, or the dollars at risk. "Marginal rate" is the estimate's own
  (`estimateTaxes(...).marginalRate`, step 120), so every value moves with the person's bracket.
- **Confidence** starts from the evidence class (seen = from transactions, accounts, documents or
  the payroll stand-in; told = the person's own answer; guessed = inferred, such as a state from a
  bank's address), then moves with how much data there is and how clean the match is. Every
  percentage needs a one-line reason ("12 months of pay stubs, withholding seen"). Where a
  capability is demo advice only (`adviceMode`), a real account gets the facts and no dollar
  recommendation, so its detector reports value but marks it "advice withheld".
- **Urgency** comes from a date in config, never a guess: filing season (`FILING_SEASON`), the four
  estimated-payment dates (`ESTIMATED_TAX_DATES`), form-by dates (`TAX_FORMS`), the year end, the
  January IP PIN season, a notice's own due date, a county's appeal window
  (`src/config/property-tax.ts`). Days left → urgency high inside 30 days, medium inside 90, low
  otherwise, except the cases marked "now".
- **Fires for / not for** uses the eight people: R young renter, F family with mortgage,
  L freelancer, H high earner with stock pay, C couple near retirement, T retiree, D someone in
  debt trouble, B small-business owner. "Should not" means a suggestion would be wrong or tone
  deaf for that person, not merely absent.

The eight people's tax traits assumed here (to be matched against their written lists in step
252): R W-2 wages, single, rents, student loan, no dependants, no investments beyond a retirement
account; F married filing jointly, two children under 17, mortgage and property tax, childcare, a
529; L 1099 income with uneven months, home office, no withholding on it; H high W-2 pay plus RSU
or ESPP, a taxable brokerage, maybe crypto, high marginal rate; C 58 to 64, large traditional
401(k)/IRA, a few years from Social Security, mortgage nearly paid; T 70+, Social Security, a
pension, required withdrawals; D low or interrupted income, past-due debts, collections, maybe a
tax notice; B self-employed or a small company, rental or equipment, employees or contractors.

## The calendar spine (steps 123, 127, 223)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **January message** (127) | January 1 to Feb 15 and any tax-time data | Time saved, not dollars; carries the estimate and which forms are in | Up: pack has rows and forms received. Down: no forms yet | Fixed: Jan 1 to Feb 15 | all | none |
| **Tax calendar and estimated payments** (223) | `se.federal.needed` (owed after withholding at least `QUARTERLY.minOwedCents`) and a due date inside the pay window (5 days before to 30 after) | The payment itself; the penalty avoided is about the federal short-term rate on the shortfall for the days late | Up: income seen for 3+ quarters, withholding seen. Down: income started this year, no prior-year figure | Days to the due date: high inside 7 | L, B, H (RSU gap), C (large investment income) | R, F with full withholding, T whose pension withholding covers it, D |
| **Estimate** (120) | Any income in the year | n/a (the base for everything else) | Up: payroll stub seen (`pay.source` demo or pay_stub). Down: income from take-home pay only | none | all | none |

## Pay and withholding (steps 120 to 122)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Withholding checkup, W-4** (121) | `withholdingCheck.status` is `big_refund` or `bill_coming`, no W-4 sent this year, not "keep my refund" | Bill coming: the underpayment penalty plus the bill; big refund: the refund beyond a target, worth the interest on it and the paycheck cash flow (about `refund * savings rate`) | Up: pay stubs with withholding (`withholdingKnown`), 6+ paychecks. Down: pay frequency guessed, multiple jobs, income not steady | Paychecks left: the fewer, the larger each change (`thisYear` vs `fromJanuary`) | R (first W-4), F (two earners), H (RSU shortfall) | L, B (no paycheck), T (pension W-4P differs), D (a refund may be their cushion: tone) |
| **Ways to pay less** (122) | Each saving in `loadTaxSavings`: 401(k) room, HSA, IRA, FSA, education credit, etc.; demo advice | Contribution not yet made times marginal rate (plus state), capped by the limit left (`CONTRIBUTION_LIMITS`) | Up: employer plan seen, income seen over the credit phase-out. Down: contribution room guessed, eligibility told not seen | Year end (or April 15 for IRA/HSA); high from November | R (IRA/401k match), F (dependent care, 529), H (401k max, HSA), C (catch-up), L (SEP/solo 401k) | D (nothing to spare), T (no earned income for an IRA), B (only the self-employed ones) |
| **Refund tracker** (125) | A deposit in the IRS/state refund categories matched to the estimate year | The refund; value of a plan for it (goal and reminders) | Up: amount within the estimate. Down: unmatched deposit | None, the day it lands | all who file and have a refund | those with no refund |

## Freelance, business and side income (steps 123, 173)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Set aside from each payment** (123) | Freelance deposits (`INCOME_KINDS.self_employed`) in the last 60 days | The tax on that payment: the share from `setAsideRate` times the payment | Up: 6+ payments, rate from a full estimate. Down: one payment, rate defaulted | Each payment, then the quarter date | L, B | R, F, H, C, T, D unless a gig appears |
| **Business tags, home office, miles** (123, 119) | A business-looking purchase untagged; `homeOfficeSqFt` empty with 1099 income; miles empty | Deduction times (marginal + 15.3% SE portion). Home office: `homeOfficeDeduction`; miles: `mileageDeduction` | Up: purchase merchants match business categories. Down: told not seen | Year end, April 15 | L, B | R, F, H, C, T, D |
| **Rental and side income** (173) | Rent deposits, tagged rental expenses, or a rental on the profile; gig platform payouts | Depreciation (27.5 years, mid-month) plus expenses against rent; hobby vs business tax both ways (`sideIncomeBothWays`) | Up: rent seen monthly, placed-in-service date and price told. Down: price missing (no depreciation), platform payouts unmatched | Quarter dates (rent has no withholding), Jan 31 for 1099-K | B, L, C (a rental), H (maybe) | R, F, T, D |
| **Platform payouts vs 1099** (173) | A gig platform's deposits and its expected 1099-K | A mismatch's tax effect | Up: all payouts seen. Down: partial year | Jan 31 and Feb 15 | L | the rest |

## Documents, records, plan (steps 119, 166, 167, 171, 172)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Expected forms and tags** (119) | Payers and lenders in the accounts imply a W-2, 1099, 1098; untagged deductible-looking charges | Time, and missed deductions: tagged total times marginal rate | Up: merchant matches `ENERGY_PAYEE` etc. Down: ambiguous merchants (asks first) | Form-by dates in `TAX_FORMS` | all | none |
| **Tax forms collected and checked** (166) | Document partner has a form; forms differ from accounts by more than $1 or 1% | The difference's tax effect (a wrong W-2 or 1099 is an error avoided) | Up: matches. Down: flagged differs, unchecked | Jan 20 to Apr 15, daily | all with forms | those with no forms |
| **Tax plan** (167) | Each move in `TAX_PLAN` whose window is open: IRA, HSA, estimated payment, charity, FSA spend, etc. | Per move: contribution or action times marginal rate | Up: eligibility facts seen. Down: told | The move's own deadline | R, F, H, C, L | D, T (most) |
| **Audit-ready records** (171) | A deduction with a missing receipt (gift of $250 or more with no receipt); years past retention (3 years) | Risk avoided: the deduction at risk times marginal rate | Up: gifts over the receipt threshold seen, no receipt in the vault. Down: small items | The retention date; the receipt for a gift: before filing | F, H, L, B, C | R, D |
| **Last year's return read and reviewed** (172) | A return uploaded: findings vs accounts (itemized vs standard, student interest, education and care credits missed) | Missed credit or deduction times 1 (the whole amount), amended return if worth it | Up: figures read and confirmed by the person. Down: read low confidence fields | Three years from filing to amend (config) | R, F, L, D (credits missed), T | those without a return to upload |

## Giving, family, home (steps 168 to 170)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Giving: receipts, bunching, donor-advised fund, shares** (168) | Gifts in the year; itemizing within reach; appreciated shares in a taxable account | Each option's federal tax with vs without (engine), at least `GIVING.minSavingCents` | Up: 3+ gifts seen, itemized total near the standard deduction. Down: gifts told not seen | From `GIVING.from` to Dec 31, high in December | H (shares), F, C, T (a donor with a pension) | R, D, L (rarely itemizes) |
| **Family taxes** (169) | Children, care costs, 529, filing status | Care FSA vs credit, AOTC vs LLC, 529 state break, filing status: each as both sides' tax | Up: dependants told, care charges seen. Down: ages guessed | Open tax year; care FSA by the plan's election date | F, C (a college child) | R, L (no dependants), T, D (unless a child) |
| **Homeowner taxes** (170) | Mortgage and property tax payments; points; energy work; a sale | Mortgage interest and SALT: itemizing vs standard difference times marginal rate; energy credit amount; sale: exclusion vs gain | Up: 1098 collected. Down: lender's reported interest only | April 15; sale year | F, C, B (an owner) | R (renter), D, T with no mortgage |

## States, identity, notices (steps 165, 217, 218)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **State and local, moves and remote work** (165) | A state change in payee or pay pattern; employer in another state; a city with an income tax | The second state's tax or the credit avoided; the city tax | Up: moves told with a date. Down: spotted from agency payments only (asked first) | Filing season | H (remote), R (a move), F | T, D unless they moved |
| **Letters from the IRS and the state** (217) | An uploaded notice read and confirmed; kind from `NOTICE_KINDS` | The amount owed or proposed; a CP2000 dispute is the proposed change | Up: figures match forms and payments (check `agree`). Down: reading unconfirmed, no matching documents | The notice's own respond-by date (30 days for CP2000): high inside 14 | D (CP14/CP501 likely), L, B, H | R, T unless they have one |
| **Identity protection** (218) | January season without an IP PIN; a rejected e-file because a return exists; a form from an unknown payer; an ID-verify letter | Avoided loss: a stolen refund, the refund itself | Up: rejected e-file seen (high), unknown form (medium). Down: a bare question | January for the PIN (low); a sign: now | all for the PIN; the person with a sign | no one should be shamed; nobody is excluded, but T and C are the likeliest targets |

## Investments, equity, multi-year (steps 124, 219, 220)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Investment taxes: gains, wash sales, harvest, location** (124) | Taxable holdings with unrealised losses; wash-sale pairs within 30 days; income-heavy funds in a taxable account | Harvest: loss up to the year's gains plus $3,000, times marginal rate; location: tax drag difference | Up: cost basis present on every lot. Down: basis missing, recent buys that would wash | December 31, high from November | H, C, F with a brokerage | R, D, T (low basis needs), L (rare) |
| **Crypto and equity pay** (219) | Crypto sales and lots; RSU/ESPP/ISO events; RSU withholding below the real rate; ESPP sold early; ISO exercised | Set-aside: tax added by each part (engine delta), AMT; the RSU shortfall; ESPP ordinary income lost | Up: exchange read-only and 1099-DA matches, events told with dates and prices. Down: stock plan events missing (Jane cannot see vests without them) | The quarter dates (no withholding) and year end | H | R, F, L, C (unless they hold company stock), T, D |
| **Multi-year moves** (220) | Retirement balance in 401(k)/IRA, gains unrealised, planned events; years with room in the 12% bracket or 0% gains bracket | The move's tax saved over the horizon (`findMoves.effectCents`) | Up: balances seen, retirement year told. Down: retirement year assumed, brackets indexed by assumption (always partly assumption: cap near 70%) | A move's year: December 1 of it | C (Roth conversions, gains before retirement), H (timing a sale), T (low-income years) | R, D, L (income too irregular to project) |

## Property, accountant (steps 221, 222)

| Capability | Trigger signals | Value | Confidence up / down | Urgency | Fires for | Should not fire for |
|---|---|---|---|---|---|---|
| **Property tax too high** (221) | Assessed value at least 7% over market and a saving of $150 or more; window not closed; 3 comparable sales | The gap times the tax rate (measured from the bill, else the state's typical rate) | Up: the person's own values, county notice date told. Down: stand-in or typical values, rate from the state table | The county window close (`appealWindow`), high inside 30 days | F, C, T, B (an owner) | R, D (no home) |
| **Exemptions not yet claimed** (221) | Owner; homestead (any owner), senior, veteran, disabled per `EXEMPTIONS[state]` and the facts told | The exemption's benefit (stated in words, state-specific; not always dollars) | Up: eligibility facts told. Down: age or service unknown (asks for it) | The county's filing date | T, C (senior at 65), F (homestead) | R, H (income limits), D (no home) |
| **Working with an accountant** (222) | Two or more of: self-employment, rental, equity or crypto, more than one state, a home sale, an open letter, an identity problem, large gains | Not dollars: risk avoided, time saved; stated as facts ("people with that mix usually use one") | Up: factors seen (not told). Down: one factor | Filing season and the notice date | B, L (with a rental), H, T (large RMD plus a rental) | R, F (plain W-2), D unless a notice |

## What can be proved on the eight people (for the harness)

These are the lists to check each detector against; they should be moved into step 252's written
lists. A cell is "fires" if the detector should surface in a normal year for that person, "no" if it
should not, "maybe" if it depends on a fact only told.

| Capability | R | F | L | H | C | T | D | B |
|---|---|---|---|---|---|---|---|---|
| January message | fires | fires | fires | fires | fires | fires | fires | fires |
| Estimated payments | no | no | fires | fires | maybe | no | no | fires |
| Withholding checkup | fires | fires | no | fires | maybe | maybe | no | no |
| Ways to pay less | fires | fires | fires | fires | fires | no | no | fires |
| Set aside / business tags | no | no | fires | no | no | no | no | fires |
| Rental and side income | no | no | maybe | maybe | maybe | no | no | fires |
| Forms collected and checked | fires | fires | fires | fires | fires | fires | fires | fires |
| Tax plan | fires | fires | fires | fires | fires | maybe | no | fires |
| Audit-ready records | no | fires | fires | fires | fires | maybe | no | fires |
| Last year's return reviewed | fires | fires | fires | maybe | maybe | fires | fires | fires |
| Giving | no | fires | no | fires | fires | fires | no | maybe |
| Family taxes | no | fires | no | no | maybe | no | maybe | no |
| Homeowner taxes | no | fires | no | maybe | fires | maybe | no | maybe |
| State and local | maybe | maybe | no | maybe | no | no | no | maybe |
| Notices | no | no | maybe | maybe | no | maybe | fires | maybe |
| Identity protection | fires | fires | fires | fires | fires | fires | fires | fires |
| Investment taxes | no | maybe | no | fires | fires | maybe | no | maybe |
| Crypto and equity | no | no | maybe | fires | no | no | no | no |
| Multi-year moves | no | no | no | maybe | fires | fires | no | no |
| Property tax | no | fires | no | maybe | fires | fires | no | maybe |
| Exemptions | no | fires | no | no | maybe | fires | no | maybe |
| Accountant | no | no | maybe | fires | maybe | maybe | maybe | fires |

Rules that must hold for every person, regardless of the table:

- Never recommend a contribution, a harvest or a conversion to someone (D) whose cash is short.
- An expired deadline never ranks: `window.status === "closed"`, a payment past its 30-day grace,
  a notice past due is shown as "late, here is what to do now", not as an opportunity.
- A real account (no demo advice) gets facts, not recommendations: the detector returns the value
  with `advice withheld` and no button that needs advice.
- Nothing is paid, sent, signed or filed by a detector: the action is always the person's tap,
  except the actions the autopilot sector caps allow (reminders at "Handle the safe stuff", and
  estimated payments within the taxes caps, step 223).

## Ranking inputs the detectors can supply (steps 254, 255)

- **dollars**: the value column.
- **confidence**: from the evidence, as above; the same evidence always gives the same number.
- **urgency**: from the deadline, as above.
- **why you**: one line from the person's own figures ("your withholding is $1,840 short of your
  estimate; with 9 paychecks left, $204 more each fixes it").
- **action**: the existing chat action ids (`tax.*`), already registered in
  `src/lib/jane-agent/actions/index.ts`, and the page link.

## Gaps (no capability exists, so no detector, and no new features this phase)

Things the people above would expect that Jane's tax side does not do: required minimum
distributions and qualified charity distributions for T; Medicare premium surcharges; Social
Security benefit taxation timing for C and T; payroll tax filings and S-corporation salary for
B; the earned income credit as a prompt for D (the engine computes it, but nothing brings it up on
its own); a student loan interest deduction prompt for R. Each is worth noting for the people
checks in step 252, but none is a detector to build in this phase.

## What step 261 built, and what it could not

Detectors are pure over a person's profile and rows (`ProfileInput`: transactions, accounts,
liabilities, what they told Jane), so a capability gets a detector only where those rows show
the signal. In `src/detectors/taxes.ts`, all under the `taxes` capability:

| Topic | From the inventory | Fires for (sample people) | Value | Urgency |
|---|---|---|---|---|
| `withholding_gap` | Crypto and equity pay (219): RSU flat withholding | H | vested stock × (marginal rate − 22%) | soon from October |
| `roth_conversion` | Multi-year moves (220) | C, T | 10% of pre-tax balance × (22% − 12%) | soon from November |
| `childcare_tax_break` | Family taxes (169), ways to pay less (122) | F | FSA at marginal + payroll tax, less the credit | later |
| `identity_ip_pin` | Identity protection (218) | everyone paid, January 1 to April 15 only | the average refund a thief takes | soon |
| `year_end_moves` | Tax calendar (223) and tax plan (167): the December message | R, F, H, C with a workplace plan, from November 15 only | unused 401(k) room (assumed a quarter of the limit) × marginal rate; confidence capped at 50% | soon, now from December 10 |
| `estimated_taxes` (already in `work.ts`) | Estimated payments (223) | L, B | penalty on unpaid tax | now within 14 days of a quarter date, soon within 45, else later |

The date is `profile.today`, so the harness and tests set it; nothing reads a clock. Every
percentage is the weakest of the facts and counts behind it, and where a figure rests on an
assumption (no vest schedule, future income) the percentage is capped for it and the reason says
so. Rates are in `DETECTOR_RATES.tax`; the dated brackets, limits and payroll tax come from
`src/config/tax-rates.ts`.

**Added later in step 261** (also in `src/detectors/taxes.ts`): `charity_receipts` (gifts of $250 or
more need the charity's receipt; covers giving, records and tags), `property_tax_check` (property
tax paid, with the 7% appeal gap as the stake; covers property and home), `tax_loss_harvest` (a
taxable account below cost; covers investments, and `ProfileInput` now carries `holdings` with
cost basis) and `file_return` (January 15 to April 15; covers return and forms). The sample
people got the rows they need in `people-extras/taxes.ts`: property tax for the family, Priya,
Dan and Lena and Ruth, a gift each for those four, and a bond fund bought above today's price in
Priya's brokerage.

**Tools with no detector, and why** (`TOOL_EXEMPT` in `src/config/detector-exempt.ts`): the tax
profile (shows and sets answers), refunds (the plan arrives when a deposit lands), states (needs
the person to say they moved), the last return and notices (react to an upload) and the accountant
(a link is a credential, so Jane never makes one by herself).

**Seasonal detectors never fire on the sample date** (October 17): `identity_ip_pin` and
`file_return` run in January to April, `year_end_moves` from November 15. The tests set the date
to prove them.

The tax calendar (223) is covered by the detectors for its dated tasks: `identity_ip_pin` (January)
and `estimated_taxes` (each quarter), both urgent as their date nears. Its December year-end
message is covered by `year_end_moves` for the one move a profile can show (a workplace plan's
room); the losses to harvest and gifts in the same message need rows the sample people lack (above). The accountant link (222) shares what the others find, so it
takes no detector of its own; the accountant's "people usually bring one" message is derived from the factors the other detectors
already see, and has no dollar value.

## Phase AT (round four)

### Step 267: business owners' tax structure

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `s_corp_election` (covers `tax_business`) | self-paid; profit (deposits × 85% for a freelancer, × 15% for a shop) where an S corporation saves at least $1,000 after $2,700 of payroll and filing costs, from the same estimate engine | tax as a sole proprietor less tax as an S corporation (salary at the middle of 40% to 60% of profit, both halves of payroll tax, the 20% deduction on what's left, the costs) | income pattern and income as seen; capped at 55% for a shop (deposits are sales) and 65% for a freelancer (costs assumed) | soon from January 1 to March 15 (Form 2553), else later | Jo | Sam (profit too small), anyone with a salary and no business |
| `home_office_deduction` | self-paid, no commercial or studio rent, so working from home is likely | 150 sq ft × $5, at their bracket plus the 15.3% on 92.35% self-employment tax | capped at 55%: where they work and whether it is on file are unseen | later | Sam | Jo (rents a shop), employees |
| `vehicle_deduction` | self-paid and buying gas regularly (6+ fills) | 4,000 miles × the standard rate, at their bracket plus self-employment tax | capped at 45%: how much driving is for the business is unseen | later | Sam, Jo | people with no fuel purchases, employees |

Where a person also has a job, the Social Security tax is already paid on that salary, which shrinks
what an S corporation can save; the chat answer and tool use the full estimate (so they see it), the
detector only reaches people whose pay is all self-employment. The qualified business income
deduction is worked out in the same place (`structureFor`) and shown in the chat answer, the tool
and `/taxes/business`; it is not a separate suggestion because the return already takes it.

### Step 268: inherited money and gifts

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `inherited_ira` (covers `tax_inherited`) | an investment account whose name says "Inherited" or "Beneficiary" (custodians' wording); not from a spouse (told) | taking it out evenly over the years left against all at the end (same engine as step 120), or, in the last year, the 25% penalty on what's left | income as seen; capped at 50% when the year the owner died is unknown (full 10 years assumed), 70% when told (required yearly withdrawals and other income unseen) | later; soon at 3 years left, now at the last year | Dan and Lena (an IRA from Lena's mother) | everyone else; a spouse's IRA |

Gifts over the annual exclusion ($19,000 a person) are a heads-up from the transactions (a message
with no dollars: no tax is usually owed, the excess counts against a lifetime allowance), not a
detector suggestion; the tool is covered by `inherited_ira`. An inherited IRA is never counted as
money to convert to a Roth. Rules, limits and states with their own death taxes are in
`src/config/inheritance.ts` with sources; the chat gives facts and points to a tax professional or
estate lawyer.

### Step 269: health cover and taxes

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `ptc_repayment` (covers `tax_health`) | 3+ Marketplace premiums this year (payee names in `src/config/health-taxes.ts`); income read month by month (profit for the self-employed), projected at the pace of the last 3 months | the advance credit that would come back with the return: the advance (told, or what the income of the year's first 3 months allowed) less the credit at the projected income; all of it over 400% of the poverty line; no cap from 2026 | income pattern and income as seen; 50% when the advance is worked out, 75% when told | later; soon from July; now from October | Sam (a retainer client since July puts him over 400%) | anyone without a Marketplace plan; steady income |
| `hsa_over_limit` (covers `tax_health`) | has an HSA; deposits into it this year (or out to one by name when none is linked), projected to December | the 6% excise a year on what's over (the tax on it isn't avoidable, so not counted) | the HSA fact; deposits seen; capped at 70% (cover taken from the household, an employer's deposits unseen) | now when already over, soon when the pace will be | Priya ($500 a month against the $4,400 self-only limit) | no HSA; under the limit; the catch-up from 55 counted |
| `medical_deduction` (covers `tax_health`) | medical payments this year (not the vet) and health premiums (Medicare, supplement, drug plan, Marketplace) | what itemizing with the medical costs over 7.5% of income saves against the standard deduction (with the 65+ addition) at the person's bracket; property tax and gifts counted with it | income as seen; payments seen; capped at 60% (insurance may still pay some, income estimated) | later; soon from November | Ruth (dental implants and hearing aids this year) | anyone whose costs stay under the floor or whose standard deduction is still bigger |

The three share one reading (`src/planning/health-taxes-read.ts`), used by the detectors, the chat's
messages and answer, the `tax_health` tool and `/taxes/health`, so the figures match. The
Marketplace figures (poverty line, the 2026 applicable percentage table, the 400% line, the end of
the repayment cap) are in `src/config/health-taxes.ts` with sources; the HSA limits, the 7.5% floor
and the 65+ standard deduction are in `src/config/tax-rates.ts`. Telling the Marketplace or an HSA
provider is the person's: Jane contacts no one. What to do about the credit is demo advice.

### Step 270: disasters and losses

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `disaster_relief` (covers `tax_disaster`) | the county (told, or named by the property tax payee) covered by a declaration in the person's disaster feed (the stand-in's samples for demo-bank people, none for real accounts) whose postponed date is ahead | the casualty loss over the floors at the person's bracket: repairs since the incident less FEMA or insurance paid back, less $100 and 10% of income (a qualified disaster: $500, no 10%); 0 when the floors swallow it | the county fact; capped at 70% (county matched by name, state unknown) and 55% when there is a loss (itemizing and what insurance still pays unseen) | now when a moved federal date is within 45 days, else soon | the Reyes family (Harris County flood: $36,200 of repairs, $5,000 from FEMA) | anyone without a feed or a county; a county no declaration covers |

A postponement moves every tax deadline on the person's list from the incident date up to the
postponed date (titles about taxes, IRS forms, estimated payments, IRA or HSA contributions, the IP
PIN), not done ones or other deadlines: by itself at the levels that let Jane act (the tax autopilot),
on the "Move my tax deadlines" tap at "ask first", once per disaster. The dates Jane works out
(estimated payments, filing day with the prior year's IRA and HSA contributions) are shown moved.
The loss is recorded once per disaster and insurance claim (`DisasterLoss`, unique key), so it is
never counted twice. Rules and the sample feed are in `src/config/disasters.ts` with sources; swap
the stand-in (`src/lib/disaster-feed`) for the IRS disaster relief page and FEMA's OpenFEMA API.

### Step 271: taxes on retirement income

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `social_security_tax` (covers `tax_retirement`) | 3+ Social Security deposits in the last year; the taxable part (Publication 915's 50% and 85% lines) over the floor | the tax on the taxable part at the person's bracket, which nothing withholds without Form W-4V (risk) | deposits seen; capped at 55% (withholding unseen) | later; soon from October | Ruth ($13,136 of her $32,160 is taxable; her next IRA dollar is taxed at about 22%, not 12%) | anyone without Social Security |
| `irmaa_watch` (covers `tax_retirement`) | near Medicare (told 63+, or near or in retirement), $100,000+ pre-tax, and the room under the next surcharge line (income of this year sets premiums two years ahead) under a fifth of the pre-tax savings, or already over a line | what crossing the next line adds a year to Part B and D for the household (risk) | income as seen; 50% without the age (Medicare then unknown), 70% with it | later; soon from October | Dan and Lena ($76,120 under the 2028 couple's line, with $575,513 pre-tax) | the young, the small savers, anyone with plenty of room |

The Roth conversion detector now uses the real rate on a converted dollar for someone on Social
Security (the bracket plus up to 85 cents more of benefits taxed): at Ruth's income that's about 22%,
so a conversion saves nothing and is no longer raised. Surcharge lines and amounts are by year in
`src/config/retirement-taxes.ts` (2025 and 2026 published; later years grown 2.5% a year and marked
estimated). The order to draw from step 212 is tuned here (taxable first, pre-tax only as far as
the room under the line allows, then Roth) and handed to the investing side's retirement paycheck
(`RetirementIncomeView.taxTuned`, shown on `/investments/retirement-income` in demo advice mode).

### Step 272: the return, checked before you file

| Topic | Trigger signals | Value | Confidence drivers | Urgency | Fires for | Should not |
|---|---|---|---|---|---|---|
| `draft_return_check` (covers `tax_draft_check`) | a confirmed draft return (uploaded to Documents as "Draft tax return", read, and confirmed by the person) whose check found something | the federal tax the findings change, added up: a bill to avoid (risk) when any line owes, else money back (saves) | 80%: the person confirmed what Jane read, and each line is checked against their collected forms, accounts and estimate | now (before filing) | anyone with a checked draft that has findings; in the samples, a demo draft (tests) | anyone without a confirmed draft, or whose draft checks out |

The check, line by line (`src/planning/draft-return.ts`): income missing (interest, dividends, capital
gains, business income, wages under the W-2s), figures that don't match the forms (withholding),
deductions or credits left out (student loan interest, itemizing, education and care credits, the
same checks as step 172) and estimated payments left off, each with its line and the tax it changes
(nothing under $25). The demo draft (the stand-in reader for demo-bank people without a key) is
built from the person's own forms with three mistakes planted, and the check finds all three. Jane
never files or changes a draft: the cards point to the software or the preparer. The detector is
seasonal by nature (drafts come in filing season), so the eight samples at their October date carry
none; the tests attach a checked draft.
