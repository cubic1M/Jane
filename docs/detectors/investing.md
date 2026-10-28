# Investing detectors: inventory (step 262)

Until step 254's contract lands (docs/detectors.md) this is the inventory each investing
detector will be built from. For every capability: **signals** (what in the profile makes it
apply), **value** (dollars a year, or the risk avoided), **confidence** (what raises or
lowers the percentage; the reason string is built from the same facts), and **who**.
Sources of numbers are the existing loaders under `src/lib/investments/` and planners under
`src/planning/`; a detector calls them, it never recomputes.

Rules that hold for every detector here:

- **Real accounts get no advice.** Anything that is a recommendation (fund choice, mix,
  switching, where to put money) fires only when `adviceMode(userId)` is true (demo bank, or
  `DEMO_ADVICE=1`), labelled "Demo advice: sample data, not financial advice". For real
  accounts a detector may only report facts (a fee they pay, an unclaimed match, a missing
  form), never "buy/sell/switch".
- **Trial people** (`trial_` ids) are sample data: they see the suggestion in the app only,
  never email or a company contact.
- Confidence never describes markets. It means "how likely the fact is right for this
  person and the stated amount is worth it". Evidence tiers: **seen** (from linked
  accounts) > **told** (profile answer) > **guessed** (default). Start high only when the
  amount comes from seen balances; subtract for each guessed input (tax rate, return rate,
  fee table entry from a demo table); subtract when data is under 3 months old.
- Moving money, trading and selling are always a tap (except step 164's opt-in automatic
  investing within its caps). A detector's action is the same button the chat already shows.
- Dollars a year are comparable: fees and tax saved are real yearly dollars; "risk avoided"
  items (concentration, missing beneficiary) carry an explicit, labelled estimate, never a
  market prediction.

The eight people (step 252): **YR** young renter, first job · **FM** family with kids and a
mortgage · **FL** freelancer, uneven income · **HE** high earner with stock pay · **CR**
couple near retirement · **RT** retiree · **DT** someone in debt trouble · **SB**
small-business owner. None has an investing profile until built; "fires / not" below is the
written-list proposal for step 252 to adopt or change.

## Phase AA: the basics (steps 128–137)

| # | Capability (tool, page) | Signals | Value (a year) | Confidence | Fires | Not |
|---|---|---|---|---|---|---|
| 1 | **Costly funds** (`investment_fees`; /investments) | A held fund with a known expense ratio above its lower-cost equivalent in `LOWER_COST_EQUIVALENTS`; employer-plan holdings limited to the plan menu | Balance × (ratio − equivalent ratio) per fund, summed; compounding over 20 years shown separately, not in the headline | High (85–95) when ratio and balance are seen; −15 when the fund is only in the demo table; −10 when held in an employer plan (equivalent must be on the menu) | HE, CR, FM (401(k) target-date fund), RT | YR with only a money-market; DT (no investments) |
| 2 | **Investor profile** (`investor_profile`) | No finished profile (age, horizon, drop reaction, goals) | 0 (enabler: it unlocks 3–5). Surface as one question, not a dollar item | n/a (a question, not a claim) | Anyone with investments and no profile | Anyone with a finished one |
| 3 | **Mix vs target / portfolio review** (`portfolio_review`) | Finished profile; class shares off target by more than the tolerance in `src/config/investing.ts` | Risk, not dollars: share points off target; label it "risk avoided", no return claim | 80 when profile told and balances seen; −20 when profile answers are older than a year | CR (too much in stocks near retirement), RT, YR (all cash) | Anyone on target; people without a profile |
| 4 | **Concentration** (`portfolio_review`) | One holding above `CONCENTRATION_SHARE` of the portfolio; employer stock counts | Risk avoided: dollars above the cap; flagged as an estimate, not an expected loss | 90 (seen); the reason names the holding and share | HE (employer stock), SB (own-company stock if held) | Index-only portfolios |
| 5 | **One-tap rebalance** (`rebalance`) | Items 2 and 3 true; orders ≥ `MIN_ORDER_CENTS`; adviceMode | Taxes avoided by selling losers first (estimate) minus nothing; headline is risk, shown with realised gain | 75; −15 when a taxable sale realises a gain; −10 if cost basis missing | CR, FM | Anyone without orders; real accounts (no advice) |
| 6 | **Automatic investing, setup** (`auto_invest`; /investments/auto) | Regular paycheck seen; safe-to-spend comfortably positive; no active plan; profile finished | Dollars invested per year at a suggested share of pay; headline is "dollars moved to work", not return | 80 when pay pattern seen ≥ 3 paydays and safe-to-spend > buffer | YR, FM | FL (uneven pay: only "leftover" mode), DT, RT |
| 7 | **Tax-aware accounts** (`accounts_topic`) | Taxable account holding an interest-heavy fund (`interest: true`) while a tax-advantaged account has room | (yield × balance) × (marginal rate − qualified rate); needs the tax estimate | 70; −20 when marginal rate is a default | HE, CR | YR, DT (low bracket, nothing to shelter) |
| 8 | **Returns and drift** (`returns`, `steady_hand`) | Price feed available; a drop that scared the person; plan idle | Not a dollar item. Steady-hand is a calm message after a drop > threshold, only for someone with a profile | n/a | Anyone with investments after a drop | — |
| 9 | **Monthly investing note** | Money went in last month | None (a note); counts as the one proactive touch, not a suggestion | n/a | Anyone investing | — |

## Phase AE: money at work (steps 156–164)

| # | Capability | Signals | Value | Confidence | Fires | Not |
|---|---|---|---|---|---|---|
| 10 | **Tax-loss harvesting** (`tax_harvest` helpers `lotsFor`, `harvestChances`) | Taxable account lot with an unrealised loss ≥ minimum; a swap fund exists; not within 30 days of a purchase of the same fund (wash sale) | Loss × marginal rate (up to the $3,000 offset limit plus gains offset); needs tax estimate | 80; −25 if a wash-sale risk exists in another account; −15 on guessed rate | HE, FM (taxable brokerage with lots) | Retirement-only people (RT in IRA), YR |
| 11 | **HSA investing** (`hsa_invest`) | HSA balance above the cushion with no investments | Balance above cushion × assumed return difference is a prediction, so headline is **fee/tax-free growth room**: dollars movable; secondary "receipts kept" item | 85 on seen HSA balance | FM, HE | Anyone without an HSA |
| 12 | **Company stock plan** (`stock_plan`) | Stock plan account (RSU/ESPP vests, lots) with concentration; vest dates | Tax on the sell-down plan (short vs long term) and risk avoided; show tax in dollars, not a price view | 85 (vests seen); −20 if lot dates are told not seen | HE | everyone else |
| 13 | **Crypto read-only** (`crypto`) | A linked crypto connection | None; informational in net worth, never traded. Only a "concentration" facet if crypto is a large share | 90 | HE, YR | — |
| 14 | **Cash with a job** (`cash_jobs`) | Idle cash above the emergency target with no job; money market available | Idle balance × (money-market yield − savings yield) | 85; −15 when yields are demo constants | YR, FM, CR | DT (cash is needed), FL (variable income needs a larger fund: threshold rises) |
| 15 | **Emergency fund in reach** | Fund below target; investable cash elsewhere | Risk avoided (months of expenses missing), shown in months | 90 | DT, FL, YR | RT with a bond ladder |
| 16 | **Automatic investing, caps and log** (step 164) | Opt-in plan exists | None; this is a control, not a finding. Its detector is "log a reason when it acts" | n/a | people who opted in | everyone else. Never for real accounts while `REAL_ACCOUNT_ADVICE` is false (tested) |

## Phase AL: the whole picture (steps 210–216)

| # | Capability | Signals | Value | Confidence | Fires | Not |
|---|---|---|---|---|---|---|
| 17 | **Limits across accounts and the match** (`retirement_accounts`) | Employer match offered and contribution below it; IRA room unused | Missed match dollars a year (seen from payroll + the plan's match terms); IRA room × marginal rate as tax saved (estimate) | 90 for a match told by the plan menu/doc; 70 if match terms are told by the person | YR, FM, HE | RT (no earned income), DT |
| 18 | **Old accounts** (`old_accounts`) | A past employer's plan or IRA found; fees higher than the current plan; rollover allowed | Fee difference × balance (dollars a year); consolidation is a tap, a rollover is never a withdrawal | 85 for seen balances and fees; −20 if fee comes from the demo table | HE, FM, CR | YR |
| 19 | **College savings** (`college_plan`) | Children in the household (step 100/family), no 529 or low funding | Projected gap closed per year is a goal figure; headline: state tax deduction in dollars when the state has one (`stateRate`) | 75; −20 when college cost is an assumption | FM | Everyone without dependants |
| 20 | **Retirement income** (`retirement_income`) | Within 15 years of retirement or retired; accounts to draw from | Sustainable monthly income vs spending: gap in dollars a month (a plan, not a prediction; show assumptions) | 65 always capped, because it depends on market assumptions; the reason says so | CR, RT | YR, DT |
| 21 | **Rental property** (`rental_property`) | A rental income stream or property seen | Depreciation tax saved comes **only from step 173** (`rentalDepreciation`); this capability adds net cash flow and costs | 80 | FM, SB (if it owns property) | YR, DT |
| 22 | **The yearly review** (step 216) | Each year, once | A roll-up of items 1, 3, 10, 17; never a separate dollar claim | n/a | anyone with investments | — |

## Phase AO: round four (steps 231–236, in progress)

| # | Capability | Signals | Value | Confidence | Fires | Not |
|---|---|---|---|---|---|---|
| 23 | **Asset location** (`asset_location`) | A mix-neutral swap between accounts would put bond-like funds in tax-deferred and stock funds in taxable | `locationPlan` yearly tax saved | 70; −20 on guessed rates | HE, CR | YR, DT |
| 24 | **Workplace plan menu** (`plan_menu`) | A plan menu read and confirmed by the person; a cheaper mix exists in the same menu | Fee saved a year on the same target mix | 90 once confirmed, 40 before (so a detector only fires after confirmation) | FM, HE, YR | Plans with no menu read |
| 25 | **Honest performance** (`honest_performance`) | ≥ 1 year of seen holdings | None; honesty item. Fires only as an answer, never unasked | n/a | — | — |
| 26 | **Short-term money** (`short_term_money`) | A goal due within 3 years with money saved | After-tax gain over savings (`gainCents`), only when ≥ `MIN_GAIN_CENTS`; no ladder yet | 80 for a seen goal and balance; −15 for assumed state rate | FM (down payment), YR, CR | Goals past 3 years; goals with a ladder |
| 27 | **Sudden money** (`sudden_money`) | A deposit ≥ `SUDDEN_MIN_CENTS` that isn't pay | Tax set aside first (dollars), then the plan; the first message is a question (kind) with 90 confidence only once the person has said which | 95 that the deposit is large and unusual; the plan's tax figures 75 | HE (bonus), CR (home sale), RT (inheritance) | Regular pay, transfers |
| 28 | **Investing by your values** (step 236, paused) | A saved list of exclusions | Fee change in dollars, shown as a cost, not a saving; a detector would not push it unasked | n/a (a preference) | Only when the person has saved a list and holds funds that violate it | Everyone else |

## Gaps to settle in the contract (questions for step 254)

1. **Question vs finding.** Items 2, 6 and 27 begin as a question. Does the contract allow a
   detector to return `{ kind: "question" }` with no dollars, or must it wait for the
   answer? Proposal: allow it, ranked by the value of what the answer unlocks.
2. **Risk items** (3, 4, 15, 20) have no dollars a year. Proposal: they carry
   `riskAvoided: { amountCents, label }`, ranked with a fixed conversion factor from config,
   never mixed with real dollars in totals.
3. **Duplicates.** Items 1, 18, 24 (and 7) can describe the same fee. The scan needs a
   shared key per account so only the largest fires.
4. **Advice gating** belongs in the contract, not each detector: a flag
   `needsAdvice: true` that makes the harness skip real accounts, so the guardrail is tested
   once.

## Next

When step 254 merges: one detector module per row above under `src/lib/jane-agent/
detectors/investing/`, each wrapping the existing loader, each with a harness test against
the eight people's written lists (the rows' "Fires / Not" columns become that list).

## Built (src/detectors/investing.ts, step 262)

Six detectors on the registry's one `investing` capability, each proven on the eight people
(src/detectors/investing.test.ts and the step 254 harness): `employer_match` (Maya),
`catch_up` (Dan and Lena), `hsa` and `backdoor_roth` (Priya), `education_529` (the Reyes
family), `rmd` (Ruth). Already built by step 254 for the same capability: `concentration`,
`idle_cash`, `retirement_self_employed`. Rates are in `src/config/detectors.ts`. The
rest of the inventory (fees, rebalancing, harvesting, rollovers, location and so on) needs
holdings-level data that the profile input does not carry yet; those wait for the profile to
include holdings (a follow-up for step 253's loader).


## Accuracy bench (2026-10-28)

Each investing detector is scored on the eight sample people against a truth table written from
their lives, not from the detectors' output (`src/accuracy/investing/truth.ts`): who it should
reach (`yes`), who may or may not (`maybe`), and everyone else, who must not get it. Precision is
right fires over all fires that weren't "maybe"; recall is right fires over the people it should
reach. The gate (`src/accuracy/investing/investing-accuracy.test.ts`, with the unit tests) fails on
any false fire or missed person, and on an investing detector with no truth. The practice
portfolio's own ideas (`practice_*`) are the practice lane's and not scored here.

| Detector | Precision | Recall | False fires | Missed |
| --- | ---: | ---: | --- | --- |
| employer_match | 100% | 100% | – | – |
| catch_up | 100% | 100% | – | – |
| hsa | 100% | 100% | – | – |
| backdoor_roth | 100% | 100% | – | – |
| education_529 | 100% | 100% | – | – |
| rmd | 100% | 100% | – | – |
| investment_fees | 100% | 100% | – | – |
| rebalance | 100% | 100% | – | – |
| auto_invest | 100% | 100% | – | – |
| old_accounts | 100% | 100% | – | – |
| asset_location | 100% | 100% | – | – |
| costly_products | 100% | 100% | – | – |
| plan_menu | 100% | 100% | – | – |
| short_term_cash | 100% | 100% | – | – |
| sudden_money | 100% | 100% | – | – |
| values_funds | 100% | 100% | – | – |
| beneficiaries | 100% | 100% | – | – |
| invested_cash | 100% | 100% | – | – |
| concentration | 100% | 100% | – | – |
| retirement_self_employed | 100% | 100% | – | – |
| idle_cash | 100% | 100% | – | – |
| social_security_timing | 100% | 100% | – | – |

## Fund expense ratios from SEC filings (2026-10-28)

30 of the 36 real funds in `REAL_FUND_FACTS` take their expense ratio from the fund's own latest filing: the SEC "Mutual Fund Prospectus Risk/Return Summary" data sets (`NetExpensesOverAssets`, else `ExpensesOverAssets`, per share class, class found by ticker in `company_tickers_mf.json`), latest filing across 2025q4–2026q2. `asOf` is the filing date and `source` the filing's folder on sec.gov. The filing wins over the company's published figure (FCNTX is 0.74%, not 0.39%). SPY, IVV, SPXL, TQQQ, GLD and IBIT are not in the data sets (trusts and exchange-traded products with other fee tables): they stay "published" at lower confidence. Re-run by reading the data sets again each quarter.
