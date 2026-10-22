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
| 2 | Risk amounts ranked as the whole loss: renters $30,000 ranked first or second for Maya, Sam and Chris, above real money; the Reyes' life cover said $1,279,200 and Jo's business cover said $491,839 (a year of his income). | A first fix put the expected loss in `worthCents`. The thinking lane then moved the discount into the ranking (`RISK_ANNUAL_PROBABILITY` in `src/config/suggestions.ts`, chances I supplied: renters 3%, an at-fault accident 5%, a hospital stay 8%, umbrella 0.2%, long-term care 2% a year, life 0.3%, business 4%, a stale-insurer claim 1%), so now `worthCents` is the whole loss the person sees ($30,000 for renters, $100,000 for an uninsured car) and the ranking counts loss × chance. My own chance constants are gone: the map is the only discount. An uninsured car and a business with no cover at all are `required: true`, which the ranking multiplies by `REQUIRED_BOOST`. |
| 3 | Confidence read as sure as the charges were clean: 89% on "you could save up to a tenth" (a typical rate, not a quote), 80% on "your card probably covers this" (we cannot see the card's benefits). | Ceilings in `DETECTOR_RATES.insuranceCaps` for suggestions whose amount is typical or rests on something Jane cannot see (shopping, health and Medicare supplement comparisons 70%, renewal call 75%, claim 65%, card cover 55%, employer plan 60%, document 75%). When a ceiling applies the reason says so ("…; I can't see your card's actual benefits"). |
| 4 | A multi-part confidence showed only one piece of evidence: Sam's health-plan comparison read "24 deposits in 12 months of data". | `combine()` names every piece in the reason ("uneven pay…; 12 health-plan charges…"), and the percentage is still the weakest piece. |

The ranking does not subtract the premium from a risk's expected loss. Insurance is priced above
its expected payout on purpose, so subtracting would make every risk negative; the value of a
risk detector is the loss the person is exposed to in a year. The premium appears in the "why
you" where it is known.

## The eight people

Top three is what `pickForToday` would show after all detectors (every lane), so it says
whether insurance reaches the person unasked. Insurance rows are rank / suggestions fired.

| Person | Top three today | Insurance suggestions (rank / fired) | Verdict |
| --- | --- | --- | --- |
| Maya (renter) | employer match, card interest, balance transfer | renters cover $30,000 at 3% (81%, #4/17); tell the insurer about the move $30,000 at 1% (83%, #6); renewal call $156 (75%, #10); shop car cover $144 (70%, #14) | Right: real money first. Renters cover is fourth, worth about $900 a year in expectation against a $156 call; it is the one to watch (open question 3). |
| The Reyes | **insurance claim**, student forgiveness, life insurance | claim after a $3,100 collision repair $2,100 (65%, #1, now); life cover $1,287,200 at 0.3% (49%, #3); shop cover $420 (70%, #11) | Right: an unclaimed repair has a deadline, and the family with a child and no life cover sees it third. |
| Sam (freelancer) | **auto insurance**, income smoothing, emergency fund | no car insurance $100,000 at 5% (49%, #1, required); renters cover (#6); health-plan comparison $494 (70%, #7) | Right now: an uninsured car is required and leads. Its confidence is 49% because "has a car" is a guess from gas stations. |
| Priya (equity) | concentration, refinance, idle cash | shop cover $492 (70%, #8); card already covers the protection plan $204 (55%, #13) | Right. Neither is more than a footnote next to $259,000 of company stock. |
| Dan and Lena | **long-term care**, Roth conversion, idle cash | long-term care $216,000 at 2% (43%, #1); umbrella $529,926 at 0.2% (93%, #5); employer benefits $660 (60%, #6); shop cover $342 (70%, #7) | Questionable: long-term care leads at 43% confidence. See open question 4. |
| Ruth (retiree) | idle cash, Roth conversion, medical bills | confirm the policy document $493 (75%, #4, soon); Medicare supplement comparison $347 (43%, #7); shop cover $158 (70%, #9) | Right. The document is the one with a concrete next step. |
| Chris (debt) | debt plan, hardship plan, high-cost loans | renters cover $30,000 at 3% (81%, #7/16) | Right: insurance stays out of the way of the debt plan. |
| Jo (owner) | **business insurance**, self-employed retirement, emergency fund | business cover $50,000 at 4% (81%, #1, required); health plan $27,000 at 8% (70%, #4); renters cover (#7) | Right: a business with no liability cover leads. |

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

## Open questions

1. **Done: urgency against risk.** An uninsured car (Sam) and a business with no cover at all (Jo)
   now lead, through `required: true` and `REQUIRED_BOOST`.
2. **Confidence on "has a car".** Sam's uninsured-car suggestion is 49% because a car is guessed
   from gas and car costs. Asking once ("do you have a car?") would lift it; that is the
   step 257 question.
3. **Renters cover at #4 for Maya.** At 3% × $30,000 it is worth about $900 a year in
   expectation, more than a renewal call. If that reads as pushy for a first job on a tight
   budget, the right lever is the chance (the map), not a special case here.
4. **Long-term care at #1 for Dan and Lena at 43% confidence.** The yearly chance (2%) times two
   years of care ($216,000) is $4,320 a year, which beats a Roth conversion. Their age is
   guessed (nobody told Jane), so the confidence is low, and for people in their early sixties
   it is early rather than urgent. A "later" urgency weight below Roth conversion's, or a
   minimum confidence to lead, is the scan's call.
5. **Still outside the profile.** The checks that need the policies themselves (reshop of a
   known policy, the coverage checkup, household gaps, business gaps from the tax profile, the
   health year, the yearly review) keep running from the insurance snapshot, not the profile.
   Passing policies into `ProfileInput` would let them join the nightly scan and these
   rankings.
