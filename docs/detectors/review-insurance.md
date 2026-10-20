# Insurance detectors: a quality review on the eight people (step 259)

The same review the loans lane did for debt and spending (`review-debt-spending.md`): run
every insurance detector on the eight sample people, look at the dollars, the confidence
spread, whether "why you" is specific, and whether the top three each person gets today are
sensible. Numbers below are from `reportFor` and `rankSuggestions` / `pickForToday`
(`src/planning/suggestion-rank.ts`) on the sample data at 2026-10-17, after the fixes in this
PR. Re-run with the harness (`npx vitest run src/detectors`); the figures change with the sample
data.

## What the review found, and what changed

| # | Finding | Fix |
| --- | --- | --- |
| 1 | `insurance_shopping` told Priya she paid $76,684.80 in premiums; Chubb is $410 a month ($4,920 a year). The regex for car and home cover (`\bHOME\b`) also matched "HOME DEPOT" and mortgage lines. | Premiums are now only charges in the insurance category (`premiums()`), so a store is never home cover. Test: Priya's text says $4,920.00 and the saving is 10% of that. |
| 2 | Risk amounts were the whole loss: renters $30,000 ranked first or second for Maya, Sam and Chris, above real money; the Reyes' life cover said $1,279,200 and Jo's business cover said $491,839 (a year of his income). | A risk is worth its expected yearly loss, chance × cost, from config (`DETECTOR_RATES`: renters 3% × $30,000 = $900, an at-fault accident 5% × $100,000 = $5,000, a hospital stay 8% × $27,000, umbrella 0.2% of assets, long-term care 20% over 10 years of two years' care, life 0.3% a year of ten years' income, business 4% × $50,000). The "why you" still states the whole loss and the small chance, so the person sees both. |
| 3 | Confidence read as sure as the charges were clean: 89% on "you could save up to a tenth" (a typical rate, not a quote), 80% on "your card probably covers this" (we cannot see the card's benefits). | Ceilings in `DETECTOR_RATES.insuranceCaps` for suggestions whose amount is typical or rests on something Jane cannot see (shopping, health and Medicare supplement comparisons 70%, renewal call 75%, claim 65%, card cover 55%, employer plan 60%, document 75%). When a ceiling applies the reason says so ("…; I can't see your card's actual benefits"). |
| 4 | A multi-part confidence showed only one piece of evidence: Sam's health-plan comparison read "24 deposits in 12 months of data". | `combine()` names every piece in the reason ("uneven pay…; 12 health-plan charges…"), and the percentage is still the weakest piece. |

Expected loss does not subtract the premium. Insurance is priced above its expected payout on
purpose, so subtracting would make every risk detector negative; the value of a risk detector
is the loss the person is exposed to in a year, weighted by the scan (`WORTH_WEIGHT.risk`) so
it never outranks real savings. The premium appears in the "why you" where it is known.

## The eight people

Top three is what `pickForToday` would show after all detectors (every lane), so it says
whether insurance reaches the person unasked. Insurance rows are rank / suggestions fired.

| Person | Top three today | Insurance suggestions | Verdict |
| --- | --- | --- | --- |
| Maya (renter) | employer match, card interest, balance transfer | renewal call $156 (75%, #8/17); shop car cover $144 (70%, #11); renters cover $900 risk (79%, #15); tell the insurer about the move $300 risk (80%, #16) | Right: real money first. The renewal call is the only insurance item worth a nudge this week. |
| The Reyes | student forgiveness, **insurance claim**, PMI removal | claim after a $3,100 collision repair $2,100 (65%, #2, now); shop cover $420 (70%, #10); life cover $3,838 risk (74%, #11) | Right: an unclaimed repair has a deadline. Life cover now sits where its expected value puts it. |
| Sam (freelancer) | student repayment, emergency fund, self-employed retirement | health-plan comparison $494 (70%, #4, soon); **no car insurance** $5,000 risk (74%, #5, now); renters cover $900 (79%, #9) | Questionable: an uninsured car is illegal to drive and urgent, but ranks fifth. See open question 1. |
| Priya (equity) | refinance, concentration, idle cash | shop cover $492 (70%, #9); card already covers the protection plan $204 (55%, #13) | Right. Neither is more than a footnote next to $259,000 of company stock. |
| Dan and Lena | Roth conversion, catch-up, idle cash | employer benefits $660 (60%, #4); shop cover $342 (70%, #5); long-term care $4,320 risk (58%, #8); umbrella $1,060 risk (85%, #9) | Right. Long-term care is rightly low confidence: age is guessed (no age told), so it is 58%. |
| Ruth (retiree) | idle cash, Roth conversion, medical bills | confirm the policy document $493 (75%, #4, soon); Medicare supplement comparison $347 (58%, #6); shop cover $158 (70%, #10) | Right. The document is the one with a concrete next step. |
| Chris (debt) | debt plan, card interest, balance transfer | renters cover $900 risk (79%, #15/16) | Right: insurance stays out of the way of the debt plan. |
| Jo (owner) | self-employed retirement, emergency fund, estimated taxes | business cover $2,000 risk (79%, #6, soon); health plan $2,160 risk (70%, #8); renters cover $900 (79%, #9) | Questionable: a business with no liability cover and $4,099,000 of yearly income deserves more than #6. See open question 2. |

## Confidence spread

Insurance suggestions now span 55% to 85%: 55% for a guess about a card's benefits, 58% where
age is guessed, 60 to 75% where the amount is typical, 79 to 85% where Jane reads the fact
straight from the data (a rent payment, an account balance). Before, nearly everything read
79 to 89%. The ceilings are the honest limit of "likely right for this person and worth the
stated amount" when the amount is a typical rate.

## "Why you" check

- Uses the person's own figures: premiums, the rise from $118.00 to $131.00 a month, the repair
  ($3,100 to ABC Collision Center on a date), the balance total, the plan charges, the
  employer's name.
- Says what would stop the question: "If it's paid some other way, tell me and I'll stop
  asking" (car cover), "If a partner's plan covers you, tell me" (health).
- Does not state a promise: savings are "up to", risks give the small chance next to the big
  loss, and nothing says what the insurer will do.

## Open questions for the thinking lane

1. **Urgency against risk weight.** `auto_insurance` is `urgency: "now"` with a $5,000 expected
   loss, and still ranks fifth for Sam, behind emergency fund and self-employed retirement,
   because `WORTH_WEIGHT.risk` discounts every risk. Driving uninsured is both illegal and the
   most expensive mistake on the list. Either a higher weight for `"now"` risks, or a
   `rankCents` override for a legal requirement, would put it in the top three.
2. **Business liability for Jo.** Same weighting: a business with no liability cover ranks
   sixth. A claim against an uninsured small business can end it; the 4% yearly chance
   understates how bad the tail is. A risk-aversion factor (or a minimum rank for
   "no cover at all" on a business) is the scan's call.
3. **Renters cover for people in other trouble.** It fires for Maya, Sam, Chris and Jo
   (all renters, none with a cover charge). At #9 to #15 it never reaches the top three, which
   is right; if the scan ever shows it, it should come after debt and cash.
4. **Still outside the profile.** The checks that need the policies themselves (reshop of a
   known policy, the coverage checkup, household gaps, business gaps from the tax profile, the
   health year, the yearly review) keep running from the insurance snapshot, not the profile.
   Passing policies into `ProfileInput` would let them join the nightly scan and these
   rankings.
