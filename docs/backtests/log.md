# Backtests of the practice autopilot's rules: the experiment log

Every experiment on the practice autopilot's numbers is recorded here, kept or rejected, with its
numbers. Practice money and demo advice only: these are replays of the past, never a forecast.
REAL_ACCOUNT_ADVICE stays false.

## How an experiment is run and judged

- **Prices.** The real-closes fixture (`src/lib/market/__fixtures__/real/`): adjusted daily
  closes for all 11 practice tickers, 2016-01-04 to 2026-10-21, from Yahoo Finance's keyless chart
  API, downloaded 2026-10-22. No headlines are stored for those years, so news ideas can't be
  replayed; every experiment here covers the dip buys, the tax-loss swaps, the drift bands and
  the monthly money.
- **Replay.** `replayRules` (`src/planning/rule-replay.ts`), which runs the live scan's and
  autopilot's own functions, so no rule is copied. The runner (`src/planning/rule-tuning.research.test.ts`,
  run with `RULE_TUNING_OUT=<file>`) re-imports it with the experiment's numbers swapped into
  `src/config`. Each replay: $10,000 to start, $500 on the first trading day of each month unless
  said otherwise, 2 basis points a trade, no taxes.
- **Walk-forward.** Each change is replayed on the training years (2016-01-04 to 2021-12-31: the
  2018 sell-off and the 2020 shock) and, from a fresh start, on the held-out years (2022-01-03 to
  2026-10-21: the 2022 slide and the spring 2025 drop). Two windows with different crashes, so a
  change can't win by fitting one.
- **The objective** (`src/planning/rule-tuning.ts`): yearly time-weighted return for each point
  of worst drop (return for the risk taken). The worst drop must stay within plain rebalancing's
  at the level plus 2 points (`RULE_TUNE_DROP_SLACK_POINTS`).
- **Kept** only when the objective beats the current settings' by at least 1%
  (`RULE_TUNE_MIN_GAIN`) in training *and* on the held-out years, and beats plain rebalancing's
  on the held-out years.
- Tables show the objective as **training / held-out**, per level.

## Round 0, 2026-10-22: tax-loss swaps turned off at Medium, High and Very high (PR #488)

The first rule replay, over the whole of 2016 to 2026 in one run, found the replay with tax-loss
swaps returning 0.54, 0.50 and 0.60 points less (worst drop 0.07 to 0.10 points deeper) than
without them at Medium, High and Very high, so they were turned off there
(`OPPORTUNITY_RULES_OFF`, with the evidence). Re-run after #483 made swaps a daily check: still
worse, by 0.46, 0.40 and 0.44 points (worst drop 0.07 to 0.11 deeper), so they stay off, with the
evidence updated. At Very low (−0.01) and Low (−0.23) they're inside the 0.25-point margin and
stay on. New money, idle cash and cheaper twins (#483) made no difference at any level (0.00 to
+0.01 points) and stay on. The figures are before tax: the losses harvested would lower a real
tax bill, which no replay here counts. `src/planning/rule-tuning.test.ts` checks on the fixture
that each switched-off rule still makes its level worse.

## Round 1, 2026-10-22: each rule's numbers, one at a time

Re-run after #483 (eight new opportunity kinds, preferences, tax-loss swaps watched daily), so
these numbers are the live scan's as it is now, with the default preferences; the first run,
before #483, came to the same verdicts.

The baseline (current settings: dip buys on, swaps on at Very low and Low only, both bands 5%):

| Level | Current: train | Current: held-out | Plain rebalancing: held-out | Buy and hold: held-out |
| --- | --- | --- | --- | --- |
| Very low | 7.0% a year, worst -12.7%, **0.551** | 3.5% a year, worst -17.1%, **0.205** | 3.5% a year, worst -17.1%, **0.206** | 3.8% a year, worst -17.0%, **0.223** |
| Low | 8.8% a year, worst -17.0%, **0.517** | 4.9% a year, worst -19.5%, **0.253** | 4.9% a year, worst -19.4%, **0.254** | 5.3% a year, worst -19.3%, **0.272** |
| Medium | 10.5% a year, worst -22.1%, **0.472** | 6.6% a year, worst -21.0%, **0.312** | 6.6% a year, worst -21.0%, **0.312** | 6.9% a year, worst -21.0%, **0.327** |
| High | 12.2% a year, worst -26.6%, **0.457** | 8.2% a year, worst -22.7%, **0.360** | 8.2% a year, worst -22.7%, **0.360** | 8.4% a year, worst -22.6%, **0.370** |
| Very high | 13.6% a year, worst -31.2%, **0.434** | 9.6% a year, worst -24.7%, **0.390** | 9.6% a year, worst -24.7%, **0.390** | 9.7% a year, worst -24.7%, **0.392** |

| Experiment | Very low | Low | Medium | High | Very high | Kept |
| --- | --- | --- | --- | --- | --- | --- |
| DIP_MIN_DROP 0.05 | 0.536 / 0.208 | 0.516 / 0.255 | 0.470 / 0.307 | 0.459 / 0.355 | 0.434 / 0.385 | none |
| DIP_MIN_DROP 0.075 | 0.549 / 0.201 | 0.517 / 0.247 | 0.472 / 0.306 | 0.457 / 0.355 | 0.434 / 0.386 | none |
| DIP_MIN_DROP 0.125 | 0.551 / 0.204 | 0.517 / 0.252 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| DIP_MIN_DROP 0.15 | 0.551 / 0.204 | 0.517 / 0.252 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| DIP_LOOKBACK_DAYS 10 | 0.551 / 0.204 | 0.519 / 0.252 | 0.473 / 0.312 | 0.455 / 0.360 | 0.434 / 0.390 | none |
| DIP_LOOKBACK_DAYS 40 | 0.546 / 0.204 | 0.517 / 0.261 | 0.472 / 0.314 | 0.459 / 0.360 | 0.434 / 0.394 | none |
| DIP_LOOKBACK_DAYS 60 | 0.545 / 0.210 | 0.518 / 0.259 | 0.471 / 0.314 | 0.457 / 0.363 | 0.434 / 0.395 | none |
| dip sizeShare 0.02 | 0.551 / 0.204 | 0.517 / 0.252 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| dip sizeShare 0.1 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| dip sizeShare 0.2 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| DIP_MAX_OVER_TARGET 0.02 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| DIP_MAX_OVER_TARGET 0.1 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| dip buys off | 0.551 / 0.204 | 0.519 / 0.252 | 0.473 / 0.312 | 0.455 / 0.360 | 0.434 / 0.390 | none |
| harvest on everywhere | 0.551 / 0.205 | 0.517 / 0.253 | 0.469 / 0.310 | 0.454 / 0.361 | 0.432 / 0.391 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.05 | 0.551 / 0.207 | 0.517 / 0.253 | 0.469 / 0.310 | 0.455 / 0.359 | 0.432 / 0.390 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.12 | 0.549 / 0.204 | 0.521 / 0.251 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.2 | 0.549 / 0.208 | 0.521 / 0.256 | 0.472 / 0.314 | 0.457 / 0.362 | 0.434 / 0.392 | none |
| harvest off everywhere | 0.549 / 0.207 | 0.521 / 0.255 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| new_money_rebalance off | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| cash_drag off | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| cheaper_fund off | 0.551 / 0.206 | 0.517 / 0.252 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| DRIFT_STOCKS_BAND 0.03 | 0.529 / 0.206 | 0.499 / 0.253 | 0.469 / 0.312 | 0.451 / 0.360 | 0.436 / 0.390 | none |
| DRIFT_STOCKS_BAND 0.08 | 0.554 / 0.205 | 0.524 / 0.253 | 0.489 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| DRIFT_STOCKS_BAND 0.1 | 0.554 / 0.205 | 0.524 / 0.253 | 0.489 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.03 | 0.549 / 0.205 | 0.507 / 0.253 | 0.475 / 0.313 | 0.445 / 0.360 | 0.439 / 0.390 | none |
| rebalanceBand 0.075 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.1 | 0.551 / 0.205 | 0.517 / 0.253 | 0.472 / 0.312 | 0.457 / 0.360 | 0.434 / 0.390 | none |

**Result: nothing kept.** Every change moved the objective by under 1%, in one window or both.
- **Dip buys** use only cash waiting to be invested, and the autopilot invests the monthly money
  the day it lands. So a dip buy can act only when a dip of 10% or more falls on a deposit day:
  three times in ten years. No dip setting changes that.
- **Tax-loss swaps** turned back on at Medium and up, at any loss threshold, were worse or level
  in training. They stay off there.
- **`rebalanceBand` alone** changes nothing above 5%: the stocks band (`DRIFT_STOCKS_BAND`, 5%)
  triggers first.
- **`DRIFT_STOCKS_BAND` 8% or 10%** helped Low and Medium in training (0.524 and 0.489 against
  0.517 and 0.472) but were exactly level on the held-out years. That's one window, so not kept.

## Round 2, 2026-10-22: the two rebalancing bands together

| Experiment | Very low | Low | Medium | High | Very high | Kept |
| --- | --- | --- | --- | --- | --- | --- |
| rebalanceBand 0.03 + DRIFT_STOCKS_BAND 0.03 | 0.529 / 0.205 | 0.499 / 0.253 | 0.469 / 0.313 | 0.451 / 0.360 | 0.436 / 0.390 | none |
| rebalanceBand 0.05 + DRIFT_STOCKS_BAND 0.075 | 0.554 / 0.205 | 0.524 / 0.253 | 0.489 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.05 + DRIFT_STOCKS_BAND 0.1 | 0.554 / 0.205 | 0.524 / 0.253 | 0.489 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.075 + DRIFT_STOCKS_BAND 0.075 | 0.533 / 0.205 | 0.532 / 0.253 | 0.495 / 0.312 | 0.449 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.1 + DRIFT_STOCKS_BAND 0.1 | 0.533 / 0.205 | 0.505 / 0.253 | 0.476 / 0.312 | 0.449 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.1 + DRIFT_STOCKS_BAND 0.15 | 0.533 / 0.205 | 0.505 / 0.253 | 0.476 / 0.312 | 0.449 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.15 + DRIFT_STOCKS_BAND 0.15 | 0.533 / 0.205 | 0.505 / 0.253 | 0.476 / 0.312 | 0.449 / 0.360 | 0.434 / 0.390 | none |
| rebalanceBand 0.25 + DRIFT_STOCKS_BAND 0.25 | 0.533 / 0.205 | 0.505 / 0.253 | 0.476 / 0.312 | 0.449 / 0.360 | 0.434 / 0.390 | none |

**Result: nothing kept.** Wider bands (7.5% each) won training at Low and Medium (0.532 and
0.495), again level on the held-out years. At 10% or more every row is the same: the bands stop
triggering, and the autopilot rebalances only by putting each month's money into what's under its
target. That alone keeps every level within a few points of its mix.

Buy and hold, for comparison: better than the autopilot on the held-out years at every level
(0.223 against 0.205 at Very low, 0.392 against 0.390 at Very high). Worse in training at Very low
to High (0.516 against 0.551 at Very low), with deeper worst drops in training (by 0.6 to 1.2
points). Neither wins in both windows, so the autopilot keeps rebalancing.

## Round 3, 2026-10-22: does a different monthly amount change the verdicts?

The same swap and dip experiments with no monthly money, and with $2,000 a month.

**No monthly money:**

| Level | Current: train | Current: held-out | Plain rebalancing: held-out | Buy and hold: held-out |
| --- | --- | --- | --- | --- |
| Very low | 7.0% a year, worst -13.2%, **0.534** | 3.6% a year, worst -17.1%, **0.210** | 3.6% a year, worst -17.0%, **0.213** | 3.8% a year, worst -17.0%, **0.226** |
| Low | 8.8% a year, worst -17.2%, **0.511** | 5.0% a year, worst -19.3%, **0.256** | 4.9% a year, worst -19.3%, **0.256** | 5.3% a year, worst -19.3%, **0.275** |
| Medium | 10.5% a year, worst -21.9%, **0.477** | 6.6% a year, worst -20.9%, **0.315** | 6.6% a year, worst -20.9%, **0.315** | 6.9% a year, worst -20.9%, **0.328** |
| High | 12.3% a year, worst -26.8%, **0.460** | 8.2% a year, worst -22.6%, **0.365** | 8.2% a year, worst -22.6%, **0.365** | 8.4% a year, worst -22.6%, **0.371** |
| Very high | 13.7% a year, worst -31.3%, **0.438** | 9.8% a year, worst -24.7%, **0.397** | 9.8% a year, worst -24.7%, **0.397** | 9.7% a year, worst -24.7%, **0.392** |

| Experiment | Very low | Low | Medium | High | Very high | Kept |
| --- | --- | --- | --- | --- | --- | --- |
| harvest on everywhere | 0.534 / 0.210 | 0.511 / 0.256 | 0.474 / 0.313 | 0.458 / 0.364 | 0.435 / 0.393 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.05 | 0.534 / 0.210 | 0.511 / 0.255 | 0.475 / 0.314 | 0.458 / 0.361 | 0.435 / 0.391 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.12 | 0.534 / 0.210 | 0.513 / 0.255 | 0.477 / 0.314 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.2 | 0.534 / 0.212 | 0.513 / 0.254 | 0.477 / 0.312 | 0.460 / 0.361 | 0.438 / 0.388 | none |
| harvest off everywhere | 0.534 / 0.213 | 0.513 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| dip sizeShare 0.02 | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| dip sizeShare 0.1 | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| dip sizeShare 0.2 | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| dip buys off | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| dip buys off | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| harvest off everywhere | 0.534 / 0.213 | 0.513 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| new_money_rebalance off | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| cash_drag off | 0.534 / 0.210 | 0.511 / 0.256 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |
| cheaper_fund off | 0.534 / 0.211 | 0.511 / 0.254 | 0.477 / 0.315 | 0.460 / 0.365 | 0.438 / 0.397 | none |

**$2,000 a month:**

| Level | Current: train | Current: held-out | Plain rebalancing: held-out | Buy and hold: held-out |
| --- | --- | --- | --- | --- |
| Very low | 7.0% a year, worst -12.7%, **0.552** | 3.5% a year, worst -17.1%, **0.207** | 3.5% a year, worst -17.1%, **0.205** | 3.8% a year, worst -17.1%, **0.223** |
| Low | 8.9% a year, worst -17.1%, **0.519** | 5.0% a year, worst -19.4%, **0.255** | 4.9% a year, worst -19.4%, **0.253** | 5.3% a year, worst -19.4%, **0.272** |
| Medium | 10.4% a year, worst -22.2%, **0.471** | 6.6% a year, worst -21.0%, **0.312** | 6.5% a year, worst -21.0%, **0.311** | 6.9% a year, worst -21.0%, **0.326** |
| High | 12.1% a year, worst -26.6%, **0.454** | 8.2% a year, worst -22.7%, **0.360** | 8.2% a year, worst -22.7%, **0.359** | 8.4% a year, worst -22.7%, **0.370** |
| Very high | 13.6% a year, worst -31.2%, **0.434** | 9.6% a year, worst -24.7%, **0.390** | 9.6% a year, worst -24.7%, **0.389** | 9.7% a year, worst -24.7%, **0.392** |

| Experiment | Very low | Low | Medium | High | Very high | Kept |
| --- | --- | --- | --- | --- | --- | --- |
| harvest on everywhere | 0.552 / 0.207 | 0.519 / 0.255 | 0.468 / 0.313 | 0.451 / 0.361 | 0.432 / 0.392 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.05 | 0.552 / 0.206 | 0.519 / 0.254 | 0.468 / 0.311 | 0.451 / 0.359 | 0.432 / 0.389 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.12 | 0.548 / 0.207 | 0.522 / 0.255 | 0.471 / 0.311 | 0.454 / 0.359 | 0.434 / 0.388 | none |
| harvest on everywhere, HARVEST_MIN_LOSS_SHARE 0.2 | 0.548 / 0.208 | 0.521 / 0.256 | 0.471 / 0.313 | 0.454 / 0.361 | 0.434 / 0.391 | none |
| harvest off everywhere | 0.548 / 0.207 | 0.521 / 0.255 | 0.471 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| dip sizeShare 0.02 | 0.548 / 0.206 | 0.518 / 0.254 | 0.471 / 0.311 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| dip sizeShare 0.1 | 0.552 / 0.207 | 0.519 / 0.255 | 0.471 / 0.313 | 0.454 / 0.361 | 0.434 / 0.390 | none |
| dip sizeShare 0.2 | 0.552 / 0.207 | 0.519 / 0.255 | 0.471 / 0.313 | 0.454 / 0.361 | 0.434 / 0.390 | none |
| dip buys off | 0.550 / 0.205 | 0.517 / 0.253 | 0.469 / 0.311 | 0.452 / 0.360 | 0.434 / 0.389 | none |
| dip buys off | 0.550 / 0.205 | 0.517 / 0.253 | 0.469 / 0.311 | 0.452 / 0.360 | 0.434 / 0.389 | none |
| harvest off everywhere | 0.548 / 0.207 | 0.521 / 0.255 | 0.471 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| new_money_rebalance off | 0.552 / 0.207 | 0.519 / 0.255 | 0.471 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| cash_drag off | 0.552 / 0.207 | 0.519 / 0.255 | 0.471 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |
| cheaper_fund off | 0.552 / 0.206 | 0.519 / 0.254 | 0.471 / 0.312 | 0.454 / 0.360 | 0.434 / 0.390 | none |

**Result: nothing kept.**
- With no monthly money, dip buys never act: there is never cash waiting.
- With $2,000 a month they act more often, but still move the objective by under 1%.
- Swaps at Very low score 0.210 against 0.213 with them off (no money in), and the same as off
  at $2,000 a month (0.207); at Low they're level. Inside the 1% margin either way. They stay
  on, because their value is the tax loss, which a before-tax replay can't see.
- New money, idle cash and cheaper twins off: within 0.002 of the current settings at every
  deposit size.

## Where this leaves the rules (2026-10-22)

| Rule | Very low | Low | Medium | High | Very high |
| --- | --- | --- | --- | --- | --- |
| Dip buys | on | on | on | on | on |
| Tax-loss swaps | on | on | off (round 0) | off (round 0) | off (round 0) |
| News ideas | n/a | n/a | n/a | on, untested | on, untested |
| New money, idle cash, cheaper twins (#483) | on | on | on | on | on |
| Bands | 5% / 5% | 5% / 5% | 5% / 5% | 5% / 5% | 5% / 5% |

What the overnight runs say:
- On real prices from 2016 to 2026, none of the scan's numbers can be tuned into a win that
  holds up on later years. The rules are cheap and harmless, but their effect is inside the noise.
- Dip buys don't earn much: with them off, the objective moves by 0.4% or less in training and
  not at all on the held-out years. They stay on, since switching a rule on noise is its own
  overfit, but they rarely act.
- What moves results is the level's mix, not the rules.

For later (not built here):
- **Dip buys could act more often** if the monthly money waited a few days for a dip before the
  autopilot invested it. That is a new rule, for the session adding opportunity types (B2).
- **Tax-loss swaps need an after-tax replay** to be judged at all. Medium and up could earn them
  back there.
- **News ideas need stored past headlines** before they can be replayed.
- **Per-person evaluation** (risk, worst drop they can stomach, goal date, monthly amount) is the
  next round, once the preference type lands (B1).

## 2026-10-24: everyday buys go to each kind's own fund

The practice autopilot used to buy whichever fund of a kind was held more, or the swap partner
whenever the main fund was at a loss. So after a tax-loss swap, or in any dip, rebalances bought
ITOT instead of VTI. Now `buyFundFor` (src/planning/practice-autopilot.ts) buys the kind's own
fund. The partner is used only for the wash-sale window: when the own fund was sold at a loss
lately (or is never bought), or when the person's losses are being harvested and the own fund is
held at a loss (buying it would make a harvest within 30 days a wash sale). The dip buys and
opportunity buys use the same rule.

The rule replay re-run on the fixture (2016 to October 14, 2026), tax-loss swaps against none:

| Level | Return points | Worst drop, points deeper | |
| --- | --- | --- | --- |
| Medium | −0.01 | 0.03 | stays off |
| High | +0.18 | 0.04 | stays off: far under the 1% gain a rule needs, and a deeper drop |
| Very high | −0.04 | 0.05 | stays off |

`src/planning/rule-tuning.test.ts` now checks that each switched-off rule is never better on both
return and worst drop, and that the evidence quotes the replay's own numbers.

## 2026-10-24: the strategy catalog, every strategy at every level

The founder asked for every well-documented, rules-based strategy, backtested thoroughly, with only the good-enough ones recommended. [The catalog](strategy-catalog.md) has 48 strategies from public sources (Faber, Antonacci, Keller & Keuning, Keller & Butler, Butler et al., Kipnis, López de Prado, Choueifaty, the factor literature, Connors, the seasonal anomalies). They were replayed in GitHub Actions on Alpaca SIP daily closes, 2016 to October 2026, after costs, at every risk level (run 40083022347); the results are in [strategy-results.md](strategy-results.md).

- 77 trials (every strategy at every setting). Each was scored out of sample twice: walk-forward from 2020, and chosen to 2021 then scored from 2022.
- The deflated Sharpe ratio of each walk-forward's excess over the level's mix, against the best of 77 lucky trials, is the haircut.
- **Nothing is recommendable at any level.** None beat its level's mix by enough to rule out luck after testing 77 at once.
- **Worth watching:** each beat the mix out of sample, inside the risk budget, with more return and not just less risk, and still ahead measured from 2021 and from 2022.
  - Hybrid asset allocation (HAA): every level, 5 to 10% likely a real edge.
  - Sector rotation: every level, strongest at High and Very high (18 to 22%).
  - Faber's aggressive GTAA: every level but Very high, 5 to 8%.
  - Elastic asset allocation (EAA): every level but Very high, 4 to 7%.
- The last three added (sector rotation with a trend filter, bond rotation, trend with volatility targeting) cut risk but gave up more return than they saved; none is worth watching. Of the three lazy portfolios, the No-Brainer is worth watching at Very low and Low and the Coffeehouse at Very low; the Larry portfolio trailed every level's mix.
- Most of the rest did worse than simply keeping the level's mix, the honest result for most published rules once costs and out-of-sample years are counted.
- The day-trading rules (every one lost after slippage) and the crypto rules are scored separately: `intraday-evidence.ts` and `crypto-evidence.ts`.
