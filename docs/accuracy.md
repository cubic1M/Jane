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
| 90–100% | 32 | 95% | 100% |

Held-out set (40 people, 10008 transactions):

| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| subscriptions | 100.0% | 99.2% | 0.0% | 123 | 0 | 1 |
| price_rises | 100.0% | 100.0% | 0.0% | 8 | 0 | 0 |
| fees | 100.0% | 100.0% | 0.0% | 20 | 0 | 0 |
| double_charges | 100.0% | 100.0% | 0.0% | 31 | 0 | 0 |
| idle_cash | 100.0% | 100.0% | 0.0% | 6 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 0.0% | 10 | 0 | 0 |
| bills | 100.0% | 96.9% | 0.0% | 281 | 0 | 9 |
| income | 100.0% | 100.0% | 0.0% | 774 | 0 | 0 |
| transfers | 100.0% | 99.6% | 0.0% | 833 | 0 | 3 |

Calibration, held-out set:

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 26 | 56% | 100% |
| 60–69% | 31 | 65% | 100% |
| 70–79% | 10 | 75% | 100% |
| 80–89% | 17 | 85% | 100% |
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
| bills | 100.0% | 94.4% | 0.0% | 269 | 0 | 16 |
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

## CSV bench: the upload path, on bank files (2026-10-27)

Beta users start by uploading statements, so the sample people above (already-clean rows) can't show what goes wrong between a bank's CSV and Jane's numbers. The CSV bench holds the whole upload path to labelled statements, as the banks export them.

- **People:** `src/accuracy/csv/people.ts`, 20 synthetic people per set (none real), 3 to 6 months each, a checking account and one or two cards, some with savings. Every true transaction carries its category, and each person the truth for every finding: what should fire, what shouldn't (a group's tickets, a refunded double charge, coffee at one price every day, a pending copy), the $/yr Jane should show, net worth today and at each month end.
- **Files:** `src/accuracy/csv/layouts.ts` writes each account in its bank's layout: Chase checking and card, Bank of America checking (summary block above the header) and card, Wells Fargo (no header), Capital One 360 (two-digit years, unsigned amounts with a type) and card (ISO dates, debit and credit columns), Citi (pending rows in an export taken mid-month, payments as negative credits), American Express (half with "additional details": line breaks inside quotes), Discover, and a credit union's semicolon file with day-first dates and decimal commas (through the column picker, Jane's guesses accepted, the right column picked where it asks). Byte-order marks, Windows line ends, running balances, padded and cut descriptions ("AUTOMATIC PAYMENT - THANK"), each bank's ACH, Zelle, Venmo, transfer, ATM, fee and card-payment wording, and monthly files that overlap by a few days. The files are checked in (`src/accuracy/csv/__fixtures__/<set>/<person>/`, with a `truth.json` of what each person should see), so anyone can upload one person by hand.
- **Two sets.** The tuning set (`CSV_SEED`) is what rules were fixed on. The held-out set (`CSV_HELD_OUT_SEED`) has the same kinds of people and mess under names the tuning set never uses (other grocers, restaurants, landlords, utilities, employers, subscriptions, airlines and cinemas) and different banks per person. It was written before any fix and is only scored.
- **Scoring:** `src/accuracy/csv/score.ts` runs what `/import` runs, without a database: `readCsvFile` on every file, one copy of rows two files share, `categorizeTransactions` with Claude off and no cached merchants, card payments matched from the card's side, the merchant directory's seed, `detect()`, the spending chart's monthly totals and the home hub's net worth line. Claude is stubbed (`vi.mock`), so nothing is spent and the categories and subscriptions are the rules' alone: a lower bound. On a live upload Claude places what the rules leave, and is asked about recurring charges whose category can't say; the tables count both.
- **Run it:** `npm run accuracy` prints both benches. `ACCURACY_WRITE=1` also rewrites the files, `src/accuracy/csv/baseline.json` and the tables below. `ACCURACY_MISTAKES=1` lists the tuning set's mistakes.
- **Calibration:** the suggestions an uploaded person would see, made from the upload's rows and only the balances Jane knows. They are bucketed by their "% sure" and judged on the same topics as the sample bench. Like the sample bench, they are under-confident on purpose ("58% sure" is right 94% of the time on the tuning set, 87% held out). The only wrong ones are two "build an emergency fund" suggestions for people near the idle-cash line. The gate holds the same bar: no 0%, no bucket of 10 or more over 10 points surer than right.
- **Gate:** `src/accuracy/csv/csv-accuracy.test.ts`, with the unit tests: the files must match the generator, every share in the baseline may drop at most 3 points, and extra rows and false "Charged twice?" may not rise at all.

<!-- csv-scoreboard:start -->
Tuning set (20 people, 155 files, 5354 transactions):

| Step | Score |
| --- | ---: |
| Files read | 155 of 155 (151 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 99.0% (50 left for Claude) |
| False "Charged twice?" | 0 (0 people) |
| Findings, $/yr | Jane $27,204, truth $27,204; error on the ones found 0.0% |
| Monthly spending, error | 0.0% |
| Monthly income, error | 0.0% |
| Net worth today right | 7 of 20 people (off by $51,853 in all) |
| Net worth line: month-ends drawn | 97.3% (error where drawn 18.9%) |
| Net worth line, people whose every balance Jane knows | 7 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 100.0% | 100.0% | 57 | 0 | 0 |
| price_increase | 100.0% | 100.0% | 8 | 0 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 17 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 10 | 0 | 0 |
| duplicate_charge | 100.0% | 100.0% | 11 | 0 | 0 |
| idle_cash | 100.0% | 77.8% | 7 | 0 | 2 |
| bills coming up (31 days) | 100.0% | 100.0% | 183 | 0 | 0 |

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

Held-out set (20 people, 135 files, 5226 transactions):

| Step | Score |
| --- | ---: |
| Files read | 135 of 135 (132 exactly) |
| Rows read exactly | 100.0% (0 extra, 0 missing) |
| Category right (rules only) | 66.4% (1681 left for Claude) |
| False "Charged twice?" | 3 (3 people) |
| Findings, $/yr | Jane $22,656, truth $25,747; error on the ones found 0.0% |
| Monthly spending, error | 0.1% |
| Monthly income, error | 0.0% |
| Net worth today right | 11 of 20 people (off by $21,118 in all) |
| Net worth line: month-ends drawn | 91.8% (error where drawn 9.2%) |
| Net worth line, people whose every balance Jane knows | 11 of 20, error 0.0% |

| Finding | Precision | Recall | Right | False alarms | Missed |
| --- | ---: | ---: | ---: | ---: | ---: |
| subscription_review | 100.0% | 66.2% | 49 | 0 | 25 |
| price_increase | 93.8% | 100.0% | 15 | 1 | 0 |
| trial_conversion | 100.0% | 100.0% | 5 | 0 | 0 |
| bank_fees | 100.0% | 100.0% | 19 | 0 | 0 |
| card_interest | 100.0% | 100.0% | 8 | 0 | 0 |
| duplicate_charge | 78.6% | 100.0% | 11 | 3 | 0 |
| idle_cash | 100.0% | 88.9% | 8 | 0 | 1 |
| bills coming up (31 days) | 99.4% | 94.1% | 175 | 1 | 11 |

Missed subscriptions Claude would be asked about on a live upload: 10 of 25.

Suggestions' confidence (is "80% sure" right 80% of the time?):

| Said | Suggestions | Average said | Actually right |
| --- | ---: | ---: | ---: |
| 0–49% | 0 | – | – |
| 50–59% | 16 | 58% | 81% |
| 60–69% | 31 | 64% | 97% |
| 70–79% | 6 | 76% | 100% |
| 80–89% | 3 | 83% | 100% |
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
- **What kind of place it is, from the words in its name** ("PHO HOA NOODLE", "BRIGHT NOW DENTAL", "MIDAS MUFFLER", "LUXE NAILS"): restaurant, grocery, dental, eye care, vet, pharmacy, clinic, auto service, fuel, hardware, furniture, salon, pet shop, clothing and lodging words. They come after the merchant names and before the cards' broad labels. This is general vocabulary, not names read off a set. Category right with rules alone: tuning 96.1% → 97.6%, held-out 57.2% → 60.9%. The sample bench is unchanged.
- **More kinds of place by their words** (round 8). New word groups:
  - landlords (PROPERTY, COMMUNITIES, LEASING, REALTY; a PROPERTY TAX stays a tax)
  - phone and internet companies (WIRELESS, COMMUNICATIONS, BROADBAND, FIBER, CABLE)
  - taxis, cinemas and satellite TV (DIRECTV, DISH)
  - markets (MARKET, FOODS)
  - cash back and rewards credited to a card (a reward, never matched to a payment from checking)
  - a TRANSFER however the bank words the rest

  Category right with rules alone: tuning 97.7% → 99.0%, held-out 62.5% → 66.4%. Held-out price-rise precision also rose from 88.2% to 93.8%. The sample bench is unchanged.
- **Three at one price on one day are seats, not a double charge.** This is general knowledge: a shop doesn't run a card three times (`DUPLICATE_CHARGE_GROUP_MIN`, 3). It covers tickets at a place whose name says nothing, which no word or category marks as per-seat. Held-out CSV set: false "Charged twice?" 5 → 3 (precision 57.9% → 78.6%, recall 100%). Tuning and the sample bench are unchanged. Two seats at an unknown cinema still look exactly like a double charge, which is why the card asks rather than says.
- **Two seats at a cinema, once it has a category.** Plaid and Claude file cinemas under TV and movies, with streaming services. A streaming plan's double charge sits among payments on other days; a cinema visit is one day. So in `DUPLICATE_CHARGE_SEAT_UNLESS_RECURRING_CATEGORIES`, two at one price on the only day a merchant was ever paid are seats. The CSV bench can't show this: it runs without Claude, and its last 3 false "Charged twice?" are seats at a cinema whose name says nothing. On a live upload Claude gives that cinema its category, and then it is left out. Unit-tested both ways: a streaming plan charged twice is still found.
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
