# Insurance detectors: the inventory (step 259)

The working notes for step 259 ("Insurance, proactive"): every insurance capability from
Phases X, AD and AJ, with what makes it apply, what it is worth, what changes how sure Jane
is, and which of the eight sample people (step 252) it should and should not reach. The
detector contract itself comes from step 254 (`docs/detectors.md`); this file fills it in
for insurance. Each entry maps one to one onto the contract's fields:

| Contract field | In this file |
| --- | --- |
| applies | **Fires when** |
| value (dollars a year, or the risk avoided) | **Worth** |
| confidence % and its reason | **Confidence** |
| urgency | **Urgency** |
| why this person | **Why you** |
| action and button | **Action** |

Rules that hold for every insurance detector:

- **Demo advice only.** What to buy, change or switch to is advice, so it is produced only
  when `adviceMode(userId)` is true (every account is the demo bank), is labelled "Demo advice:
  sample data, not financial advice", and is checked with the `demo_advice` guardrail profile.
  Real accounts get the facts (what a policy covers, when it renews, a deadline, what the
  insurer would pay), never a recommendation. The "applies" test for an advice detector
  therefore includes advice mode; the facts-only detectors do not.
- **Nothing changes price or cover without the person's tap** below "Everything allowed",
  and a higher deductible, a safe-driver program or any change of cover is never done on
  autopilot at any level (`KEEP_COVERED_SAVING_KINDS`, `NEVER_BY_RULE`).
- **Stand-in partner.** Quotes, binds, endorsements, renewal calls and claims go to the
  stand-in partner (`partnerFor`), which exists only for demo-bank people. A detector that
  needs a quote says so in its confidence: a sample price is "told by the stand-in", not seen.
- **Trial people** (ids starting `trial_`) are sample data: never emailed, never contact a
  company, never counted in metrics.
- **Money and dates.** Dollars are integer cents; a yearly figure is `premiumCents ×
  PREMIUM_FREQUENCIES[frequency].perYear` (`yearlyPremium`).

## How confidence should be worked out

Step 254 requires a percentage worked out from the evidence, never made up, with its reason.
For insurance the evidence comes in four kinds. Each detector below lists its own, but they
combine the same way:

1. **How the policy is known.** Typed or confirmed from a document (`source: typed|document`)
   is the strongest. Found from payments only (`status: found`) is weaker: the premium is
   seen, the cover is not. From the stand-in demo policy (`source: demo`) it is exact for the
   demo bank. Not known at all lowers a detector that needs it to nothing.
2. **How long the signal has been seen.** A premium seen in 12 months of charges beats one
   charge. A signal seen once (one Uber payout) is a question, not a conclusion, which is why
   step 197 asks first.
3. **How clean the match is.** A merchant pattern with a category match beats a keyword.
   An exact deductible from a document beats a default (`DEMO_PRICING.defaultDeductibleCents`).
4. **Facts seen, told or guessed.** Told by the person (household facts typed on /insurance,
   a yes to a risk question) outranks seen in transactions, which outranks guessed from a
   default (`HEALTH_DEFAULT_SPEND_CENTS`, the 4% car-insurance rule of thumb).

A price from the stand-in partner never raises confidence above what the person's own policy
record supports: the saving is "up to", from a sample quote.

## The eight people, and the shorthand used below

| | Person | Insurance picture (what the written list should assume) |
| --- | --- | --- |
| YR | Young renter, first job | Rents, one car or none, employer health plan just started, no dependants, little savings. |
| FM | Family with kids and a mortgage | Owns a home with escrow, two cars, a teen driver, dependants, spouse with their own employer plan. |
| FL | Freelancer, uneven income | Contract income, no employer, marketplace health plan, home office, equipment, business miles. |
| HE | High earner with stock pay | Large paycheck, RSUs/ESPP, high assets, employer benefits, good savings. |
| CR | Couple near retirement | Home owned (paid down), two cars, large assets, health through work until Medicare, no dependants. |
| RT | Retiree | Home owned, one car, fixed income, Medicare, little or no earned income, no life need. |
| DT | Someone in debt trouble | Tight cash, card balances, minimum payments, a car loan, thin savings. |
| BO | Small-business owner | Sells through Shopify/Square or has a storefront, vehicle used for work, equipment and stock, employees maybe. |

"Fires" below means the detector should produce a suggestion for that person on their
written list. "Must not" means a suggestion would be wrong for them (and is part of the
person's "what she must not" list).

## What is built so far

`src/detectors/insurance.ts` (capability `insurance`) holds the detectors that can be judged
from the profile alone (steps 252–254: charges seen, accounts, the facts), proven on the
eight people by `src/detectors/insurance.test.ts` and the harness:

| Topic | Inventory entry | Reaches | Worth |
| --- | --- | --- | --- |
| `renters_insurance` | X1 (`renters`) | renters with no cover charge | contents at risk |
| `auto_insurance` | X1 (`auto`) | a car and no car-cover charge, and no car loan | liability at risk |
| `umbrella` | X1 (`umbrella`) | assets over $500,000 | assets at risk |
| `insurance_shopping` | X3, AJ1 | six or more car/home charges over $1,000 a year | up to a tenth of the premium |
| `health_insurance` | AD1 | the self-paid: compare plans, or get one | up to a tenth of the premium, or a hospital stay |
| `medigap` | AD1 (Medicare) | retired, with a supplement | up to the compare share of the premium |
| `long_term_care` | X1 (older life stages) | approaching retirement with enough saved | two years of care |
| `insurance_negotiation` | AD7 (renewals) | a car or home premium whose last charge rose 5% or more | the monthly rise × 12 |
| `insurance_claim` | X6, AJ4 | a repair of $1,000+ in 90 days, insured, no claim payout seen | the repair less a $1,000 deductible |
| `cover_change` | AD6 | a move or car purchase in 60 days, with cover charges | contents at risk |
| `card_cover` | AD4 | a protection plan plus a premium-card fee | the plan's yearly cost |
| `employer_benefits` | AD2 | salary, an employer, and private life or health charges | half the private premium |
| `policy_documents` | AD3 | an uploaded policy document waiting to be confirmed | up to a tenth of insurance charges |
| `life_insurance`, `business_insurance` | X1, AJ6 | already in `home.ts` and `work.ts` | as there |

Every insurance tool in the registry now has a detector (none are left on
`src/detectors/missing.ts`). The finer checks inside them (reshop of a known policy,
household, business gaps, health year, the yearly review) need the policies themselves,
which the profile does not carry; they keep running from the insurance lane's snapshot.
The profile input gained `unreadPolicyDocuments` (policy readings waiting for a confirm) for
`policy_documents`.

---

# Phase X: insurance basics (steps 102–108)

## X1. Coverage gaps by rules (steps 102, 149, 197, 198, 201)

- **Source:** `src/lib/insurance/gaps.ts` (`coverageGaps`), `risk-signals.ts`, `family-rules.ts`,
  `business-rules.ts`. One detector per `GapKey`; the keys are the units below.
- **Fires when (per key):**
  - `renters`: housing is rent (typed, or rent seen in `RENT_LOOKBACK_DAYS`) and no active
    renters or home policy.
  - `home`: housing is own (typed, mortgage account or owned home) and no active home policy.
  - `auto`: vehicles > 0 (typed, or an auto loan / owned vehicle) and no auto policy.
  - `life`: dependants > 0 and no life policy (shown to advice mode).
  - `liability_only`: an auto policy with no collision or comprehensive.
  - `health`: medical spending seen (`signals.medicalCents !== null`) and no health policy.
  - `disability`: a paycheck in the last `INCOME_LOOKBACK_DAYS` (45) and no disability policy.
  - `umbrella`: assets (balances plus owned things) over `UMBRELLA_ASSETS_CENTS` ($500,000)
    and no umbrella.
  - `pet`: pets > 0 (typed) and no pet policy.
  - `travel`: flights and hotels over `TRAVEL_GAP_MIN_CENTS` ($1,000) in the last
    `TRAVEL_LOOKBACK_DAYS` (60) and no travel policy.
  - `rideshare`, `home_business`, `valuables`, `boat`, `short_term_rental`: the person said yes
    to the matching risk question (see AJ2).
  - `teen_driver`, `spouse_health`, `family_health_plan`: see AJ3.
  - `business_liability`, `professional_liability`, `car_business_use`, `business_equipment`:
    see AJ6.
  - A gap the person dismissed (`dismissedGaps`) never fires again.
- **Worth:** a risk avoided, not dollars a year. State the exposure in the gap's own words
  (`why`); the price is the quote (X2). For ranking, treat as `urgency × exposure`, with
  exposures from `GAP_ADVICE` (for example umbrella: liability above the car and home limits;
  health: "tens of thousands of dollars" for a hospital stay; renters: belongings
  `$30,000`).
- **Confidence:** high (85–95%) when the fact is typed or read from a mortgage/loan account;
  medium (60–75%) when inferred from one signal (rent seen, one flight); low (<50%) when the
  only signal is a default. A gap that rests on an assumption of no policy drops sharply if
  the person has uploaded no documents and has `found` policies unconfirmed (the policy may
  exist outside Jane's view).
- **Urgency:** high for `auto` (driving uninsured is illegal), `health`, `home` with a
  mortgage; medium for `life`, `disability`, `renters`; low for `umbrella`, `pet`, `travel`
  (travel rises to high in the weeks before a booked trip).
- **Why you:** "You told me you rent, and there's no renters policy on your profile" /
  "Your payments show rent".
- **Action:** "Get quotes" (`insurance.quotes`) or "I have this: add it"; "Not for me"
  (`insurance.gap_no`).
- **Fires:** YR renters (rent seen), health if no plan yet; FM life (dependants), umbrella if
  assets pass the line, auto/home if missing, `teen_driver`; FL health, disability, business
  gaps; HE umbrella, disability; CR umbrella; RT none by default (no `life`, no
  `disability`: no paycheck); DT only `auto` if uninsured.
  **Must not:** `life` for CR and RT without dependants; `disability` for RT; `pet` unless
  told; `umbrella` below the asset line; anything for a person who dismissed it.

## X2. Quotes (step 103)

- **Source:** `quotes.ts`, partner `quote()`; chat ask `quotes`, button "Get quotes".
- **Fires when:** a gap or a person's ask names a quotable kind (`QUOTABLE_KINDS`) and the
  partner exists (demo bank). Never unasked for a policy the person is happy with.
- **Worth:** the quote's annual premium against today's (`yearlyPremium`) for the same cover
  (`sameCover`); a quote for a gap is a price, not a saving.
- **Confidence:** the quote is from a stand-in (flag "sample price"); same-cover comparison
  is exact only when the policy's cover fields are known (document-confirmed) and drops when
  deductible or limits are defaults.
- **Urgency:** follows its gap or renewal; never urgent alone.
- **Action:** the quotes message with "Pick this one" (`insurance.shop_yes`) / "Not now".
- **Fires:** whoever X1 fires for, or X3 for. **Must not:** a person with no partner (real
  accounts), or for a kind the partner doesn't quote (`health` goes through the marketplace
  comparison, AD1).

## X3. Reshop before renewal (step 104)

- **Source:** `shop.ts` (`reshopPerson`), `daily.ts`; ask `shop`.
- **Fires when:** an active, confirmed, quotable policy renews in `RESHOP_DAYS_BEFORE_RENEWAL`
  (45) days (or the premium jumped, `price_up`), a same-cover quote exists, and the saving is
  at least `RESHOP_MIN_SAVING_CENTS` ($50) a year. At most `RESHOP_RUNNERS_UP` (2) runners-up.
- **Worth:** `current yearly − pick yearly` for the same cover (`shop.savingCents`).
- **Confidence:** raised by a document-read policy, a long run of seen premium payments, the
  quote being same-cover on every limit; lowered by `found` status, a default deductible,
  or a quote that changes any cover field. "Told" renewal dates beat guessed ones.
- **Urgency:** rises as the renewal date nears; after the renewal passes, falls to zero
  (the switch is next year's).
- **Why you:** "You pay $1,704 a year to GEICO; the same cover is $1,515."
- **Action:** "Switch" (`insurance.shop_yes`) / "Not now".
- **Fires:** FM (two cars + home), HE, CR, FL (auto), BO (vehicle); YR when they have a car
  policy. **Must not:** DT with a policy that lapses on a missed payment (a switch needs a
  first payment; flag, don't push), RT with no premium over the minimum saving.

## X4. One-tap switch (step 105)

- **Source:** `switch.ts`, `accept.ts`. Follows a yes to X3; not a separate trigger.
- **Fires when:** a shop pick was accepted (the person's tap, or Jane at "Everything allowed"
  within the sector caps, `insuranceAutopilot`).
- **Worth:** same as X3, realised once the new policy's first payment goes through.
- **Confidence:** 100% on the action once bound; the saving counts only after the first
  payment (`SWITCH_PAYMENT_DAYS`).
- **Action:** none beyond the yes; follow-up messages ("bound", "switched").
- **Fires/must not:** exactly X3's; never on autopilot over the caps.

## X5. Coverage checkup (step 106)

- **Source:** `checkup.ts` (`coverageCheckup`), `checkups.ts`; ask `checkup`. Yearly, and after
  a life event or when asked; advice mode only.
- **Fires when (per recommendation key):** `deductible_up` / `deductible_down` (savings vs
  `DEDUCTIBLE_SAVINGS_MULTIPLE`), `liability_up` (below `LIABILITY_TARGET_CENTS`),
  `full_cover_old_car` (car under `FULL_COVER_MIN_CAR_VALUE_CENTS`), `home_under` /
  `home_over` (against the home's value, `HOME_UNDER_INSURED_SHARE` / `HOME_OVER_INSURED_SHARE`),
  `bundle` (car and home with different carriers), `life_after_baby`, plus AD and AJ keys
  (`benefit_*`, business keys).
- **Worth:** each recommendation's `costCents` (negative is a saving), priced by
  `DEMO_PRICING`; the risk it changes is stated in words.
- **Confidence:** higher with the person's own car and home values on /things; lower on
  default values; a saving from a deductible change is conditional on savings covering it.
- **Urgency:** low except `liability_up` and `home_under` when a claim is plausible.
- **Action:** the checkup page; "Got it" (`insurance.checkup_seen`). From step 202 the
  checkup *is* the yearly review message (AJ7).
- **Fires:** FM, HE, CR, FL; YR once a policy exists. **Must not:** `deductible_up` for DT
  (thin savings: a higher deductible could not be paid), `full_cover_old_car` for a car with
  an outstanding loan (the lender requires full cover), `home_over` as a cut for someone
  with a mortgage clause.

## X6. Claims helper (step 107)

- **Source:** `claims.ts`, `claim-rules.ts`, `config/claims.ts`; ask `claim`.
- **Fires when:** the person says something happened ("I had a car accident"), or an open
  claim tracker has a step due (reminders every 3 days). Not detected from transactions;
  except a tow, body-shop or ER charge could raise a question (future).
- **Worth:** the risk avoided: a claim filed on time with the right evidence. Not a dollar
  figure until a payout is known.
- **Confidence:** 100% for a stated event; the reminders are certain because they come from
  the person's own tracker.
- **Urgency:** high (claims have notice deadlines); steps are due-dated.
- **Action:** "Start a claim tracker", "Done" per step (`insurance.claim_*`).
- **Fires:** anyone with the matching policy when they tell Jane. **Must not:** be raised
  unprompted from a transaction guess.

## X7. Autopilot and contact (step 108)

- **Source:** `autopilot.ts` replies; asks `autopilot`, `contact`.
- **Fires when:** asked ("what do you do on your own with my insurance"). A fact, not a
  detector in the nightly scan, but it should *explain* the person's current level.
- **Worth/confidence:** none; it is a description.

---

# Phase AD: every kind of cover (steps 149–155)

## AD1. Health plan comparison and open enrollment (step 149)

- **Source:** `health.ts` (`expectedYearlyCost`, `expectedOutOfPocket`, `openEnrollmentDates`),
  `DEMO_HEALTH_PLANS`; ask `need` for health.
- **Fires when:** the person has a health plan (marketplace) or none, and open enrollment is
  within reach (Nov 1 to Jan 15, `OPEN_ENROLLMENT`); or a cheaper plan exists on total cost.
- **Worth:** `current expected yearly cost − best plan's expected yearly cost`, where cost =
  premium + expected out of pocket on the person's medical spend over `MEDICAL_LOOKBACK_DAYS`.
- **Confidence:** a year of medical transactions lifts it; the default spend
  (`HEALTH_DEFAULT_SPEND_CENTS`, $1,500) is a guess and caps it low (about 50%); a plan with
  unknown deductible/coinsurance is left out of the comparison.
- **Urgency:** highest in the enrollment window; none outside it unless a life event allows
  a change.
- **Action:** "Compare plans" (link to the comparison); the deadline in the calendar.
- **Fires:** FL (marketplace, the main case), YR (when choosing their first plan), CR (the
  gap to Medicare), DT (cheaper plan matters). **Must not:** RT on Medicare, anyone whose
  plan comes through work with no choice (the detector turns into AD2 instead), HE unless
  employer offers a choice.

## AD2. Employer benefits found on the pay stub (step 150)

- **Source:** `benefits.ts`, `benefits-review.ts`, `payroll.ts`; ask `benefits`.
- **Fires when:** a pay stub deduction matches a benefit (`BENEFIT_PATTERNS`: health, dental,
  vision, life, disability, HSA, FSA) and is not yet confirmed; then the guided life/
  disability questions; then, before the employer's open enrollment, the review of like-for-
  like vs a private policy (demo advice).
- **Worth:** what the benefit costs a year (`yearlyCost`); for the review, the private-vs-
  employer cost difference (`benefit_keep` / `benefit_private`).
- **Confidence:** a pay stub line is seen (90%); the cover amount behind it is not (life and
  disability need the guided answer: told). A benefit counts as cover only after confirm.
- **Urgency:** medium; rises ahead of the employer's enrollment dates.
- **Action:** "Confirm these" (`benefits.confirm_all`), the guided question buttons.
- **Fires:** YR (first job), FM, HE, CR if still working. **Must not:** FL, RT, BO without
  payroll; DT only for the confirm (their benefits matter more).

## AD3. Policies read from documents (step 151)

- **Source:** `readings.ts`, `read-policy.ts`, `reading-rules.ts`; ask `documents`.
- **Fires when:** a policy document was uploaded and read, waiting for confirm; or a renewal
  notice shows a price change.
- **Worth:** accuracy, which every other detector depends on: confirming turns `found`/
  guessed fields into `document` fields and raises their confidence. Optionally the renewal
  rise (feeds AD7).
- **Confidence:** by the checks in `reading-rules.ts` (renewal date window
  `READING_RENEWAL_WINDOW_DAYS`, price within `READING_PRICE_TOLERANCE` of payments).
- **Urgency:** low, until a renewal is near.
- **Action:** "Confirm" / "Not right" (`reading.confirm`, `reading.dismiss`).
- **Fires:** anyone who uploads a document (documents are part of every sample person's year).

## AD4. Cover you already have through a card (step 152)

- **Source:** `card-cover.ts`, `card-benefits.ts`; ask `cards`.
- **Fires when:** a plan the person pays for (device protection, travel, rental-car) is wholly
  covered by a card they hold, and the card's condition is met in transactions (the bill is
  paid with that card).
- **Worth:** the plan's yearly cost (cancelling it).
- **Confidence:** the catalog entry (reviewed, stand-in) × the condition seen in charges; a
  partly covered plan does not fire.
- **Urgency:** next billing date.
- **Action:** the `covered_by_card` finding: cancel (`cancel_subscription`).
- **Fires:** HE (premium cards), FM (phone plans on a card), YR sometimes. **Must not:**
  DT with no card, anyone whose card condition isn't met, or where the plan covers more than
  the card does.

## AD5. Life insurance sized and bought (step 153)

- **Source:** `life.ts`, `life-need.ts`, `life-underwriting.ts`; ask `life`.
- **Fires when:** a paycheck, no active life policy, and dependants answered > 0 (the guided
  question comes first); demo advice only.
- **Worth:** the need: `LIFE_NEED` (income years + final expenses + education per dependant +
  debts − savings − existing cover) rounded; the risk is that gap. A term quote sets the cost.
- **Confidence:** dependants *told* (high), income *seen*, debts *seen* from accounts; lowered
  if the mortgage or savings are partly unlinked.
- **Urgency:** high with young children; medium otherwise.
- **Action:** "Get quotes" → "Apply" → "Buy" (each a tap).
- **Fires:** FM (the main case). **Must not:** YR with no dependants, RT, CR with grown
  children, DT whose first priority is debt (offer only if dependants are told).

## AD6. Cover changes after a life event (step 154)

- **Source:** `cover-changes.ts`, `cover-change-rules.ts`, `lifeEvents` (step 100); ask
  `life_change`.
- **Fires when:** a life event is recorded (moving checklist started, new car or car loan,
  told in chat: married, baby) and the matching cover change is prepared.
- **Worth:** risk avoided (staying uncovered or on a wrong address after the event); a
  price change is shown if the endorsement has one.
- **Confidence:** a told event is certain; one inferred from a new car loan is high; the
  change itself comes from rules per event.
- **Urgency:** high right after the event (a new car must be insured at once; an address
  change before a claim).
- **Action:** "Make the changes" (`cover.apply`); address-only changes are made by Jane at
  "Everything allowed".
- **Fires:** FM (move, baby, teen car), YR (first apartment), CR (downsizing). **Must not:**
  RT without events, anyone for an event that didn't happen.

## AD7. Renewal negotiation and claim filing (step 155)

- **Source:** `negotiate.ts`, `claim-filing.ts`; asks `renewal_call`, `file_claim`.
- **Fires when (negotiation):** a policy renews at least `NEGOTIATE_MIN_RISE` (5%) higher
  (from a renewal notice waiting for confirm, or a higher charge); a like-for-like quote is
  put alongside. **(Claim filing):** a small claim (at most `SMALL_CLAIM_MAX_CENTS`, $2,500)
  with a drafted description, on a policy the partner reaches.
- **Worth:** `renewal − result` (a yearly saving) if the call lowers it; for a claim, the
  payout after the deductible (a fact).
- **Confidence:** the rise is seen (a charge) or read (a notice); the result is a stand-in's
  answer. A competing same-cover quote lifts the confidence that a call is worth making.
- **Urgency:** before the renewal date; a claim after the incident date.
- **Action:** "Call them" (`renewal.call`) / "No thanks"; "File it" (`claim.file`).
- **Fires:** FM, HE, CR, BO (vehicles). **Must not:** a rise under 5%, a policy already
  reshopped and switched, a claim over the limit.

---

# Phase AJ: round three (steps 196–202)

## AJ1. Paying less for the same cover (step 196)

- **Source:** `saving-rules.ts` (`findSavings`), `savings.ts`; ask `savings`.
- **Fires when (per kind):** `pay_in_full` (cash covers a year up front, installment fee +
  discount), `autopay`, `paperless`, `bundle` (car and home/renters on different carriers),
  `telematics` (car), `higher_deductible` (savings cover the step `DEDUCTIBLE_SAVINGS_COVER`
  times). Only auto, home and renters (`SAVING_POLICY_KINDS`); each saving at least
  `MIN_SAVING_CENTS` ($20).
- **Worth:** `yearlySavingCents` from `SAVING_RATES`; totals say "up to" (they overlap).
- **Confidence:** a known premium and frequency (seen or document) with a balance seen; lowered
  if the premium is a guess. `higher_deductible` is conditional on the claim-time exposure,
  shown both ways.
- **Urgency:** low; rises with a nearby renewal (apply at renewal).
- **Why you:** "You pay monthly with a $4 fee each time; paying once a year takes about $X off."
- **Action:** "Do all of these" (`saving.apply_all`) / "Not now"; the deductible is its own
  message ("this one lowers your cover").
- **Fires:** FM, HE, CR, FL (auto), BO. **Must not:** DT for `pay_in_full` and
  `higher_deductible` (no cash to spare), RT with a tiny premium under the minimum, anyone
  already on autopay.

## AJ2. Risks seen in how you live (step 197)

- **Source:** `risk-signals.ts` (`RISK_SIGNALS`), `risks.ts`; ask `risks`.
- **Fires when (one question, once, per kind):** rideshare/delivery payouts in (`rideshare`),
  Shopify/Square/Stripe/Etsy payouts in (`home_business`), a vet or pet-store charge with no
  pet on the profile (`new_dog`), a jewelry/camera purchase over $1,500 (`valuable`), boat
  spending (`boat`), Airbnb/Vrbo income (`rental_out`). A yes opens the matching gap with
  sample quotes; a no is remembered forever.
- **Worth:** risk avoided: the exposure in each gap's words (car accident while driving for
  pay; a customer hurt at a home business; an unlisted ring over the cap).
- **Confidence:** a merchant pattern match plus direction and size; one occurrence is a
  question (confidence lives in asking, not asserting). A repeat over several months lifts
  it. A no drops it to zero for that kind.
- **Urgency:** medium; asked once, not nagged.
- **Action:** "Yes" / "No" (`risk.yes`, `risk.no`), then "Get quotes" (`insurance.gap_quotes`).
- **Fires:** FL (rideshare/delivery payouts, business), BO (Shopify, `valuable` if equipment),
  FM (new dog), HE (`valuable`), CR/RT (`boat`, `rental_out` if seen). **Must not:** repeat
  after a no; ask `rideshare` when step 201's `car_business_use` already covers it.

## AJ3. The whole household's cover (step 198)

- **Source:** `family-rules.ts`, `family.ts` (`loadFamily`); ask `household`.
- **Fires when:** `teen_driver`: a listed driver aged up to `TEEN_DRIVER_MAX_AGE` (19) on no
  car policy; `spouse_health`: a listed spouse on no health plan and no plan of their own
  shared with the household; `family_health_plan`: a household health plan costs at least
  `FAMILY_HEALTH_MIN_SAVING_CENTS` ($600) a year less for the whole family than the plan that
  covers them now.
- **Worth:** `family_health_plan`: the yearly difference (premium for everyone + expected out
  of pocket); the other two: the exposure in words.
- **Confidence:** people are *told* (typed on /insurance); a partner's policy is seen only
  when shared; the health comparison uses the family's real spend if medical transactions
  exist, else the default (lower).
- **Urgency:** `teen_driver` and `spouse_health` high; the plan comparison peaks at open
  enrollment or after a life event.
- **Action:** "Get quotes" for the gap; the household section.
- **Fires:** FM (all three), CR (spouse_health until Medicare). **Must not:** YR and FL
  with nobody listed; RT; anyone who didn't list the people.

## AJ4. Claim or pay yourself (step 199)

- **Source:** `claim-worth.ts`, `claim-worth-for.ts`; ask `claim_worth` and the claims page
  calculator, and a line on the claim draft.
- **Fires when:** a claim draft exists with an amount (proactive form), or the person asks
  with an amount. The *payout* line is a fact; the three-year cost and verdict are demo advice.
- **Worth:** `payout − premium rise over CLAIM_SURCHARGE_YEARS − claims-free discount lost`
  (`CLAIM_SURCHARGE`, `CLAIMS_FREE_DISCOUNT`). Negative net means pay it yourself.
- **Confidence:** exact on the deductible when document-confirmed; the rise and discount are
  typical carrier practice, so cap near 70% and say "about"; unknown premium gives no verdict.
- **Urgency:** at the time of the incident (claim windows).
- **Action:** "File it" or "I'll pay it myself" in the draft message; the calculator.
- **Fires:** FM, HE, CR (auto/home claims); DT should see it strongest (a small claim under
  the deductible pays nothing). **Must not:** a verdict without a known premium.

## AJ5. Health cover all year (step 200)

- **Source:** `health-year-rules.ts`, `health-year.ts`; ask `health_year`.
- **Fires when:** the person has a health plan with deductible and coinsurance (the demo
  bank uses a sample plan, said so). Sub-detectors: deductible and out-of-pocket progress and
  the month the maximum is reached; **FSA** money left within `FSA_WARN_DAYS` (90) of Dec 31
  with at least `FSA_WARN_MIN_CENTS` ($50) left; **in-network** check of providers paid
  against the plan's directory; **dispute**: a bill of at least `BIG_BILL_MIN_CENTS` ($500)
  paid for more than `DISPUTE_TOLERANCE_CENTS` ($100) above the person's share.
- **Worth:** FSA: the money left that would be lost; dispute: `overCents` (a one-off
  recovery); progress: the risk avoided (timing care to the deductible), a fact.
- **Confidence:** FSA election from a pay stub is seen; "used" is an estimate (FSA claims
  are not visible), so the lost amount is "up to". A dispute is as sure as the plan's terms
  (document-confirmed raises it; a sample plan is demo-only).
- **Urgency:** FSA rises to the deadline; disputes are time-limited by the provider and plan.
- **Action:** a dispute card (a `bill_negotiation` finding with `evidence.dispute`) for the
  team; FSA heads-up "Your health year".
- **Fires:** YR (FSA if elected), FM, HE (HSA/FSA), FL (marketplace, deductible progress).
  **Must not:** RT on Medicare (different terms), anyone without plan terms or with no
  medical charges; a dispute for an out-of-network provider.

## AJ6. Business and side-gig cover (step 201)

- **Source:** `business-rules.ts` (`businessGaps`), signals in `household.ts`
  (`signals.selfEmployment`); ask `business`; in the checkup.
- **Fires when:** the tax profile says self-employed, or contract/gig income over
  `BUSINESS_MIN_INCOME_CENTS` ($500) in `BUSINESS_LOOKBACK_DAYS` (365). Then:
  `business_liability` (no business policy with general liability of
  `BUSINESS_LIABILITY_TARGET_CENTS`, $1,000,000), `professional_liability` (freelance work and
  none), `car_business_use` (a car policy, and gig income or at least `BUSINESS_MILES_MIN`
  (1,000) business miles, with no rideshare policy), `business_equipment` (electronics bought
  worth at least `BUSINESS_EQUIPMENT_MIN_CENTS` and no business property cover).
- **Worth:** risk avoided; the checkup prices each (`businessCover`): liability and equipment
  by `DEMO_PRICING.business`, professional `BUSINESS_PROFESSIONAL_YEARLY_CENTS` ($600),
  car use `BUSINESS_CAR_USE_YEARLY_CENTS` ($300).
- **Confidence:** a tax-profile declaration is told (90%+); income seen in categories is seen
  (70–85%); miles logged on the tax profile are told. Never counts a personal policy as
  business cover. Gig income alone gives only `car_business_use`.
- **Urgency:** medium; high for `car_business_use` when income is from driving for pay.
- **Action:** "Get quotes" (stand-in), "See the checkup".
- **Fires:** FL (all four), BO (liability, equipment, car use), YR with gig income
  (`car_business_use` only). **Must not:** HE, RT, CR and FM without side income; a
  salaried person with one gig payout (that is AJ2's question).

## AJ7. The yearly review and Keep me covered (step 202)

- **Source:** `review-rules.ts`, `review.ts`, `checkups.ts`; asks `keep_covered`, `review`.
- **Fires when:** a yearly checkup runs (or after a life event), in advice mode. One message
  with what Jane did within her caps, what needs a tap (a button each), and the yearly money.
  `keepCovered` applies the same-cover savings (`KEEP_COVERED_SAVING_KINDS`: `pay_in_full`,
  `autopay`, `paperless`, `bundle`) and calls the insurer about renewals going up, by itself
  only at "Everything allowed" and within the sector caps; below that, on the person's tap.
- **Worth:** `savedYearlyCents` (applied) plus `waitingCents` (offered savings + checkup
  savings).
- **Confidence:** the sum of its parts, never higher than the weakest included saving; a
  review with nothing to tap says "your cover looks right" at the confidence of the checks
  that ran (it is only as complete as the policies Jane knows).
- **Urgency:** yearly; earlier after a life event or a renewal rise.
- **Action:** "Keep me covered" (`insurance.keep_covered`), links to each item, "Got it".
- **Fires:** everyone with an active policy in advice mode. **Must not:** people with no
  policies (nothing to review), real accounts (facts only, no advice).

---

# Matrix: where each should and should not fire

`F` fires on their written list, `—` quiet, `✗` must not (a wrong suggestion for that
person). Blank cells are "depends on the person's data" and are decided by the detector.

| Capability | YR | FM | FL | HE | CR | RT | DT | BO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X1 gaps (renters/home/auto) | F renters | F if missing | F | — | — | — | F auto if none | F |
| X1 life | ✗ | F | — | — | ✗ | ✗ | ✗ | F if dependants |
| X1 umbrella | ✗ | F if assets | — | F | F | — | ✗ | — |
| X1 disability | F | F | F | F | ✗ | ✗ | F | F |
| X3 reshop | F | F | F | F | F | F if over min | ✗ if lapse risk | F |
| X5 checkup | F | F | F | F | F | F | F (no deductible up) | F |
| X6 claims helper | on request | on request | on request | on request | on request | on request | on request | on request |
| AD1 health plan compare | F | — | F | — | F | ✗ | F | F |
| AD2 employer benefits | F | F | ✗ | F | F | ✗ | F confirm | ✗ |
| AD3 documents | on upload | on upload | on upload | on upload | on upload | on upload | on upload | on upload |
| AD4 card cover | — | F | — | F | — | — | ✗ | — |
| AD5 life sized | ✗ | F | — | — | ✗ | ✗ | ✗ | F if dependants |
| AD6 life-event changes | F | F | — | — | F | — | — | — |
| AD7 negotiation | — | F | — | F | F | F | ✗ | F |
| AJ1 savings | ✗ pay_in_full | F | F | F | F | — | ✗ pay_in_full, deductible | F |
| AJ2 risks | — | F new dog | F | F valuable | F boat | — | — | F |
| AJ3 household | ✗ | F | ✗ | — | F spouse | ✗ | ✗ | — |
| AJ4 claim or pay | — | F | — | F | F | — | F | F |
| AJ5 health year | F FSA | F | F | F | ✗ Medicare | ✗ | F | F |
| AJ6 business cover | gig only | ✗ | F | ✗ | ✗ | ✗ | — | F |
| AJ7 yearly review | F | F | F | F | F | F | F | F |

## What the harness (step 254) should assert for insurance

Per person, in addition to "what fired" matching "what should have":

1. No advice-mode detector fires without `adviceMode`, and every fired one carries
   `DEMO_ADVICE_LABEL`.
2. Every dollar figure in a suggestion's text is in its `cents` list (guardrails).
3. Confidence is a pure function of the evidence: the same person built twice gives the same
   percentages.
4. A dismissed gap, a "no" on a saving, a "no" on a risk question and a declined renewal call
   never fire again.
5. Nothing that changes price or cover is applied below "Everything allowed", and a higher
   deductible or a safe-driver program is never applied on autopilot.
6. Personal policies are never counted as business cover.

## Open questions for the thinking lane (step 254)

- Whether "risk avoided" detectors (gaps, claims helper, risks) should carry a dollar value
  for ranking. This file proposes `exposure × likelihood`, stated in words, with the
  exposures already in `GAP_ADVICE`.
- Whether the registry's one `insurance` capability (kind `insurance`) should split into one
  entry per ask above, since the detector contract is per capability. The `ask` already
  separates them in `capabilities/insurance.ts`.
- How a recommendation that depends on a stand-in quote should show its confidence: here, a
  sample price never raises confidence above the policy record's.
