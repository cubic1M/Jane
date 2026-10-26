# Accuracy

Jane's accuracy test bench (founder, 2026-10-26). Until now every finding had been tuned on the eight sample people. The bench holds Jane to 40 synthetic bank histories that look like real exports, with the truth for every detector, and a CI gate keeps the scores from slipping.

- **Data:** `src/accuracy/generate.ts`, a fixed seed (`SEED`), written to `src/accuracy/__fixtures__/histories.json`.
  - 40 people, about 11,500 transactions, with 2 to 14 months of history each.
  - Six kinds of person: salaried, hourly, freelancer, retiree, struggling and saver.
  - The messy-bank lessons are built in:
    - card payments written by the card company, including one no rule knows (Barclaycard);
    - moves to savings, and Venmo and Zelle to oneself;
    - overdraft fees, some given back;
    - processor prefixes (`SQ *`, `TST*`, `PAYPAL *`, `AMZN Mktp US*`);
    - uneven pay, freelance payouts, Social Security and pensions;
    - usage bills that move with the season;
    - subscriptions that rose, were cancelled, renew yearly, or are billed together through Apple;
    - real double charges, refunded ones, and two identical tickets bought together;
    - returns, a trip abroad, big one-off purchases, and savers with idle cash.
- **Truth:** every row the generator writes says what it is, so each detector is scored item by item:
  - subscriptions and price rises, by merchant;
  - fee and card-interest accounts;
  - double charges, by the second charge;
  - idle cash, by person;
  - upcoming bills, by merchant;
  - income and own-account transfers, by transaction.
- **Scoring:** `src/accuracy/score.ts` runs the real pipeline: the categorizer's rules, then the finding rules (`detect`), recurring charges, upcoming bills, the spending classification and the suggestion detectors. It's pure and needs no database, and makes no Claude calls.
  - **Precision:** of what Jane said, how much is true.
  - **Recall:** of what's true, how much Jane said.
  - **False-alarm rate:** the share of people who got at least one wrong item from that detector.
- **Run it:** `npm run accuracy` prints the scoreboard and calibration. `ACCURACY_WRITE=1 npm run accuracy` also rewrites the fixtures, `src/accuracy/baseline.json` and the tables below.
- **Gate:** `src/accuracy/accuracy.test.ts`, run with the unit tests. It fails when:
  - any detector's precision or recall drops more than 3 points below the baseline;
  - the fixture no longer matches the generator;
  - any suggestion says 0%;
  - a calibration bucket of 10 or more is over 10 points surer than it turns out to be.

  A change that makes a detector better passes; record the new baseline with it so the gain is kept.

## Scoreboard

Before: the detectors as on main (with #759's messy-bank fixes), on the same 40 people.

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 71.7% | 0.0% | 71 | 0 | 28 |
| price_rises | 100.0% | 100.0% | 0.0% | 9 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 17 | 0 | 0 |
| double_charges | 61.1% | 100.0% | 17.5% | 11 | 7 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 8 | 0 | 0 |
| bills | 98.2% | **60.6%** | 7.5% | 160 | 3 | 104 |
| income | 100.0% | 87.3% | 0.0% | 890 | 0 | 130 |
| transfers | 100.0% | 95.4% | 0.0% | 1152 | 0 | 56 |

After this PR (the baseline the gate holds to):

<!-- scoreboard:start -->
| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 71.7% | 0.0% | 71 | 0 | 28 |
| price_rises | 100.0% | 100.0% | 0.0% | 9 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 17 | 0 | 0 |
| double_charges | 61.1% | 100.0% | 17.5% | 11 | 7 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 8 | 0 | 0 |
| bills | 98.7% | 83.1% | 7.5% | 226 | 3 | 46 |
| income | 100.0% | 100.0% | 0.0% | 1066 | 0 | 0 |
| transfers | 100.0% | 95.4% | 0.0% | 1152 | 0 | 56 |

Calibration now:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 27 | 57% | 85% |
| 60–69% | 11 | 65% | 82% |
| 70–79% | 5 | 74% | 100% |
| 80–89% | 22 | 86% | 100% |
| 90–100% | 22 | 95% | 100% |
<!-- scoreboard:end -->

### What changed

- **Bills (the worst detector, recall 60.6% → 83.0%).** A recurring run was only the charges within 10% of the typical amount. So the power bill and the card's monthly payment, whose amounts move every month, were never bills: "Coming up" and the cash forecast missed every one. Now charges in `VARIABLE_BILL_CATEGORIES` form a run on their regular timing alone (`src/detection/streams.ts`).
- **Income (recall 87.3% → 100%).** Social Security ("SSA TREAS") and pensions were uncategorized, so a retiree's whole income was missing. Because of that, "how you're paid" was unknown and the emergency fund suggestion said "I'm not sure (0%)". They are now `INCOME_RETIREMENT_PENSION`, and a pay pattern that isn't known yet no longer pulls a suggestion's confidence to 0%.
- **Double charges.** The suggestion and the finding disagreed. The suggestion called a refunded double, or two lunches, a double charge: right 14 times in 28 before the ticket pairs were added. Now the suggestion uses the finding's own definition (`duplicatePairs`). Both treat an identical restaurant bill of $30 or more (`DUPLICATE_CHARGE_MEAL_MIN_CENTS`) on the next day as a double charge, and a $12.50 lunch twice as normal. Two identical tickets bought together still look exactly like a double charge in the data. That is why precision is 61% and the card asks "Charged twice?" rather than saying so.

### Known misses (left for later)

- **Subscriptions billed through Apple at mixed amounts** ("APPLE.COM/BILL", 11 people). One merchant, several prices: neither a steady subscription nor Apple Store shopping can be told apart from the amounts alone.
- **Yearly subscriptions seen once** (Amazon Prime, 9) and **two-month histories** (under three charges of anything).
- **Card companies the rules don't know** (Barclaycard, 6 bills and 56 transfers). Matching a checking payment to the card's "thank you" on the same day would find any issuer.

## Life facts

Jane paints a rough picture of the person from their payments (founder, 2026-10-26; `docs/life-facts.md`): kids, a new baby, a pet, school, own or rent, a car, the commute, travel, the gym, how they eat, a side gig, health costs and a recent move. The bench has the truth for each, so they are scored like the detectors: one item per person the fact is true of.

- **Truth:** `src/accuracy/life.ts` decides each person's life from its own dice (a separate stream, so the other detectors' people did not change), writes the rows a bank export would show, and keeps the decoys that must not count: a toy bought as a gift, one pet-shop trip, an online course, a single yoga class, a truck rented for a friend's move, one dental visit, one or two trips. How someone eats is decided from the food rows the generator wrote (eating out is 60% or more of food spending, cooking 35% or less), not from a category.
- **What is scored:** the fact's value from `buildProfile` (a guess counts, since Jane says "probably"), against that truth. `life_remote` is the weakest by design: it is a guess from an absence (a salary, no commute payments, few fill-ups).
- **Calibration:** the same bucket check as the suggestions, on each life fact's own percentage; the gate fails when a bucket of 10 or more is over 10 points surer than it turns out to be.
- **Honest limits.** The bench is synthetic, and the thresholds were tuned while reading it, so the 100% rows are not a promise for real data. Thin spots: `life_new_baby` (1 person), `life_student` (2) and `life_moved` (2) have too few examples to say much, and a history under three or four months cannot show a commute or a side gig.
- **Found by running it:** a daycare called "Little Sprouts" was filed as groceries (the Sprouts rule), which made someone who eats out look like a cook; restaurants without a card category were uncategorized; a marketplace deposit (Etsy, eBay) was filed as a purchase, not income; furniture and moving were not recognised, so the step-100 "moved" guess never fired. The categorizer rules now know these (`src/categorize/rules.ts`).

<!-- life:start -->
| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| life_kids | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| life_new_baby | 100.0% | 100.0% | 0.0% | 1 | 0 | 0 |
| life_pet | 100.0% | 100.0% | 0.0% | 15 | 0 | 0 |
| life_student | 100.0% | 100.0% | 0.0% | 2 | 0 | 0 |
| life_owner | 100.0% | 100.0% | 0.0% | 5 | 0 | 0 |
| life_renter | 100.0% | 100.0% | 0.0% | 35 | 0 | 0 |
| life_car | 100.0% | 100.0% | 0.0% | 27 | 0 | 0 |
| life_commuter | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| life_remote | 75.0% | 85.7% | 5.0% | 6 | 2 | 1 |
| life_travels | 100.0% | 100.0% | 0.0% | 9 | 0 | 0 |
| life_gym | 100.0% | 100.0% | 0.0% | 15 | 0 | 0 |
| life_cooks | 100.0% | 100.0% | 0.0% | 18 | 0 | 0 |
| life_eats_out | 100.0% | 100.0% | 0.0% | 18 | 0 | 0 |
| life_side_gig | 100.0% | 83.3% | 0.0% | 5 | 0 | 1 |
| life_health_costs | 100.0% | 100.0% | 0.0% | 3 | 0 | 0 |
| life_moved | 100.0% | 100.0% | 0.0% | 2 | 0 | 0 |

Life facts' calibration now:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 41 | 43% | 95% |
| 50–59% | 35 | 58% | 100% |
| 60–69% | 6 | 62% | 100% |
| 70–79% | 6 | 74% | 100% |
| 80–89% | 28 | 87% | 100% |
| 90–100% | 63 | 95% | 100% |
<!-- life:end -->

## Calibration

Suggestions say how sure Jane is as a percentage. The bench buckets them and checks how often each is right. The topics it can judge are subscriptions, price rises, bank fees, double charges, card interest, idle cash and the emergency fund.

Before:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 9 | 0% | 100% |
| 50–59% | 25 | 57% | 76% |
| 60–69% | 5 | 62% | 80% |
| 70–79% | 5 | 73% | 80% |
| 80–89% | 34 | 86% | **79%** |
| 90–100% | 28 | 95% | **79%** |

At the top, Jane was surer than it was right. Almost all of the wrong ones were double charges: a generic months-and-matches percentage gave "Charged twice?" 83% or more on a long history. And nine suggestions said 0%.

After: "Charged twice?" is never surer than `DUPLICATE_CHARGE_MAX_PERCENT` (65%), which is how often it's right on the bench. No suggestion says 0%. The table is under "Calibration now" in the scoreboard block above.

What's left is under-confidence: "86% sure" is right every time here. I didn't raise the percentages to match. The bench's people are cleaner than real bank data (every subscription is a subscription, every saver has idle cash), so raising them would be tuning to my own generator. The gate only checks the safe direction: never more than 10 points surer than right. Raise the percentages from real outcomes: the verified savings record (#729) tracks which suggestions were acted on and paid off.
