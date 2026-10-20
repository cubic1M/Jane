# Review: debt and spending suggestions, as a skeptical customer (step 266 prep)

I ran the detectors on each of the eight sample people and read what they say, the way a person who
has never heard of Jane would: are the dollars believable and counted once, does the percentage
move with the evidence and have a reason I would accept, is the "why you" about me, and are the top
three right for my life? This is what I found, what I changed, and what is not mine to change. The
wording and ranges are pinned in `src/detectors/quality-debt-spending.test.ts`.

## What I changed

1. **Ranking for someone in debt trouble.** Chris saw a 0% transfer card first and the hardship
   plan ninth, behind renters insurance. For a person with $38 in cash and 24 overdraft or late
   fees, tips that need spare cash or a new card come after relief. Now his top three are the
   payoff plan, the hardship call and replacing the payday loan. The tips (card interest, a
   transfer, paying cards down before the statement) keep their true dollars but count for 40% in
   ranking while he is in trouble (`troubleDiscount`, `troublePlanRank`, `troubleHardshipRank` in
   `src/config/detectors-debt.ts`). Cash under half a month of bills is now "now" for the cash
   shortfall suggestion, and ranks by what is short.
2. **Dollars counted once, and honestly.** The card-use suggestion used to show Chris "$6,940"
   (the pay-down, which he cannot afford) as if it were a yearly value. It now shows what getting
   under the line is usually worth (about 1.5 points off the rate on what is owed, $151 for Chris,
   $29 for Maya) and says plainly when the pay-down is more than the cash he has. The overrun for
   the Reyes' catered party is one month's overrun, not twelve, and its confidence is capped
   because one month is not a pattern. The same card interest still appears in card interest, the
   payoff plan, the hardship call and a transfer: they are alternatives, not additions, and the
   ranking treats them that way.
3. **Confidence that means something.** Suggestions that rest on something Jane cannot see now
   carry a "guessed" piece, so they cap at 75% with a reason in plain words: a student loan's income-driven plan (is it federal?),
   Public Service Loan Forgiveness (does the loan and plan qualify?), a dealer add-on (only you can
   say), money lent through a payment app (was it a loan?), a 0% transfer for someone in trouble
   (approval is up to the lender), the credit tier (up to the lender), a budget after one big month.
   What Jane counted stays at 85% and over (12 months of interest charges, a collector's payments,
   hospital bills). With two months of data instead of twelve, Chris's card interest falls by more
   than ten points.
4. **Words a person would accept.** "1 cards linked" is now "1 card linked" (one match is singular,
   across every detector and profile fact, in `counted` in `src/profile/confidence.ts`). Payees are
   named as people say them: "Netflix and Hulu", "Disney Plus, Netflix and Hulu", "Springfield
   Schools", not "NETFLIX.COM, HULU" or "SPRINGFIELD SCHOOLS". The price-rise reason is "10 charges
   at the old price", not "11 charges showing the rise". A test fails on any shouting payee in any
   "why", or any "1 cards".
5. **Buttons go to the lane's own pages:** card interest to `/loans/interest`, payday and cash
   advances to `/loans/costly`, the hardship call to `/loans/help`.

## Per person (top five after the changes)

| Person | Top five | Verdict |
|---|---|---|
| **Maya**, young renter | employer match, renters insurance, card interest ($557, 89%), a 0% transfer ($499, 80%), emergency fund | Right life. Card interest above the transfer, as she can act on it. Her streaming overlap, the Skillshare trial that became $13.99 and the Audible rise ($14.95 to $16.45) are further down at small, honest dollars. Renters insurance at #2 is the insurance lane's ($30,000 "risk"); see below. |
| **The Reyes** | life insurance, Public Service Loan Forgiveness ($8,000, 74%), PMI ($1,690), emergency fund, a food overrun (56%) | The teacher's loan is the one thing only Jane would think of; it is capped because eligibility is not certain. The dinner charged twice ($68, now) and the GAP add-on ($558, 56%) are lower and flagged as guesses where they are. |
| **Sam**, freelancer | renters insurance, an income-driven plan ($1,588, 74%), self-employed retirement, emergency fund (6 months), health plan | The plan comparison now says "if they're federal". Estimated taxes and income smoothing are the work lane's, further down. |
| **Priya** | refinance, insurance shopping, company stock, idle cash, backdoor Roth | Refinance ($6,370) is the gap on the whole balance a year, before closing costs, and says so. Paying down vs idle cash are alternatives for the same $39,000, both honest. |
| **Dan and Lena** | umbrella, long-term care, Roth conversion, catch-up, idle cash | The $600 sent to their son is last ($600, 56%): right for how little it is. |
| **Ruth** | idle cash, Roth conversion, hospital bills ($667, 89%), bill negotiation, Medicare supplement | Medical bills and her $168 internet bill are real, small and believable; they are on her written list. |
| **Chris** | payoff plan, hardship call, replace the payday loan, card interest, cash shortfall | Relief first, then the tips. The payday loan is "now" with its real repayments ($4,140). The starter buffer ($1,000) is sized for him, not three months. |
| **Jo** | business cover, self-employed retirement, emergency fund, health plan, insurance shopping | Card use at 46% is a small suggestion now, not a $2,400 headline. |

## Not mine, but worth saying

- **Renters insurance ranks first or second for Maya, Sam and Chris** on a "$30,000" figure counted
  as a risk. It is belongings at risk, not a cost; it beats Maya's card interest in the ranking.
  The insurance lane could rank it by the premium it avoids or the loss a renter typically faces.
- **Priya's insurance shopping says she paid $76,684.80 for car and home cover in 12 months**
  (24 charges). Her Chubb Home is $410 a month, about $4,920 a year; the sum looks like it includes
  more than premiums.
- **The debt-trouble fact's reason says "24 overdraft or late fees"** for Chris; counting his
  overdraft, insufficient-funds and late fees gives 11. It appears in the reasons of the payoff plan,
  the hardship call and the starter buffer. It is in the profile builder.
- Most percentages are 74% to 89% for a person with a year of data. That is as it should be for
  clean counts; the spread comes from the guessed ones (56% to 74%) and thin data. If the nightly
  scan should show more variation, the thinking lane's recipe is the place (`CONFIDENCE` in
  `src/config/profile.ts`).
