# Accuracy

Jane's accuracy test bench (founder, 2026-10-26). Until now every finding had been tuned on the eight sample people. The bench holds Jane to 140 synthetic bank histories that look like real exports, with the truth for every detector, and a CI gate keeps the scores from slipping.

- **Data:** `src/accuracy/generate.ts`, fixed seeds, in two sets.
  - **Tuning set** (`SEED`, `src/accuracy/__fixtures__/histories.json`): 60 people, about 16,300 transactions. The first 40 are #766's people, row for row. The other 20 carry each known cause of a miss or a false alarm (below), so a fix is tried on more than the one or two people who showed it. Rules are fixed by looking at this set's mistakes (`ACCURACY_MISTAKES=1`).
  - **Held-out set** (`HELD_OUT_SEED`, `src/accuracy/__fixtures__/held-out.json`): 40 people, about 10,000 transactions, from another seed, with the same causes under names the tuning set never uses: other card companies, ticket sellers, utilities, yearly plans, shops and app stores. Nobody looks at its mistakes while fixing rules; it is only scored. A gain that shows up here is real, not a rule that memorised the tuning set.
  - **Second held-out set** (`HELD_OUT_2_SEED`, `src/accuracy/__fixtures__/held-out-2.json`): 40 more people, with names neither of the others uses. Once the first held-out set's mistakes have been read to explain them, it is no longer a clean check; any fix those mistakes suggest is checked here instead.
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
- **Gate:** `src/accuracy/accuracy.test.ts`, run with the unit tests, on all three sets. It fails when:
  - any detector's precision or recall drops more than 3 points below the baseline;
  - a fixture no longer matches the generator;
  - any suggestion says 0%;
  - a calibration bucket of 10 or more is over 10 points surer than it turns out to be.

  A change that makes a detector better passes; record the new baseline with it so the gain is kept.

## Scoreboard

Before #766: the detectors as on main then (with #759's messy-bank fixes), on its 40 people.

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

Now (the baseline the gate holds to, every set):

<!-- scoreboard:start -->
Tuning set (60 people, 16326 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 100.0% | 0.0% | 149 | 0 | 0 |
| price_rises | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 31 | 0 | 0 |
| double_charges | 100.0% | 100.0% | 0.0% | 24 | 0 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 14 | 0 | 0 |
| bills | 100.0% | 99.8% | 0.0% | 404 | 0 | 1 |
| income | 100.0% | 100.0% | 0.0% | 1391 | 0 | 0 |
| transfers | 100.0% | 100.0% | 0.0% | 1613 | 0 | 0 |

Calibration, tuning set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 43 | 56% | 100% |
| 60–69% | 18 | 65% | 100% |
| 70–79% | 7 | 74% | 100% |
| 80–89% | 31 | 86% | 100% |
| 90–100% | 33 | 95% | 100% |

Held-out set (40 people, 10008 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 99.2% | 0.0% | 123 | 0 | 1 |
| price_rises | 100.0% | 100.0% | 0.0% | 8 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 20 | 0 | 0 |
| double_charges | 100.0% | 100.0% | 0.0% | 31 | 0 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| bills | 100.0% | 99.7% | 0.0% | 289 | 0 | 1 |
| income | 100.0% | 100.0% | 0.0% | 774 | 0 | 0 |
| transfers | 100.0% | 99.6% | 0.0% | 833 | 0 | 3 |

Calibration, held-out set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 26 | 56% | 100% |
| 60–69% | 31 | 65% | 100% |
| 70–79% | 10 | 75% | 100% |
| 80–89% | 18 | 85% | 100% |
| 90–100% | 12 | 95% | 100% |

Second held-out set (40 people, 10748 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 99.2% | 0.0% | 124 | 0 | 1 |
| price_rises | 100.0% | 100.0% | 0.0% | 4 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 21 | 0 | 0 |
| double_charges | 100.0% | 100.0% | 0.0% | 20 | 0 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 12 | 0 | 0 |
| bills | 100.0% | 99.6% | 0.0% | 284 | 0 | 1 |
| income | 100.0% | 100.0% | 0.0% | 780 | 0 | 0 |
| transfers | 100.0% | 99.8% | 0.0% | 888 | 0 | 2 |

Calibration, second held-out set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 29 | 57% | 100% |
| 60–69% | 18 | 64% | 100% |
| 70–79% | 8 | 75% | 100% |
| 80–89% | 19 | 86% | 100% |
| 90–100% | 19 | 95% | 100% |

Third held-out set (40 people, 9384 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 100.0% | 0.0% | 117 | 0 | 0 |
| price_rises | 100.0% | 100.0% | 0.0% | 5 | 0 | 0 |
| fees | 100.0% | 91.7% | 0.0% | 11 | 0 | 1 |
| double_charges | 100.0% | 100.0% | 0.0% | 33 | 0 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 5 | 0 | 0 |
| bills | 99.6% | 99.6% | 2.5% | 273 | 1 | 1 |
| income | 100.0% | 100.0% | 0.0% | 680 | 0 | 0 |
| transfers | 100.0% | 99.7% | 0.0% | 768 | 0 | 2 |

Calibration, third held-out set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 40 | 55% | 100% |
| 60–69% | 16 | 66% | 100% |
| 70–79% | 8 | 73% | 100% |
| 80–89% | 12 | 85% | 100% |
| 90–100% | 8 | 95% | 100% |
<!-- scoreboard:end -->

### What changed in #766

- **Bills (the worst detector, recall 60.6% → 83.0%).** A recurring run was only the charges within 10% of the typical amount. So the power bill and the card's monthly payment, whose amounts move every month, were never bills: "Coming up" and the cash forecast missed every one. Now charges in `VARIABLE_BILL_CATEGORIES` form a run on their regular timing alone (`src/detection/streams.ts`).
- **Income (recall 87.3% → 100%).** Social Security ("SSA TREAS") and pensions were uncategorized, so a retiree's whole income was missing. Because of that, "how you're paid" was unknown and the emergency fund suggestion said "I'm not sure (0%)". They are now `INCOME_RETIREMENT_PENSION`, and a pay pattern that isn't known yet no longer pulls a suggestion's confidence to 0%.
- **Double charges.** The suggestion and the finding disagreed. The suggestion called a refunded double, or two lunches, a double charge: right 14 times in 28 before the ticket pairs were added. Now the suggestion uses the finding's own definition (`duplicatePairs`). Both treat an identical restaurant bill of $30 or more (`DUPLICATE_CHARGE_MEAL_MIN_CENTS`) on the next day as a double charge, and a $12.50 lunch twice as normal. Two identical tickets bought together still look exactly like a double charge in the data. That is why precision is 61% and the card asks "Charged twice?" rather than saying so.

### Known misses after #766

All three were fixed in round 2, below.

- **Subscriptions billed through Apple at mixed amounts** ("APPLE.COM/BILL", 11 people). One merchant, several prices: neither a steady subscription nor Apple Store shopping can be told apart from the amounts alone.
- **Yearly subscriptions seen once** (Amazon Prime, 9) and **two-month histories** (under three charges of anything).
- **Card companies the rules don't know** (Barclaycard, 6 bills and 56 transfers). Matching a checking payment to the card's "thank you" on the same day would find any issuer.

## Round 2: the weak detectors (2026-10-26)

Each fix was made by reading the tuning set's mistakes only. The held-out sets were scored, not read, until the tuning-set rules were final; where a held-out mistake then suggested a fix, it says so, and the second held-out set is the clean check for it.

- **Double charges (precision 55.8% → 100% on the tuning set, 44.9% → 100% and 42.6% → 100% held out; recall stays 100%).** Every false "Charged twice?" was a group buying a seat each: two or three tickets or fares at one price on one day. Those are left out now: Plaid's event and flight categories (`DUPLICATE_CHARGE_PER_SEAT_CATEGORIES`), ticket sellers filed as events by the keyword rules (Ticketmaster, Live Nation, StubHub, SeatGeek and others), and cinemas by name (`DUPLICATE_CHARGE_PER_SEAT_WORDS`; Plaid files cinemas with streaming, where a double charge is real). Two bank fees on one day aren't a double charge either: the bank fees finding asks for those back. The cinema and bank-fee rules came from reading the first held-out set's mistakes (seats at AMC, two overdraft fees in a day); the second held-out set, with a cinema and ticket seller of its own, confirms them. A real double charge at a ticket seller is now missed; the card's dispute process still covers it.
- **Own-account transfers (recall 92.6% → 100% on the tuning set, 87.7% → 99.6% and 82.4% → 99.8% held out; precision stays 100%).** Every miss was a card payment from checking written by a card company no keyword rule knows ("BARCLAYCARD US PAYMENT"), so it counted as spending, and the card payment was missing from "Coming up". The card's own side always says what it is ("Payment Thank You", the bank's "Payment" type). Now an outflow from a bank account of the same amount within `CARD_PAYMENT_MATCH_DAYS` (3) of the card's payment is that payment, whichever company wrote it (`src/categorize/card-payments.ts`). It runs after every CSV import, over all the person's accounts, so it works whichever account was imported first; it only changes rows with no category or Claude's guess, never the person's own or Plaid's (Plaid names card payments itself). What's left: a payment made on the last day, before the card posted its side.
- **Subscriptions (recall 63.8% → 100% on the tuning set at 100% precision).** By cause:
  - *Several subscriptions billed through an app store* ("APPLE.COM/BILL" at $0.99 and $10.99, on different days). Apple, iTunes and Google Play (`BILLING_PLATFORM_MERCHANTS`) are split by exact price: each price that comes regularly is a subscription of its own, keyed `merchant:apple@1099` after the first so every card stays separate. One-off app purchases at other prices aren't.
  - *Yearly plans seen once* (Amazon Prime). One charge in a year, between $50 and $500 (`YEARLY_PLAN_MIN_CENTS`, `YEARLY_PLAN_MAX_CENTS`), under the plan's own name (a `SUBSCRIPTION_MERCHANTS` name, alone or with "plus", "premium" and the like) is a yearly plan, at low confidence.
  - *Two-month histories.* Two charges a month apart are enough where a repeat can only be a bill or a subscription (`SHORT_RUN_CATEGORIES`: rent, utilities, phone, insurance, loan and card payments, monthly bank fees, streaming, music, gyms; and subscription merchants), at low confidence. Two purchases at a shop a month apart still aren't.
  - Payments on a debt or moves of money are never a subscription, whatever the name ("APPLE CARD PAYMENT").
- **Bills (recall 73.3% → 99.8% on the tuning set, 55.5% → 96.9% and 54.7% → 94.0% held out).** Mostly the same causes (app stores, two-month histories, yearly plans renewing within the month), plus utilities named for what they sell ("XCEL ENERGY", "SOUTHERN CALIFORNIA EDISON", "... UTILITIES"), now filed as utilities so their seasonal amounts form a bill. A run that is only a few of a shop's many charges, at prices that just look alike, is no longer a bill (a grocer's bills that happened to land a month apart; `RUN_MIN_SHARE_OF_CHARGES`).
- **Fixes the first held-out set's mistakes suggested.** With only the tuning-set fixes, the first held-out set showed 9 false subscriptions (subscriptions precision 93.2%) and the second 4 (96.8%). Reading the first set's: one-off "ADOBE STOCK" purchases over $50 read as a yearly Adobe plan, and app-store purchases and fixed-price coffee were split into "subscriptions" by price. So a yearly plan now needs the plan's own name, and splitting by price is for app stores only. The first held-out set went to 100% precision; it was read, so that number no longer proves anything. The second held-out set stayed at 96.8%: its 4 have a different cause (below).

### Before and after

Each cell is precision / recall.

| Detector | Set | Before (main) | After | Target |
| --- | --- | ---: | ---: | --- |
| Subscriptions | Tuning (60) | 100% / 63.8% | **100% / 100%** | recall ≥ 90% at precision ≥ 98% ✅ |
| | Held-out (40) | 100% / 41.9% | 100% / 99.2% (93.2% precision before the fixes it suggested) | ✅ (read) |
| | Second held-out (40) | 100% / 38.4% | **96.8% / 96.0%** | ❌ precision, see below |
| Double charges | Tuning | 55.8% / 100% | **100% / 100%** | precision ≥ 90%, recall ≥ 95% ✅ |
| | Held-out | 44.9% / 100% | 100% / 100% | ✅ |
| | Second held-out | 42.6% / 100% | **100% / 100%** | ✅ |
| Bills | Tuning | 99.7% / 73.3% | **100% / 99.8%** | recall ≥ 90% ✅ |
| | Held-out | 98.2% / 55.5% | 98.9% / 96.9% | ✅ |
| | Second held-out | 99.4% / 54.7% | **99.6% / 94.0%** | ✅ |
| Transfers | Tuning | 100% / 92.6% | **100% / 100%** | recall ≥ 98% ✅ |
| | Held-out | 100% / 87.7% | 100% / 99.6% | ✅ |
| | Second held-out | 100% / 82.4% | **100% / 99.8%** | ✅ |

Income, fees, price rises, card interest and idle cash were 100% / 100% before and still are, on every set.

### What's left, and why

- **Subscriptions on the second held-out set (precision 96.8%, target 98%).** All 4 false alarms are a "PELOTON* APPAREL" purchase of $60–$120. The bank's description is cut at the `*`, so it reads "PELOTON", the same name as Peloton's membership: seen once, a $100 purchase and a yearly plan look exactly alike. Reaching 98% here means dropping the yearly-plan rule, which costs every yearly plan (all are seen once). One more charge from the merchant settles it either way, and meanwhile the card is low confidence and doesn't count toward money found. The 5 misses are Microsoft 365 (the bank writes "MICROSOFT", not on the subscription list because Microsoft also sells one-off software) and one Dropbox plan.
- **Bills.** Utilities whose names don't say what they sell ("GEORGIA POWER", "PSE&G", "ENTERGY", "FPL", "ALABAMA POWER") aren't found by the keyword rules; a bare "POWER" would also catch "POWER YOGA". Claude categorizes them when it's on (the bench runs without it). Weekly fixed-price coffee shows as coming up (3 on the first held-out set, 1 on the second): regular, but not a bill. A two-month history with one card payment in it can't show a pattern yet.
- **Transfers.** A card payment made on the last day of the data, before the card posted its side (5 across both held-out sets).
- **Next time.** Both held-out sets have now been read. Fixes for the misses above need a third held-out set, made before they are written.

## Round 3: the yearly-plan false alarms (2026-10-27)

- **A third held-out set** (`HELD_OUT_3_SEED`, `src/accuracy/__fixtures__/held-out-3.json`, 40 people): new card companies, ticket sellers, utilities, yearly plans ("MSFT * MICROSOFT 365 FAMILY", "LINKEDIN PREMIUM", "PATREON* MEMBERSHIP") and goods from subscription companies' shops ("NYTIMES*STORE", "DUOLINGO*MERCH SHOP"). It was generated and scored before the fix below was written: subscriptions 87.6% precision / 96.6% recall (16 false alarms). Caveat: the same person wrote the set and the fix, so the shop words in it are words anyone would put on such a list; it checks the rule generalises across companies, not across wording no one thought of.
- **Fix (second held-out set: 96.8% → 100% precision, 96.0% → 99.2% recall; third: 87.6% → 100% / 96.6% → 100%).**
  - A single charge with a shop word in its description (`YEARLY_PLAN_GOODS_WORDS`: apparel, store, shop, merch, gear, gift and the like) is something the company sells, not its yearly plan ("PELOTON* APPAREL").
  - The plan's own name after the bank's `*` counts, with a one-letter cut-off end dropped ("MICROSOFT*MICROSOFT 365 P" is Microsoft 365, though the merchant reads "Microsoft"); plan tiers (family, personal, individual, student) join `YEARLY_PLAN_WORDS`. A yearly plan found this way is a subscription whatever its category (`Stream.namedPlan`).
  - Tuning and first held-out set unchanged (100% precision on both).
- **Left:** one Dropbox plan switched from monthly to yearly in the same year (second held-out set); the monthly run has ended and the yearly charge sits among monthly ones, so neither rule takes it.
- **Bills: a weekly habit isn't coming up** (held-out 98.9% → 100% precision, second 99.6% → 100%, third 98.6% → 99.6%; recall unchanged). The same coffee at one price every week or two was listed in "Coming up" as a bill. Streams in `NOT_BILL_HABIT_PRIMARIES` (food and drink) at `NOT_BILL_HABIT_FREQUENCIES` (weekly, every two weeks) are left out (`isComingUp`, `src/detection/forecast.ts`). The cause was read on the first two held-out sets; the third, scored and not read, is the check.
- **A usage bill no rule knows by name, by its shape** (round 11). A water or power company under a name the keyword rules don't know had no category, so its moving amounts never made a run, and it was missing from "Coming up". Now no category, one charge in each month, on days at most `USAGE_BILL_DAY_SPREAD` (5) apart, at least `USAGE_BILL_MIN_CHARGES` (3) times, counts as a bill whose amount moves, like `VARIABLE_BILL_CATEGORIES`. "Coming up" recall:

  | Set | Before | After |
  | --- | ---: | ---: |
  | CSV first held-out | 94.6% | 100% |
  | CSV second held-out | 95.3% | 99.1% |
  | Sample first held-out | 96.9% | 98.6% |
  | Sample second held-out | 94.4% | 98.6% |

  Precision is unchanged, and CSV held-out price-rise precision rose from 93.8% to 100%. The tuning sets are unchanged.
- **Well-known chains by name, and more kinds of place by their words** (round 12). Most of what the rules couldn't place on the held-out CSV sets was a national or international chain the lists didn't name. From general knowledge (never from the held-out rows), the rules now name the big grocers, fuel stations, fast food and restaurant chains, department, discount, sporting-goods and craft stores, hotels, airlines, rental cars, rail and transit (TfL, MTA, BART, Clipper and others), tolls, phone, cable, power, water and waste companies, large landlords (Greystar and others), insurers, car services, childcare and donations, plus kind words (curry, creamery, florist, cleaners, daycare, fitness and so on). They sit below the first name lists, so a name above still wins; words many names share (GAP, EXPRESS, CAMDEN, LIME, PATH) are left out, and USAA is named only as an insurer, since it is a bank too (its transfers dropped the third sample held-out set's transfer recall to 95% before that). Category right, rules only:

  | Set | Before | After |
  | --- | ---: | ---: |
  | CSV tuning | 98.3% | 99.8% |
  | CSV first held-out | 65.9% | 94.2% |
  | CSV second held-out | 75.5% | 91.5% |

  Bills recall on the sample bench also rose (first held-out 98.6% → 99.7%, second 98.6% → 99.6%); everything else is unchanged.

  **Checked on a fresh set.** The first two held-out pools were written before the list, by the same hand, so a gain there could be the list and the pools sharing the same well-known names. A third held-out CSV set (`CSV_HELD_OUT_3_SEED`, new names, written after the list and spelled the way statements cut names: "CULVERS", "OLLIES", "HOBBY-LOBBY", plus regional chains and local places) gains much less: category right 71.0% → 79.6% (+8.6 points, against +28.3 and +16.0). By merchant, the rules place 36 of its 82 names before and 50 after. So most of the first held-out jump came from names its pool happens to share with the list; the third set's gain is the better estimate of what the list adds on real statements, and it is a harsh one, since its names were picked knowing the list. Of the 850 words added, 759 are company names (real companies, counting spellings such as KOHL'S and KOHLS apart) and 91 are generic words (curry, florist, daycare, toll, museum). The third set is only scored: no rule is fixed on it.

- **Subscriptions by their own words** (round 13, second tuning set). A charge that says it is a plan counts as a subscription whatever the company's category: a membership word (`PLAN_DESCRIPTION_WORDS`: membership, subscription, DashPass, Uber One, Lyft Pink) or a name ending in "+" (`PLAN_NAME_PLUS`: Walmart+, Instacart+, AMC+). Its charges make a run of their own when the same company's other charges are mostly at other prices (Uber One among the rides, key `@plan`), but not when they are the plan written another way. One charge that says it renews the year (`YEARLY_RENEWAL_WORDS`: annual, yearly, renewal, membership) is a yearly plan, whoever the company. Autodesk joins `SUBSCRIPTION_MERCHANTS` (software above the price-only cap). Subscriptions recall:

  | Set | Before | After |
  | --- | ---: | ---: |
  | CSV second tuning | 48.2% | 98.8% |
  | CSV first held-out | 82.7% | 91.3% |
  | CSV second held-out | 86.0% | 97.8% |
  | CSV third held-out | 91.3% | 100% |

  Two more from the second tuning set: two plans from one company at two prices stay two when one of them has most of the charges (Google One at $2.99 and $9.99; the run of the whole had kept only the $9.99 one), and a city's utility bill (`RENT_AND_UTILITIES_OTHER_UTILITIES`) is no price rise, like power and water. "Coming up" recall rose with them (first held-out 98.6% → 100%, second 97.7% → 99.1%, third 99.1% → 100%). Precision is unchanged on every set (100%, and 74.8% → 76.5% on the third held-out set as more are found); the first tuning set and the sample bench are unchanged. Left on the second tuning set: a plan seen three times whose price rose on the third (two charges at the old price are too few for a run).

- **Fixed monthly amounts that aren't plans** (round 14, second tuning set). The second tuning set now carries the not-a-plan charges real statements have: buy-now-pay-later instalments ("AFFIRM *PAY", "KLARNA* NIKE"), a car lender ("LAKESHORE AUTO FIN"), a robo-investing deposit ("ACORNS INVEST"), homeowners' association dues, a chapel and a temple, home insurance by its premium, a pastry shop. As first scored they made 33 false subscription alarms (precision 71.3%). The rules now read buy-now-pay-later and car lenders as loan payments, investing apps and brokerages as investment transfers, HOA dues as a home bill, chapels, temples, synagogues and mosques as gifts (last of the words, so "IRON TEMPLE GYM" stays a gym), and pastry shops as food; each of those is a category no subscription comes from. Second tuning set: subscriptions precision 71.3% → 97.6%, category right 94.9% → 98.6%. Left: "HOMESHIELD PREMIUM" (premium is a plan word too: YouTube Premium), for Claude. The held-out sets are unchanged, the third set's 32 false alarms included: they are not these kinds. "AUTO PMT" was tried as a car-loan word and dropped: it is how banks write autopay on any bill, and it tripled the first held-out set's false "Charged twice?".

- **Two orders are not one charge twice** (round 14, second tuning set). The second tuning set now also has same-price pairs on one day that aren't double charges: two orders from one shop, each with its own order number ("AMZN Mktp US*2K4L91Z3" and "AMZN Mktp US*7HQ2MX0PB"), and a service paid per person (two kids' haircuts, two copays). As first scored: 25 false "Charged twice?". Two charges whose order numbers after the processor's "*" differ (`DUPLICATE_CHARGE_ORDER_NUMBER`, a token with a digit) are now two orders: 25 → 14. A service paid per person was tried as a seat each (hair, doctor, dentist, eye care) and dropped: it took a real double charge away from the first held-out set. The 13 per-person pairs are left (nothing on a statement tells two haircuts from one run twice). Held-out sets unchanged.

- **Software and radio under the names statements use** (round 15, second tuning set). Intuit (QuickBooks), Autodesk and other business software by the month, tax software and preparers (TurboTax, H&R Block) as accounting, SiriusXM written with a space, and Capital One's checking paying a Bank of America card. Second tuning set category right 98.6% → 99.4%; what's left is rent paid by cheque (a cheque could be anything) and an insurer known only by "premium". Held-out sets unchanged.

- **Plans and bills on other cadences** (round 16, second tuning set). The second tuning set now has charges that aren't monthly: a meal kit every week (HelloFresh, Factor), a plan every four weeks (a gym, BarkBox), and a water bill and insurance every quarter. As first scored: subscriptions recall 90.8%, "Coming up" recall 94.1%, $/yr found $52,583 of $90,835. Three fixes:
  - a plan billed every four weeks to the day counts 13 times a year, not 12 (`FOUR_WEEKLY_*`)
  - a box sold by subscription (`SUBSCRIPTION_BOX_MERCHANTS`: meal kits, BarkBox, Ipsy and so on) is a subscription whatever its category, and never a weekly food habit in "Coming up". It's matched on the charges' words too, since the merchant name drops "FACTOR75". It's kept out of `SUBSCRIPTION_MERCHANTS`, so one order is never read as a yearly plan
  - two charges a quarter apart in a bill's category are a run (`SHORT_RUN_FREQUENCIES`)

  After: subscriptions recall 99.1%, "Coming up" 98.7%, $/yr found $92,413 of $90,835. Held-out sets and the sample bench are unchanged.

- **A price rise seen only three times** (round 17, second tuning set). Xbox Game Pass at $16.99, $16.99, $19.99 in a three-month history was neither a subscription nor a price rise: two charges at one price are too few for a run outside `SHORT_RUN_CATEGORIES`, and the third was off the price. Now two at one price and a third at the same gap one step up (no more than `FIXED_PRICE_SUBSCRIPTION_MAX_STEP`) are a run, when every charge at the merchant is in it (a shop's would have others; without that, the second and third held-out sets each gained a false bill in "Coming up"). Second tuning set: subscriptions recall 99.1% → 100%, price rises 75% → 100%. Held-out sets and the sample bench unchanged.

- **A plan paused for a month** (round 18, second tuning set). The second tuning set now has a plan that skipped one month and picked up again (a yoga studio's freeze, Crunchyroll paused). Its gaps weren't all monthly, so it had no cadence and was missed. Now one gap of about two intervals (`PAUSE_GAP_MULTIPLE`, at most `PAUSE_MAX_SKIPPED`) among at least `PAUSE_MIN_REGULAR_GAPS` regular ones keeps the cadence. Second tuning set: subscriptions recall 94.8% → 100%, "Coming up" 96.7% → 99.2%. Second held-out set: subscriptions recall 97.8% → 100%, "Coming up" 99.1% → 100%. Precision is unchanged everywhere; the other sets and the sample bench are unchanged.

- **One service paid from two cards** (round 19, second tuning set). The second tuning set now has a plan that moved to another card part-way, one billed on the month's last day, and one service paid from two cards on their own days (two people's plans). The first two were already found. The third wasn't: together the charges come at no one gap. Now, when a merchant's charges make no run as a whole, each account's charges are tried as a run of their own (the first keeps the merchant's key, the others are numbered, `@2`). Second tuning set: subscriptions recall 98.4% → 100%, "Coming up" 98.4% → 99.2%. Held-out sets and the sample bench unchanged.

- **A quarterly bill not due in the next 31 days** (bench truth, round 20). The second tuning set's truth expected every recurring bill in "Coming up", including a quarterly water bill paid two weeks ago and not due again for months; Jane was right to leave it out. A bill on another cadence is now expected only when its next charge falls in the 31 days, and otherwise is one Jane may list or not. Second tuning set "Coming up" recall 99.2% → 100%. Nothing in detection changed.

- **A plan switched from monthly to yearly** (round 21, second tuning set). The second tuning set now has plans paid monthly that switched to one yearly charge two months ago (Amazon Prime $14.99 then $139, Dropbox, and a plan no rule knows). All were missed: the monthly run took the yearly charge as its new price, and a no-category plan read as a usage bill that may move. Now a monthly plan that ended, then one charge at the same company worth `YEARLY_SWITCH_MIN_MONTHS` to `YEARLY_SWITCH_MAX_MONTHS` of it, is the plan paid by the year (key `@yearly`). A charge that size is never a run's new price, and never part of a usage bill. Second tuning set: subscriptions recall 97.0% → 100%. Held-out sets and the sample bench unchanged.

## CSV bench: the upload path, on bank files (2026-10-27)

Beta users start by uploading statements, so the sample people above (already-clean rows) can't show what goes wrong between a bank's CSV and Jane's numbers. The CSV bench holds the whole upload path to labelled statements, as the banks export them.

- **People:** `src/accuracy/csv/people.ts`, 20 synthetic people per set (none real), 3 to 6 months each, a checking account and one or two cards, some with savings. Every true transaction carries its category, and each person the truth for every finding: what should fire, what shouldn't (a group's tickets, a refunded double charge, coffee at one price every day, a pending copy), the $/yr Jane should show, net worth today and at each month end.
- **Files:** `src/accuracy/csv/layouts.ts` writes each account in its bank's layout: Chase checking and card, Bank of America checking (summary block above the header) and card, Wells Fargo (no header), Capital One 360 (two-digit years, unsigned amounts with a type) and card (ISO dates, debit and credit columns), Citi (pending rows in an export taken mid-month, payments as negative credits), American Express (half with "additional details": line breaks inside quotes), Discover, and a credit union's semicolon file with day-first dates and decimal commas (through the column picker, Jane's guesses accepted, the right column picked where it asks). Byte-order marks, Windows line ends, running balances, padded and cut descriptions ("AUTOMATIC PAYMENT - THANK"), each bank's ACH, Zelle, Venmo, transfer, ATM, fee and card-payment wording, and monthly files that overlap by a few days. The files are checked in (`src/accuracy/csv/__fixtures__/<set>/<person>/`, with a `truth.json` of what each person should see), so anyone can upload one person by hand.
- **Two sets.** The tuning set (`CSV_SEED`) is what rules were fixed on. The held-out set (`CSV_HELD_OUT_SEED`) has the same kinds of people and mess under names the tuning set never uses (other grocers, restaurants, landlords, utilities, employers, subscriptions, airlines and cinemas) and different banks per person. It was written before any fix and is only scored.
- **Scoring:** `src/accuracy/csv/score.ts` runs what `/import` runs, without a database: `readCsvFile` on every file, one copy of rows two files share, `categorizeTransactions` with Claude off and no cached merchants, card payments matched from the card's side, the merchant directory's seed, `detect()`, the spending chart's monthly totals and the home hub's net worth line. Claude is stubbed (`vi.mock`), so nothing is spent and the categories and subscriptions are the rules' alone: a lower bound. On a live upload Claude places what the rules leave, and is asked about recurring charges whose category can't say; the tables count both.
- **A second held-out set** (`CSV_HELD_OUT_2_SEED`, 2026-10-27). It has names neither other set uses (grocers, restaurants, landlords, utilities, phone and internet companies, employers, subscriptions, trials, cinemas, a twin plan, the not-a-plan traps) and the banks shifted again. It was made and scored before any fix it could check, so it is the clean check for rounds 7 and later. As first scored: category right 69.7%, subscriptions 100% / 85.5%, false "Charged twice?" 6, trials 100% / 80%, "Coming up" 99.5% / 95.3% (precision / recall).
- **A second tuning set** (`CSV_TUNING_2_SEED`, 2026-10-27, round 13). The first tuning set was used up: with every subscription's brand swapped for a name no rule knows, it still missed nothing but a yearly plan, so it could no longer show what the held-out sets miss. The second keeps the first one's shops and bills and brings the subscriptions people miss on real statements: a membership at a company that sells something else (Uber One, DashPass, Lyft Pink, Instacart+, Walmart+), software over $100 a month, a warehouse club's yearly renewal, plans billed through a processor. Rules may be fixed on it. As first scored: subscriptions 100% / 48.2%.
- **A third held-out set** (`CSV_HELD_OUT_3_SEED`, 2026-10-27, after round 12). New names again, written after round 12's chain list to check it (real chains of every size, spelled as statements cut them, and local places), and the banks shifted again. Only scored. As first scored, with round 12: category right 79.6%, subscriptions 74.8% / 91.3% (32 false alarms, the next thing to look into, from the tuning set), false "Charged twice?" 4, "Coming up" 100% / 99.1%.
- **Run it:** `npm run accuracy` prints both benches. `ACCURACY_WRITE=1` also rewrites the files, `src/accuracy/csv/baseline.json` and the tables below. `ACCURACY_MISTAKES=1` lists the tuning set's mistakes.
- **Calibration:** the suggestions an uploaded person would see, made from the upload's rows and only the balances Jane knows. They are bucketed by their "% sure" and judged on the same topics as the sample bench. Like the sample bench, they are under-confident on purpose ("58% sure" is right 94% of the time on the tuning set, 87% held out). The only wrong ones are two "build an emergency fund" suggestions for people near the idle-cash line. The gate holds the same bar: no 0%, no bucket of 10 or more over 10 points surer than right.
- **Gate:** `src/accuracy/csv/csv-accuracy.test.ts`, with the unit tests: the files must match the generator, every share in the baseline may drop at most 3 points, and extra rows and false "Charged twice?" may not rise at all.

<!-- csv-scoreboard:start -->
Tuning set (20 people, 155 files, 5444 transactions):

| Step | Score |
| --- | ---: |
| Files read | 155 of 155 (151 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 99.8% (11 left for Claude) |
| False "Charged twice?" | 0 (0 people) |
| Findings, $/yr | Jane $30,610, truth $30,610; error on the ones found 0.0% |
| Monthly spending, error | 0.0% |
| Monthly income, error | 0.0% |
| Net worth today right | 7 of 20 people (off by $52,333 in all) |
| Net worth line: month-ends drawn | 97.3% (error where drawn 19.1%) |
| Net worth line, people whose every balance Jane knows | 7 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 100.0% | 100.0% | 73 | 0 | 0 |
| price_increase | 100.0% | 100.0% | 8 | 0 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 17 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 10 | 0 | 0 |
| duplicate_charge | 100.0% | 100.0% | 11 | 0 | 0 |
| idle_cash | 100.0% | 77.8% | 7 | 0 | 2 |
| bills coming up (31 days) | 100.0% | 100.0% | 199 | 0 | 0 |

Missed subscriptions Claude would be asked about on a live upload: 0 of 0.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 17 | 58% | 94% |
| 60–69% | 32 | 64% | 97% |
| 70–79% | 5 | 76% | 100% |
| 80–89% | 2 | 83% | 100% |
| 90–100% | 0 | – | – |

Second tuning set (20 people, 123 files, 5981 transactions):

| Step | Score |
| --- | ---: |
| Files read | 123 of 123 (119 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 98.7% (78 left for Claude) |
| False "Charged twice?" | 14 (14 people) |
| Findings, $/yr | Jane $97,852, truth $95,998; error on the ones found 0.1% |
| Monthly spending, error | 0.3% |
| Monthly income, error | 0.0% |
| Net worth today right | 9 of 20 people (off by $135,407 in all) |
| Net worth line: month-ends drawn | 96.4% (error where drawn 50.0%) |
| Net worth line, people whose every balance Jane knows | 9 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 98.5% | 100.0% | 132 | 2 | 0 |
| price_increase | 100.0% | 100.0% | 4 | 0 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 21 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 10 | 0 | 0 |
| duplicate_charge | 44.0% | 100.0% | 11 | 14 | 0 |
| idle_cash | 100.0% | 50.0% | 3 | 0 | 3 |
| bills coming up (31 days) | 100.0% | 100.0% | 256 | 0 | 0 |

Missed subscriptions Claude would be asked about on a live upload: 0 of 0.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 21 | 58% | 81% |
| 60–69% | 41 | 64% | 90% |
| 70–79% | 7 | 74% | 71% |
| 80–89% | 3 | 83% | 100% |
| 90–100% | 0 | – | – |

Held-out set (20 people, 135 files, 5393 transactions):

| Step | Score |
| --- | ---: |
| Files read | 135 of 135 (132 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 94.2% (256 left for Claude) |
| False "Charged twice?" | 3 (3 people) |
| Findings, $/yr | Jane $28,825, truth $29,777; error on the ones found 0.0% |
| Monthly spending, error | 0.1% |
| Monthly income, error | 0.0% |
| Net worth today right | 11 of 20 people (off by $21,673 in all) |
| Net worth line: month-ends drawn | 91.8% (error where drawn 9.4%) |
| Net worth line, people whose every balance Jane knows | 11 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 100.0% | 91.3% | 95 | 0 | 9 |
| price_increase | 100.0% | 100.0% | 15 | 0 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 19 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 8 | 0 | 0 |
| duplicate_charge | 78.6% | 100.0% | 11 | 3 | 0 |
| idle_cash | 100.0% | 88.9% | 8 | 0 | 1 |
| bills coming up (31 days) | 99.5% | 100.0% | 216 | 1 | 0 |

Missed subscriptions Claude would be asked about on a live upload: 0 of 9.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 19 | 58% | 84% |
| 60–69% | 35 | 64% | 97% |
| 70–79% | 6 | 76% | 100% |
| 80–89% | 5 | 83% | 100% |
| 90–100% | 0 | – | – |

Second held-out set (20 people, 128 files, 5470 transactions):

| Step | Score |
| --- | ---: |
| Files read | 128 of 128 (126 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 91.5% (393 left for Claude) |
| False "Charged twice?" | 2 (2 people) |
| Findings, $/yr | Jane $31,131, truth $30,987; error on the ones found 0.0% |
| Monthly spending, error | 0.1% |
| Monthly income, error | 0.0% |
| Net worth today right | 10 of 20 people (off by $60,329 in all) |
| Net worth line: month-ends drawn | 100.0% (error where drawn 23.4%) |
| Net worth line, people whose every balance Jane knows | 10 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 100.0% | 100.0% | 93 | 0 | 0 |
| price_increase | 100.0% | 100.0% | 7 | 0 | 0 |
| trial_conversion | 100.0% | 80.0% | 4 | 0 | 1 |
| bank_fees | 100.0% | 100.0% | 25 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 8 | 0 | 0 |
| duplicate_charge | 84.6% | 100.0% | 11 | 2 | 0 |
| idle_cash | 100.0% | 88.9% | 8 | 0 | 1 |
| bills coming up (31 days) | 99.5% | 100.0% | 221 | 1 | 0 |

Missed subscriptions Claude would be asked about on a live upload: 0 of 0.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 19 | 59% | 100% |
| 60–69% | 39 | 64% | 95% |
| 70–79% | 6 | 76% | 100% |
| 80–89% | 2 | 83% | 100% |
| 90–100% | 0 | – | – |

Third held-out set (20 people, 157 files, 5636 transactions):

| Step | Score |
| --- | ---: |
| Files read | 157 of 157 (152 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 79.6% (1102 left for Claude) |
| False "Charged twice?" | 4 (4 people) |
| Findings, $/yr | Jane $51,743, truth $35,077; error on the ones found 0.0% |
| Monthly spending, error | 0.1% |
| Monthly income, error | 0.0% |
| Net worth today right | 7 of 20 people (off by $41,405 in all) |
| Net worth line: month-ends drawn | 90.9% (error where drawn 14.2%) |
| Net worth line, people whose every balance Jane knows | 7 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 76.5% | 100.0% | 104 | 32 | 0 |
| price_increase | 100.0% | 100.0% | 7 | 0 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 23 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 8 | 0 | 0 |
| duplicate_charge | 73.3% | 100.0% | 11 | 4 | 0 |
| idle_cash | 100.0% | 77.8% | 7 | 0 | 2 |
| bills coming up (31 days) | 100.0% | 100.0% | 221 | 0 | 0 |

Missed subscriptions Claude would be asked about on a live upload: 0 of 0.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 22 | 58% | 91% |
| 60–69% | 36 | 64% | 94% |
| 70–79% | 4 | 76% | 100% |
| 80–89% | 6 | 83% | 100% |
| 90–100% | 0 | – | – |
<!-- csv-scoreboard:end -->

### CSV bench, round by round

Rules only, Claude stubbed. Tuning / held-out.

| | Main before #836 | After #836 | After round 3 |
| --- | ---: | ---: | ---: |
| Category right | 81.2% / 43.3% | 96.9% / 65.1% | 96.2% / 63.0% (round 3's new rows) |
| False "Charged twice?" | 18 / 7 | 1 / 5 | 1 / 8 (new traps) |
| Monthly spending error | 11.0% / 8.0% | 0.8% / 0.4% | 0.4% / 0.6% |
| Subscriptions recall | 91.3% / 22.2% | 100% / 22.2% | 100% / 20.5% |
| Price-rise recall | 83.3% / 76.9% | 100% / 92.3% | 100% / 62.5% |
| "Coming up" bills recall | – | – | 69.3% → 100% / 65.8% → 87.8% |

- **Round 3 added more mess to both sets, before any fix:** subscriptions written two ways from month to month ("NETFLIX.COM" and "NETFLIX.COM 866-579-7172", "PAYPAL *HULU") and billed a day or two late; a cancelled subscription; a yearly plan; a trip abroad with the card's foreign-transaction fee on each purchase; a tax refund; cash back as a statement credit; part of an order returned; a dinner charged twice; two lunches at one price. It also scores "Coming up" (the bills due in the next 31 days that the cash forecast takes out). The 69.3% was mostly my generator's fault: each month's ACH got a different entry description ("WEB PMT", then "BILL PAY"), which a real biller never does. The fix was to the generator. Rent paid to a person by Zelle, and a bill every three months seen only twice, are left neutral.
- **Fixes:** Capital One 360's "Debit Card Purchase - PAYPAL *HULU" read as "Paypal", because the dash hid the processor prefix. Citi pads the merchant to a column before the city, and the padding is now where the merchant ends, so "SPOTIFY USA        SAN FRANCISCO CA" is Spotify (`src/data-sources/merchant.ts`).
- **What the held-out set shows the rules alone can't do:**
  - Subscriptions under names they don't know: 47 of 66 missed are recurring charges Claude is asked about on a live upload.
  - A subscription written two different ways under unknown names ("SLING TV", "SLING.COM") counts as two merchants. That is why held-out price rises fell to 62.5%.
  - Cinemas whose names say nothing ("ALAMO DRAFTHOUSE") give false double charges.
  - About a third of rows are left for Claude.
  
  A third CSV set would be needed to check any fix for these.
- **Round 4, more mess:** bills that come when they come (the dentist, a car repair, at uneven gaps), a roommate's share of the bills by Zelle each month, rent by paper check, and a gym's yearly fee beside its monthly one. Two misses on the tuning set, both fixed. Bank of America's ATM line ("BKOFAMERICA ATM … WITHDRWL") counted as spending. A subscription whose second way of writing it carried a code before the city ("SPOTIFY P1A2B3C4D5 CHICAGO IL") read as "Spotify Chicago". Now, when a description ends in a US state, the merchant directory also tries the name without its last one or two words, which matches only companies it already knows (`withoutCity`, `src/detection/merchants.ts`). Tuning set after: subscriptions, price rises and "Coming up" 100%, spending error 0.0%. On the held-out set round 4 brought 2 false price rises, which haven't been read.
- **A plan at one price every month is a subscription, even under a name no rule knows** (held-out subscriptions recall 20.3% → 66.2%, precision stays 100%; tuning 94.7% → 100%). A recurring charge whose category can't say (none, or one of `AMBIGUOUS_SUBSCRIPTION_CATEGORIES`), monthly, at the very same price at least `FIXED_PRICE_SUBSCRIPTION_MIN_CHARGES` (3) times and at most `FIXED_PRICE_SUBSCRIPTION_MAX_CENTS` ($100), is a subscription at low confidence (`FIXED_PRICE_SUBSCRIPTION_MAX_CONFIDENCE`), before Claude is asked (`isFixedPricePlan`). Claude is still asked about it. A yes raises it to medium, and a no (`declinedSubscriptionMerchantKeys`, from `subscription_checks`) takes it away. Rent, loans and usage bills cost more or move. The rest of the held-out misses are subscriptions whose price changed, or with too few charges at one price.
- **...but not a loan payment, insurance, a gift or a meal** (QA round 28, on live data). A credit union loan payment, Lemonade Insurance, a church, a bakery and a tavern, each at one fixed monthly amount under $100, were called subscriptions. The price-only rule now leaves out loan, food-and-drink, non-profit, transfer and utility categories and insurance (`FIXED_PRICE_SUBSCRIPTION_EXCLUDED_*`), and any description with a payment, loan, insurance, church, donation or bar and food word (`FIXED_PRICE_SUBSCRIPTION_NOT_WORDS`). The categorizer also files these by their own words (TAVERN, BAKERY, CHURCH, TITHE, INSURANCE, LOAN PMT). Both CSV sets now carry two such charges per person as traps; without the fix they gave 40 false subscriptions per set (precision 58.8% / 55.1%). With it, subscriptions precision is 100% on both, and held-out recall is still 66.2%.
- **One step up in price is still a plan's price** (round 10). A plan's price goes up once and stays (MUBI $14.99, then $15.99); a bill moves every month. The price-only rule now takes one price, or every charge at an old price then every one at a new price no more than `FIXED_PRICE_SUBSCRIPTION_MAX_STEP` (30%) higher. A step down, a second step or a bigger jump still isn't a plan. Subscriptions recall: first held-out set 72.8% → 83.7%, second 85.5% → 88.0%, precision still 100% on all three sets. The tuning set and the sample bench are unchanged.
- **What kind of place it is, from the words in its name** ("PHO HOA NOODLE", "BRIGHT NOW DENTAL", "MIDAS MUFFLER", "LUXE NAILS"): restaurant, grocery, dental, eye care, vet, pharmacy, clinic, auto service, fuel, hardware, furniture, salon, pet shop, clothing and lodging words. They come after the merchant names and before the cards' broad labels. This is general vocabulary, not names read off a set. Category right with rules alone: tuning 96.1% → 97.6%, held-out 57.2% → 60.9%. The sample bench is unchanged.
- **More kinds of place by their words** (round 8). New word groups:
- **Tickets, films, roasters, warehouse stores and internet providers by their words** (round 9). These are words, not names: TICKETS, TIX, BOX OFFICE are events, and FILM, MOVIES are cinemas. Both are also per-seat, so a group's seats aren't "Charged twice?". Also ROASTERS (coffee), WHOLESALE (warehouse stores), INTERNET (money out to a provider), and PARKING first, so a parking ticket is parking. On the second CSV held-out set, the first check after it was made: category right 69.7% → 74.7%, false "Charged twice?" 6 → 2. The tuning set, the first held-out set and the sample bench are unchanged. Caveat: the same person wrote the set's ticket seller and cinema names and these words, so the words are generic but the check isn't blind.
  - landlords (PROPERTY, COMMUNITIES, LEASING, REALTY; a PROPERTY TAX stays a tax)
  - phone and internet companies (WIRELESS, COMMUNICATIONS, BROADBAND, FIBER, CABLE)
  - taxis, cinemas and satellite TV (DIRECTV, DISH)
  - markets (MARKET, FOODS)
  - cash back and rewards credited to a card (a reward, never matched to a payment from checking)
  - a TRANSFER however the bank words the rest

  Category right with rules alone: tuning 97.7% → 99.0%, held-out 62.5% → 66.4%. Held-out price-rise precision also rose from 88.2% to 93.8%. The sample bench is unchanged.
- **Three at one price on one day are seats, not a double charge.** This is general knowledge: a shop doesn't run a card three times (`DUPLICATE_CHARGE_GROUP_MIN`, 3). It covers tickets at a place whose name says nothing, which no word or category marks as per-seat. Held-out CSV set: false "Charged twice?" 5 → 3 (precision 57.9% → 78.6%, recall 100%). Tuning and the sample bench are unchanged. Two seats at an unknown cinema still look exactly like a double charge, which is why the card asks rather than says.
- **Two seats at a cinema, once it has a category.** Plaid and Claude file cinemas under TV and movies, with streaming services. A streaming plan's double charge sits among payments on other days; a cinema visit is one day. So in `DUPLICATE_CHARGE_SEAT_UNLESS_RECURRING_CATEGORIES`, two at one price on the only day a merchant was ever paid are seats. The CSV bench can't show this: it runs without Claude, and its last 3 false "Charged twice?" are seats at a cinema whose name says nothing. On a live upload Claude gives that cinema its category, and then it is left out. Unit-tested both ways: a streaming plan charged twice is still found.
- **Two plans billed together are two plans, not a double charge** (upload QA: Spotify $11.99 twice on the same day every month showed as two "Charged twice?" and was missing from /subscriptions). The same price twice on one day, in `TWIN_PLAN_MIN_MONTHS` (2) months or more, now makes two recurring charges, the second keyed `@second` and named "(second plan)". It is never a double charge. Both CSV sets now have such a person about a third of the time. Without the fix: false "Charged twice?" 4 / 21 (tuning / held-out), held-out subscriptions recall 53.3%, held-out "Coming up" recall 85.8%. With it: 0 / 3, 72.8%, 94.6%. A pair in one month only is still a double charge.
- **Two plans from one company at two prices are two subscriptions** (QA round 30: Spotify at $11.99 and $16.99, each every month, was missing from /subscriptions, /bills and the findings). The typical amount fell between the two prices, so neither was a run of the whole. When there is no run of the whole, each exact price that comes monthly is now a run of its own (`runsByPrice`, as app stores already had). This needs `PRICE_PLANS_MIN` (2) such prices, monthly (`PRICE_PLANS_FREQUENCIES`), that together hold `RUN_MIN_SHARE_OF_CHARGES` of the merchant's charges, so two prices alternating weekly at a grocer stay shopping. All three CSV sets now have such a person about a third of the time. Without the fix, subscriptions recall was 83.6% / 76.9% / 81.7% (tuning / held-out / second held-out) and "Coming up" 94.0% / 90.7% / 92.3%. With it: 100% / 82.7% / 86.0% and 100% / 93.5% / 94.1%. Precision is 100% throughout, and the sample bench is unchanged.
- **One service written two ways, under a name no rule knows** ("DIRECTV STREAM" and "DIRECTV.COM", added to the tuning set). It counted as two merchants, so neither was a bill and no price rise showed. Now, on the same accounts, a merchant whose name another extends (words at the end, or one more inside after the first, as when a card wrote the city after it) is joined to it when every charge of one is at a price the other also charges. App stores are left out (`joinVariants`, `src/detection/streams.ts`). Bank of America's "CHECKCARD 0818 PAYPAL *HULU" also hid PayPal's prefix behind the date. Tuning set: "Coming up" 97.5% → 100%. Held-out set: price rises 81.8% / 60.0% → 88.2% / 100% (precision / recall), and "Coming up" recall 86.7% → 93.6%. The sample bench is unchanged. The service's subscription is still missed without Claude, since no rule knows the name.
- **Net worth and its line, scored through the upload's own balances (#849).** The bench now keeps what an upload keeps: each day's closing balance from the statement's running-balance column (Chase checking, Bank of America, Capital One 360). An account with no balance typed takes the statement's latest. Month ends are worked back from today's balance where the statement gave none (`closingBalances`, `derivedBalances`). The line starts at the first balance, as the home hub's does. Before, a person who only uploaded had a one-point line (today), and net worth was right for 5 of 20 people in each set. Now it's right for 7 / 11 of 20, with 97% / 92% of month-ends drawn. For everyone whose balances Jane knows today, the line is exact (0.0% error). The rest is accounts nobody gave a balance for: card exports and Wells Fargo have no balance column, so the card's debt is missing until the person types it.
- **Toast is restaurants.** "TST*" is Toast's till, which only restaurants use, so a charge through it is a meal whatever the place is called (after the merchant names, so "TST* BLUE BOTTLE" is still coffee). This is general knowledge, not read off the held-out set. Held-out set: category right 56.0% → 57.2%, false "Charged twice?" 8 → 5 (two lunches at one price, now known as meals under $30). Tuning set and sample bench unchanged.

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

After: "Charged twice?" is never surer than `DUPLICATE_CHARGE_MAX_PERCENT` (65%), which is how often it was right on #766's bench. No suggestion says 0%. The table is under "Calibration now" in the scoreboard block above.

What's left is under-confidence: "86% sure" is right every time here. I didn't raise the percentages to match. The bench's people are cleaner than real bank data (every subscription is a subscription, every saver has idle cash), so raising them would be tuning to my own generator. The gate only checks the safe direction: never more than 10 points surer than right. Raise the percentages from real outcomes: the verified savings record (#729) tracks which suggestions were acted on and paid off.

Round 2: no suggestion is surer than it turns out to be, on any set, but every bucket is now under-confident: suggestions saying 56% to 95% are right 100% of the time on all three sets. **The target of "within 10 points in every bucket" is not met, on purpose.** Meeting it would mean Jane saying 95–100% for everything, including on two months of history (the 50–59% bucket is all people with under six months, held down by `THIN_DATA_MAX_PERCENT`). The bench's people are made by rules I wrote, so the detectors tuned on them are right nearly every time; real bank data won't be that clean, and a Jane that says "99% sure" and is wrong is worse than one that says "60%" and is right. The gate keeps the safe direction (never more than 10 points surer than right, on every set). The percentages should be raised from real outcomes once real accounts link: the verified savings record (#729) tracks which suggestions held up.
