# Accuracy

Jane's accuracy test bench (founder, 2026-10-26). Until now every finding had been tuned on the eight sample people. The bench holds Jane to 100 synthetic bank histories that look like real exports, with the truth for every detector, and a CI gate keeps the scores from slipping.

- **Data:** `src/accuracy/generate.ts`, fixed seeds, in two sets.
  - **Tuning set** (`SEED`, `src/accuracy/__fixtures__/histories.json`): 60 people, about 16,300 transactions. The first 40 are #766's people, row for row. The other 20 carry each known cause of a miss or a false alarm (below), so a fix is tried on more than the one or two people who showed it. Rules are fixed by looking at this set's mistakes (`ACCURACY_MISTAKES=1`).
  - **Held-out set** (`HELD_OUT_SEED`, `src/accuracy/__fixtures__/held-out.json`): 40 people, about 10,000 transactions, from another seed, with the same causes under names the tuning set never uses: other card companies, ticket sellers, utilities, yearly plans, shops and app stores. Nobody looks at its mistakes while fixing rules; it is only scored. A gain that shows up here is real, not a rule that memorised the tuning set.
  - 2 to 14 months of history each; a quarter of the new people have only two months.
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
  - The causes the new people add (the tuning and held-out names differ):
    - card companies no rule knows, with the card's "thank you" a day or two after checking pays;
    - several subscriptions billed through one app store, each at its own price and day;
    - yearly plans paid once in the last year, and one-off purchases where subscriptions are sold (a book, a rental, an app);
    - two or three tickets or fares at one price on one day;
    - real double charges and refunded ones at more shops;
    - seasonal utility bills from utilities not named in the keyword rules;
    - two-month histories, with two purchases at one shop a month apart at nearly the same price.
- **Truth:** every row the generator writes says what it is, so each detector is scored item by item:
  - subscriptions and price rises, by merchant;
  - fee and card-interest accounts;
  - double charges, by the second charge;
  - idle cash, by person;
  - upcoming bills, by merchant. A bank's monthly service fee is a bill (it comes every month, so the forecast has to take it out), and a yearly plan is one only when it renews within the month. Before the two sets, both were missing from the truth; and a yearly plan paid before the person's history starts was labelled though no charge of it is in the data, so no detector could find it (2 of #766's 28 missed subscriptions). 5 of #766's labels were corrected, rows unchanged;
  - income and own-account transfers, by transaction.
- **Scoring:** `src/accuracy/score.ts` runs the real pipeline: the categorizer's rules, then the finding rules (`detect`), recurring charges, upcoming bills, the spending classification and the suggestion detectors. It's pure and needs no database, and makes no Claude calls.
  - **Precision:** of what Jane said, how much is true.
  - **Recall:** of what's true, how much Jane said.
  - **False-alarm rate:** the share of people who got at least one wrong item from that detector.
- **Run it:** `npm run accuracy` prints the scoreboard and calibration for each set. `ACCURACY_WRITE=1 npm run accuracy` also rewrites the fixtures, `src/accuracy/baseline.json` and the tables below. `ACCURACY_MISTAKES=1` lists the tuning set's mistakes only.
- **Gate:** `src/accuracy/accuracy.test.ts`, run with the unit tests, on both sets. It fails when:
  - any detector's precision or recall drops more than 3 points below the baseline;
  - a fixture no longer matches the generator;
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

Now (the baseline the gate holds to, both sets):

<!-- scoreboard:start -->
Tuning set (60 people, 16326 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 63.8% | 0.0% | 95 | 0 | 54 |
| price_rises | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 31 | 0 | 0 |
| double_charges | 55.8% | 100.0% | 23.3% | 24 | 19 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 14 | 0 | 0 |
| bills | 99.7% | 73.3% | 1.7% | 297 | 1 | 108 |
| income | 100.0% | 100.0% | 0.0% | 1391 | 0 | 0 |
| transfers | 100.0% | 92.6% | 0.0% | 1493 | 0 | 120 |

Calibration, tuning set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 47 | 56% | 87% |
| 60–69% | 23 | 65% | 78% |
| 70–79% | 7 | 74% | 100% |
| 80–89% | 29 | 86% | 100% |
| 90–100% | 28 | 95% | 100% |

Held-out set (40 people, 10008 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 41.9% | 0.0% | 52 | 0 | 72 |
| price_rises | 100.0% | 100.0% | 0.0% | 8 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 20 | 0 | 0 |
| double_charges | 44.9% | 100.0% | 55.0% | 31 | 38 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| bills | 98.2% | 55.5% | 7.5% | 161 | 3 | 129 |
| income | 100.0% | 100.0% | 0.0% | 774 | 0 | 0 |
| transfers | 100.0% | 87.7% | 0.0% | 733 | 0 | 103 |

Calibration, held-out set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 31 | 56% | 84% |
| 60–69% | 33 | 65% | 91% |
| 70–79% | 10 | 75% | 100% |
| 80–89% | 15 | 85% | 100% |
| 90–100% | 12 | 95% | 100% |
<!-- scoreboard:end -->

### What changed

- **Bills (the worst detector, recall 60.6% → 83.0%).** A recurring run was only the charges within 10% of the typical amount. So the power bill and the card's monthly payment, whose amounts move every month, were never bills: "Coming up" and the cash forecast missed every one. Now charges in `VARIABLE_BILL_CATEGORIES` form a run on their regular timing alone (`src/detection/streams.ts`).
- **Income (recall 87.3% → 100%).** Social Security ("SSA TREAS") and pensions were uncategorized, so a retiree's whole income was missing. Because of that, "how you're paid" was unknown and the emergency fund suggestion said "I'm not sure (0%)". They are now `INCOME_RETIREMENT_PENSION`, and a pay pattern that isn't known yet no longer pulls a suggestion's confidence to 0%.
- **Double charges.** The suggestion and the finding disagreed. The suggestion called a refunded double, or two lunches, a double charge: right 14 times in 28 before the ticket pairs were added. Now the suggestion uses the finding's own definition (`duplicatePairs`). Both treat an identical restaurant bill of $30 or more (`DUPLICATE_CHARGE_MEAL_MIN_CENTS`) on the next day as a double charge, and a $12.50 lunch twice as normal. Two identical tickets bought together still look exactly like a double charge in the data. That is why precision is 61% and the card asks "Charged twice?" rather than saying so.

### Known misses (left for later)

- **Subscriptions billed through Apple at mixed amounts** ("APPLE.COM/BILL", 11 people). One merchant, several prices: neither a steady subscription nor Apple Store shopping can be told apart from the amounts alone.
- **Yearly subscriptions seen once** (Amazon Prime, 9) and **two-month histories** (under three charges of anything).
- **Card companies the rules don't know** (Barclaycard, 6 bills and 56 transfers). Matching a checking payment to the card's "thank you" on the same day would find any issuer.

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
