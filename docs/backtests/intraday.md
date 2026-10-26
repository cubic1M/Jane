# The 24-hour agent: every strategy at 15 minutes and 1 hour

Generated 2026-10-26 by `src/lib/trading-agent/intraday-research.cli.test.ts` (`INTRADAY_AGENT=all`). A replay of past bars, not a forecast: future results will be different. Practice money and demo advice only; no order was ever sent anywhere.

## The short answer

170 strategy runs (each strategy, market and interval). **0 beat just holding after the haircut; 119 made money but less than holding (or not clearly more); 51 lost money.**

## What it means

- **Nothing beat just holding after the haircut**: not on bitcoin and ether, not on US funds, at neither 15 minutes nor 1 hour. A few edged past holding their own asset: volatility targeting on SPY and on QQQ (+0.2 points a year at 15 minutes) and the momentum fund (+0.3 at both). All are well within what luck across 300 trials gives: a deflated Sharpe ratio of 2% or less, against the 95% needed.
- **Crypto is where trading this often hurts most: 31 of 42 runs lost money.** Every fill costs about 0.28% (Alpaca's fee and the spread). Rules that trade hundreds or thousands of times a year (internal bar strength, RSI(2) and Bollinger pullbacks, crypto momentum) lose most or all of the money. Volatility targeting on bitcoin came closest to holding: about 30% a year against 33–35%, with a similar worst drop.
- **US funds cost far less to trade, and 108 of 128 runs made money, but every one made less than holding SPY or QQQ, or not clearly more.** Some cut the worst drop sharply (TIPP, Bollinger pullbacks, VAA: 4–14% against holding's 23%) by sitting in bills much of the time, at the cost of much lower growth.
- **So the agent offers every strategy with its result beside it, losers marked**, and says plainly that none beat holding. It is practice money, to see how a rule behaves, not a way to earn.

This section is written by hand; the rest is generated.

## How it was run

- **The same loop as the live agent** (`src/planning/trading-agent/engine.ts`): each rule decides at a bar's close from that bar and the ones before it, and the trade fills at the **next bar's open**. Nothing reads a later bar (tested: a run cut short trades exactly like the full run up to the cut).
- **Costs on every fill:** crypto 25 bps fee (Alpaca's taker fee) plus 1 bp half spread and 2 bps slippage; US funds no commission, 1 bp half spread and 2 bps slippage. Just holding pays them once.
- **Nights and weekends:** US funds trade 9:30 to 4 New York time only. A trade decided at the last bar of the day fills at the next morning's open, so the overnight and weekend gap is in the price. Crypto runs around the clock.
- **The catalog's rules, bar by bar:** every rule in `src/config/strategy-catalog.ts` runs unchanged, with each bar as one trading day of a made-up calendar (`src/planning/trading-agent/clock.ts`). A 200-day average becomes a 200-bar average, and "each month" every 21 or so bars. Rules over SPY and bills alone are also pointed at QQQ, and at bitcoin and ether with plain cash as the bills. The multi-fund rules run on their own funds in market hours. The crypto rules (`src/config/crypto-strategies.ts`) run on bitcoin and ether.
- **Left out:** sell_in_may, turn_of_month. They are calendar rules, and a made-up calendar means nothing to them; their daily results are in strategy-results.md.
- **Walk-forward:** the first 40% of bars only train. The rest is cut into 3 folds, each scored with the setting the bars before it chose by Sharpe ratio ("Settings" lists them in order). Every figure below is from those out-of-sample folds.
- **The haircut:** the catalog's, the deflated Sharpe ratio of each strategy's bar returns over holding's, against the best of every trial run (the count is in each table). A strategy beats holding only when that is at least 95% and its growth is higher too.
- **Figures:** CAGR is yearly growth; worst drop is peak to trough; Sharpe is yearly, from bar returns with no cash hurdle; win rate is the share of sells above what was paid, costs included; trades a year; turnover is what changed hands in a year over the average value. "Holding it" is just holding the rule's own asset over the same bars (QQQ or ether for a rule pointed at them, else SPY or bitcoin), and "vs hold" is CAGR minus that.

## Bitcoin and ether, around the clock, every 15 minutes

Bars: Alpaca's crypto bars (no key needed). Scored 2023-04-30 to 2026-10-26 (122,217 bars), 300 trials in the haircut. **Just holding BTC: 33.4% a year, worst drop 54.0%, Sharpe 0.80.**

| Strategy | Settings | CAGR | Holding it | Worst drop | Sharpe | Win rate | Trades/yr | Turnover/yr | vs hold | DSR | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Volatility targeting on BTC | 0.15, 0.15, 0.15 | 30.4% | 33.4% | 54.6% | 0.76 | 61.4% | 33 | 3.34× | −3.0% | 0% | Made less than holding (or not clearly more) |
| Crypto, held | 0, 0, 0 | 18.6% | 33.4% | 61.4% | 0.59 | 40.0% | 3590 | 6.96× | −14.8% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on BTC | 3, 3, 3 | 9.2% | 33.4% | 41.6% | 0.43 | 41.3% | 5493 | 33.28× | −24.2% | 0% | Made less than holding (or not clearly more) |
| Volatility targeting on ETH | 0.15, 0.15, 0.15 | −0.3% | 5.8% | 70.0% | 0.31 | 39.3% | 81 | 7.19× | −6.1% | 0% | Lost money |
| Portfolio insurance (CPPI) on ETH | 3, 3, 3 | −4.0% | 5.8% | 53.4% | 0.07 | 41.4% | 5833 | 43.99× | −9.8% | 0% | Lost money |
| Portfolio insurance (TIPP) on BTC | 3, 3, 3 | 0.0% | 33.4% | 1.6% | 0.03 | 47.9% | 179 | 0.23× | −33.4% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on ETH | 3, 3, 3 | 0.0% | 5.8% | 0.0% | 0.00 | – | 0 | 0.00× | −5.8% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on BTC | 12, 12, 12 | −31.0% | 33.4% | 75.5% | −0.70 | 24.0% | 229 | 229.31× | −64.4% | 0% | Lost money |
| Time-series momentum on ETH | 12, 12, 12 | −40.7% | 5.8% | 84.6% | −1.07 | 23.8% | 234 | 226.07× | −46.5% | 0% | Lost money |
| Trend filter on US stocks on BTC | 200, 200, 200 | −43.3% | 33.4% | 87.9% | −1.17 | 21.6% | 281 | 276.21× | −76.7% | 0% | Lost money |
| Trend filter on US stocks on ETH | 200, 200, 200 | −45.0% | 5.8% | 88.4% | −1.27 | 24.6% | 285 | 282.18× | −50.8% | 0% | Lost money |
| Trend filter with volatility targeting on BTC | 0.18, 0.18, 0.18 | −73.0% | 33.4% | 99.0% | −2.95 | 15.6% | 566 | 550.86× | −106.4% | 0% | Lost money |
| Trend filter with volatility targeting on ETH | 0.18, 0.18, 0.18 | −77.1% | 5.8% | 99.4% | −3.39 | 15.6% | 594 | 577.38× | −82.9% | 0% | Lost money |
| Crypto trend | 200, 200, 200 | −74.6% | 33.4% | 99.2% | −3.68 | 58.9% | 3032 | 567.41× | −108.0% | 0% | Lost money |
| Bollinger band pullbacks on ETH | 2, 2, 2 | −70.7% | 5.8% | 98.6% | −6.43 | 24.9% | 451 | 446.31× | −76.5% | 0% | Lost money |
| Crypto momentum | 90, 90, 90 | −97.5% | 33.4% | 100.0% | −7.11 | 17.0% | 1434 | 1448.39× | −130.9% | 0% | Lost money |
| Bollinger band pullbacks on BTC | 2, 2, 2 | −69.7% | 33.4% | 98.5% | −7.73 | 16.1% | 462 | 466.69× | −103.1% | 0% | Lost money |
| RSI(2) pullbacks on ETH | 5, 5, 5 | −86.3% | 5.8% | 99.9% | −13.60 | 8.7% | 752 | 738.32× | −92.1% | 0% | Lost money |
| RSI(2) pullbacks on BTC | 5, 5, 5 | −87.1% | 33.4% | 99.9% | −16.30 | 4.4% | 779 | 763.20× | −120.5% | 0% | Lost money |
| Internal bar strength on ETH | 0.15, 0.15, 0.15 | −100.0% | 5.8% | 100.0% | −83.86 | 2.9% | 11166 | 10148.34× | −105.8% | 0% | Lost money |
| Internal bar strength on BTC | 0.15, 0.15, 0.15 | −100.0% | 33.4% | 100.0% | −92.24 | 1.6% | 10881 | 10094.02× | −133.4% | 0% | Lost money |

## Bitcoin and ether, around the clock, every 1 hour

Bars: Alpaca's crypto bars (no key needed). Scored 2023-05-01 to 2026-10-26 (30,580 bars), 300 trials in the haircut. **Just holding BTC: 34.6% a year, worst drop 53.9%, Sharpe 0.88.**

| Strategy | Settings | CAGR | Holding it | Worst drop | Sharpe | Win rate | Trades/yr | Turnover/yr | vs hold | DSR | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Volatility targeting on BTC | 0.15, 0.15, 0.15 | 30.1% | 34.6% | 55.0% | 0.81 | 45.5% | 78 | 7.41× | −4.4% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on BTC | 3, 5, 3 | 19.4% | 34.6% | 41.4% | 0.70 | 43.8% | 1337 | 20.80× | −15.2% | 0% | Made less than holding (or not clearly more) |
| Crypto, held | 0, 0, 0 | 20.6% | 34.6% | 61.3% | 0.62 | 38.1% | 1691 | 4.46× | −14.0% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on ETH | 3, 5, 3 | 2.8% | 7.1% | 61.8% | 0.28 | 40.1% | 1387 | 26.79× | −4.2% | 0% | Made less than holding (or not clearly more) |
| Volatility targeting on ETH | 0.15, 0.15, 0.15 | −5.7% | 7.1% | 72.6% | 0.19 | 40.5% | 224 | 18.38× | −12.8% | 0% | Lost money |
| Portfolio insurance (TIPP) on ETH | 3, 3, 3 | 0.0% | 7.1% | 0.0% | 0.08 | – | 0 | 0.00× | −7.1% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on BTC | 3, 3, 3 | 0.0% | 34.6% | 1.2% | 0.03 | 50.3% | 93 | 0.13× | −34.5% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on BTC | 12, 12, 12 | −5.8% | 34.6% | 50.2% | −0.03 | 26.6% | 63 | 61.72× | −40.4% | 0% | Lost money |
| Trend filter on US stocks on ETH | 150, 150, 150 | −16.8% | 7.1% | 72.3% | −0.26 | 24.2% | 88 | 85.71× | −23.8% | 0% | Lost money |
| Time-series momentum on ETH | 6, 6, 12 | −19.0% | 7.1% | 75.8% | −0.32 | 28.4% | 81 | 77.80× | −26.0% | 0% | Lost money |
| Trend filter on US stocks on BTC | 150, 150, 150 | −14.8% | 34.6% | 65.3% | −0.35 | 25.5% | 88 | 86.17× | −49.3% | 0% | Lost money |
| Trend filter with volatility targeting on BTC | 0.18, 0.18, 0.18 | −19.2% | 34.6% | 65.1% | −0.52 | 24.1% | 155 | 138.26× | −53.8% | 0% | Lost money |
| Trend filter with volatility targeting on ETH | 0.18, 0.18, 0.18 | −33.8% | 7.1% | 80.6% | −0.85 | 24.7% | 175 | 142.59× | −40.9% | 0% | Lost money |
| Crypto trend | 100, 200, 200 | −33.6% | 34.6% | 76.8% | −1.12 | 68.8% | 1179 | 173.69× | −68.2% | 0% | Lost money |
| Bollinger band pullbacks on ETH | 2, 2, 2 | −29.1% | 7.1% | 70.5% | −1.83 | 52.6% | 111 | 111.90× | −36.2% | 0% | Lost money |
| Bollinger band pullbacks on BTC | 2, 2, 2 | −25.4% | 34.6% | 64.5% | −1.83 | 40.8% | 125 | 124.41× | −60.0% | 0% | Lost money |
| Crypto momentum | 60, 90, 90 | −62.9% | 34.6% | 97.0% | −2.20 | 26.1% | 396 | 387.68× | −97.5% | 0% | Lost money |
| RSI(2) pullbacks on ETH | 5, 5, 5 | −39.3% | 7.1% | 82.6% | −3.85 | 27.5% | 180 | 179.13× | −46.3% | 0% | Lost money |
| RSI(2) pullbacks on BTC | 5, 5, 5 | −37.1% | 34.6% | 80.2% | −4.52 | 17.0% | 185 | 185.61× | −71.7% | 0% | Lost money |
| Internal bar strength on ETH | 0.15, 0.15, 0.15 | −99.8% | 7.1% | 100.0% | −21.58 | 13.5% | 2231 | 2193.33× | −106.8% | 0% | Lost money |
| Internal bar strength on BTC | 0.15, 0.15, 0.15 | −99.8% | 34.6% | 100.0% | −27.44 | 10.0% | 2337 | 2252.61× | −134.4% | 0% | Lost money |

## US funds, in market hours, every 15 minutes

Bars: Alpaca's stock bars (SIP feed, split- and dividend-adjusted, regular hours; hourly bars are the 15-minute ones joined from the 9:30 open). Scored 2022-02-11 to 2026-10-23 (30,638 bars), 300 trials in the haircut. **Just holding SPY: 13.6% a year, worst drop 23.7%, Sharpe 0.85.**

| Strategy | Settings | CAGR | Holding it | Worst drop | Sharpe | Win rate | Trades/yr | Turnover/yr | vs hold | DSR | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Portfolio insurance (CPPI) on SPY | 5, 5, 5 | 13.4% | 13.6% | 21.1% | 0.89 | 69.3% | 608 | 7.90× | −0.2% | 0% | Made less than holding (or not clearly more) |
| Value | 0, 0, 0 | 12.2% | 13.6% | 18.0% | 0.89 | – | 0 | 0.00× | −1.3% | 0% | Made less than holding (or not clearly more) |
| Volatility targeting on SPY | 0.1, 0.1, 0.1 | 13.8% | 13.6% | 23.7% | 0.88 | 53.8% | 13 | 0.99× | 0.3% | 0% | Made less than holding (or not clearly more) |
| Trend filter with volatility targeting on QQQ | 0.18, 0.18, 0.18 | 11.5% | 16.6% | 16.8% | 0.86 | 27.9% | 84 | 82.97× | −5.1% | 0% | Made less than holding (or not clearly more) |
| Volatility targeting on QQQ | 0.1, 0.1, 0.1 | 16.8% | 16.6% | 30.2% | 0.83 | 58.2% | 30 | 1.94× | 0.2% | 0% | Made less than holding (or not clearly more) |
| Quality | 0, 0, 0 | 13.2% | 13.6% | 25.3% | 0.83 | – | 0 | 0.00× | −0.4% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on QQQ | 5, 5, 5 | 15.8% | 16.6% | 28.6% | 0.82 | 60.3% | 640 | 10.66× | −0.8% | 0% | Made less than holding (or not clearly more) |
| Dividend growth | 0, 0, 0 | 11.2% | 13.6% | 18.6% | 0.82 | – | 0 | 0.00× | −2.3% | 0% | Made less than holding (or not clearly more) |
| Your mix with absolute momentum | 12, 12, 12 | 7.9% | 13.6% | 12.5% | 0.80 | 40.5% | 36 | 36.06× | −5.7% | 0% | Made less than holding (or not clearly more) |
| Multi-factor | 0, 0, 0 | 11.4% | 13.6% | 20.4% | 0.77 | 73.1% | 373 | 0.64× | −2.2% | 0% | Made less than holding (or not clearly more) |
| 60/40 | 0, 0, 0 | 8.1% | 13.6% | 18.7% | 0.77 | 64.0% | 337 | 0.83× | −5.5% | 0% | Made less than holding (or not clearly more) |
| Permanent portfolio | 0, 0, 0 | 6.2% | 13.6% | 16.4% | 0.76 | 61.0% | 457 | 1.01× | −7.3% | 0% | Made less than holding (or not clearly more) |
| Low volatility | 0, 0, 0 | 8.8% | 13.6% | 17.9% | 0.76 | – | 0 | 0.00× | −4.8% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on QQQ | 3, 3, 3 | 6.2% | 16.6% | 12.0% | 0.74 | 70.5% | 931 | 3.89× | −10.4% | 0% | Made less than holding (or not clearly more) |
| Golden butterfly | 0, 0, 0 | 7.1% | 13.6% | 17.0% | 0.74 | 62.3% | 600 | 1.18× | −6.4% | 0% | Made less than holding (or not clearly more) |
| Managed futures (ETF) | 0, 0, 0 | 9.7% | 13.6% | 21.1% | 0.71 | – | 0 | 0.00× | −3.8% | 0% | Made less than holding (or not clearly more) |
| No-Brainer portfolio | 0, 0, 0 | 8.6% | 13.6% | 18.3% | 0.71 | 69.9% | 435 | 0.81× | −5.0% | 0% | Made less than holding (or not clearly more) |
| Momentum | 0, 0, 0 | 13.9% | 13.6% | 24.9% | 0.70 | – | 0 | 0.00× | 0.3% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on SPY | 5, 3, 3 | 5.1% | 13.6% | 12.8% | 0.70 | 76.2% | 945 | 4.32× | −8.5% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on QQQ | 12, 12, 9 | 8.8% | 16.6% | 20.0% | 0.69 | 36.2% | 40 | 40.44× | −7.8% | 0% | Made less than holding (or not clearly more) |
| HAA with the No-Brainer | 0, 0, 0 | 5.8% | 13.6% | 11.1% | 0.68 | 57.8% | 760 | 63.99× | −7.8% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on SPY | 9, 12, 12 | 6.4% | 13.6% | 13.2% | 0.68 | 37.2% | 40 | 39.82× | −7.1% | 0% | Made less than holding (or not clearly more) |
| Trend filter with volatility targeting on SPY | 0.18, 0.18, 0.18 | 6.2% | 13.6% | 13.7% | 0.64 | 27.4% | 93 | 92.66× | −7.4% | 0% | Made less than holding (or not clearly more) |
| Sector rotation with a trend filter | 3, 3, 3 | 7.6% | 13.6% | 15.1% | 0.62 | 67.5% | 749 | 151.58× | −6.0% | 0% | Made less than holding (or not clearly more) |
| Equal weight S&P 500 | 0, 0, 0 | 9.0% | 13.6% | 21.5% | 0.61 | – | 0 | 0.00× | −4.6% | 0% | Made less than holding (or not clearly more) |
| Sector rotation | 12, 12, 12 | 8.4% | 13.6% | 24.3% | 0.60 | 68.4% | 770 | 118.02× | −5.1% | 0% | Made less than holding (or not clearly more) |
| Coffeehouse portfolio | 0, 0, 0 | 5.7% | 13.6% | 18.1% | 0.56 | 69.8% | 402 | 0.68× | −7.9% | 0% | Made less than holding (or not clearly more) |
| Factor rotation | 12, 12, 12 | 8.0% | 13.6% | 23.8% | 0.56 | 64.3% | 448 | 107.80× | −5.6% | 0% | Made less than holding (or not clearly more) |
| Maximum diversification with a trend filter | 252, 252, 252 | 3.4% | 13.6% | 8.8% | 0.56 | 61.5% | 1178 | 86.44× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Trend filter on US stocks on QQQ | 200, 200, 200 | 6.8% | 16.6% | 17.0% | 0.55 | 35.0% | 52 | 52.08× | −9.8% | 0% | Made less than holding (or not clearly more) |
| Shareholder yield | 0, 0, 0 | 8.5% | 13.6% | 27.9% | 0.50 | – | 0 | 0.00× | −5.1% | 0% | Made less than holding (or not clearly more) |
| Faber GTAA / Ivy 5 | 12, 12, 12 | 3.0% | 13.6% | 7.8% | 0.49 | 70.8% | 467 | 46.39× | −10.5% | 0% | Made less than holding (or not clearly more) |
| Risk parity (inverse volatility) | 126, 126, 126 | 3.6% | 13.6% | 18.7% | 0.49 | 53.1% | 1380 | 18.27× | −10.0% | 0% | Made less than holding (or not clearly more) |
| Composite dual momentum | 12, 12, 12 | 3.3% | 13.6% | 9.7% | 0.44 | 66.1% | 581 | 79.81× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Small value | 0, 0, 0 | 7.5% | 13.6% | 30.5% | 0.43 | – | 0 | 0.00× | −6.1% | 0% | Made less than holding (or not clearly more) |
| Small companies | 0, 0, 0 | 7.2% | 13.6% | 29.7% | 0.43 | – | 0 | 0.00× | −6.3% | 0% | Made less than holding (or not clearly more) |
| Trend filter on US stocks on SPY | 200, 200, 200 | 3.8% | 13.6% | 12.4% | 0.42 | 33.9% | 52 | 51.51× | −9.8% | 0% | Made less than holding (or not clearly more) |
| Your mix with a trend filter | 10, 10, 10 | 3.8% | 13.6% | 12.4% | 0.40 | 35.7% | 49 | 48.95× | −9.8% | 0% | Made less than holding (or not clearly more) |
| All-weather (fixed) | 0, 0, 0 | 3.4% | 13.6% | 21.9% | 0.39 | 63.6% | 497 | 1.04× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Hybrid asset allocation (HAA) | 4, 4, 4 | 2.6% | 13.6% | 10.9% | 0.35 | 58.7% | 589 | 127.51× | −10.9% | 0% | Made less than holding (or not clearly more) |
| Dual momentum (GEM) | 12, 12, 12 | 3.2% | 13.6% | 16.0% | 0.34 | 46.9% | 110 | 111.31× | −10.4% | 0% | Made less than holding (or not clearly more) |
| Low volatility with a trend filter | 10, 10, 10 | 2.3% | 13.6% | 14.5% | 0.33 | 30.8% | 56 | 54.89× | −11.3% | 0% | Made less than holding (or not clearly more) |
| Maximum diversification | 252, 252, 252 | 2.6% | 13.6% | 22.5% | 0.29 | 52.2% | 1916 | 82.45× | −11.0% | 0% | Made less than holding (or not clearly more) |
| Larry portfolio | 0, 0, 0 | 2.0% | 13.6% | 17.0% | 0.29 | 67.8% | 326 | 0.65× | −11.6% | 0% | Made less than holding (or not clearly more) |
| Watch-list blend | 0, 0, 0 | 1.1% | 13.6% | 13.0% | 0.17 | 51.7% | 1926 | 146.07× | −12.4% | 0% | Made less than holding (or not clearly more) |
| Elastic asset allocation (EAA) | 2, 2, 2 | 0.8% | 13.6% | 13.6% | 0.13 | 47.3% | 1687 | 169.84× | −12.8% | 0% | Made less than holding (or not clearly more) |
| Hierarchical risk parity | 252, 252, 252 | 0.5% | 13.6% | 18.3% | 0.11 | 52.7% | 2521 | 51.02× | −13.1% | 0% | Made less than holding (or not clearly more) |
| Minimum variance | 252, 252, 252 | 0.2% | 13.6% | 21.5% | 0.07 | 53.5% | 1318 | 34.10× | −13.3% | 0% | Made less than holding (or not clearly more) |
| Protective asset allocation (PAA) | 1, 2, 2 | 0.1% | 13.6% | 18.9% | 0.05 | 54.0% | 1300 | 114.77× | −13.5% | 0% | Made less than holding (or not clearly more) |
| Faber GTAA aggressive | 3, 5, 5 | −0.9% | 13.6% | 24.5% | −0.04 | 59.8% | 804 | 129.44× | −14.4% | 0% | Lost money |
| Bold asset allocation (BAA) | 6, 1, 6 | −0.9% | 13.6% | 21.4% | −0.05 | 53.5% | 770 | 185.82× | −14.5% | 0% | Lost money |
| Vigilant asset allocation (VAA-G4) | 1, 1, 1 | −0.8% | 13.6% | 21.1% | −0.05 | 41.6% | 339 | 338.38× | −14.4% | 0% | Lost money |
| Hierarchical risk parity with a trend filter | 252, 252, 252 | −0.3% | 13.6% | 9.5% | −0.07 | 65.2% | 1648 | 77.01× | −13.9% | 0% | Lost money |
| Adaptive asset allocation | 5, 5, 3 | −1.8% | 13.6% | 25.7% | −0.15 | 49.7% | 1065 | 288.36× | −15.4% | 0% | Lost money |
| Kipnis defensive adaptive (KDA) | 5, 5, 5 | −2.9% | 13.6% | 20.9% | −0.37 | 47.6% | 1051 | 268.86× | −16.5% | 0% | Lost money |
| Defensive asset allocation (DAA) | 6, 3, 3 | −4.5% | 13.6% | 22.4% | −0.43 | 49.1% | 1336 | 337.06× | −18.0% | 0% | Lost money |
| Bollinger band pullbacks on SPY | 2, 2, 2 | −2.2% | 13.6% | 14.5% | −0.45 | 60.5% | 108 | 108.20× | −15.7% | 0% | Lost money |
| Bollinger band pullbacks on QQQ | 1.5, 1.5, 1.5 | −3.6% | 16.6% | 28.1% | −0.45 | 64.6% | 155 | 155.31× | −20.2% | 0% | Lost money |
| Accelerating dual momentum | 0, 0, 0 | −9.4% | 13.6% | 42.9% | −0.67 | 42.9% | 290 | 287.86× | −23.0% | 0% | Lost money |
| Bond rotation | 6, 6, 6 | −7.8% | 13.6% | 36.5% | −0.76 | 37.7% | 175 | 175.53× | −21.3% | 0% | Lost money |
| RSI(2) pullbacks on QQQ | 5, 5, 5 | −4.5% | 16.6% | 23.8% | −0.95 | 57.5% | 170 | 171.06× | −21.1% | 0% | Lost money |
| RSI(2) pullbacks on SPY | 10, 5, 5 | −6.7% | 13.6% | 28.1% | −1.79 | 50.8% | 220 | 218.14× | −20.2% | 0% | Lost money |
| Internal bar strength on QQQ | 0.15, 0.15, 0.15 | −36.0% | 16.6% | 87.7% | −4.27 | 38.7% | 1742 | 1739.48× | −52.6% | 0% | Lost money |
| Internal bar strength on SPY | 0.15, 0.15, 0.15 | −37.1% | 13.6% | 88.6% | −6.06 | 31.6% | 1718 | 1722.48× | −50.6% | 0% | Lost money |

## US funds, in market hours, every 1 hour

Bars: Alpaca's stock bars (SIP feed, split- and dividend-adjusted, regular hours; hourly bars are the 15-minute ones joined from the 9:30 open). Scored 2022-02-11 to 2026-10-23 (8,249 bars), 300 trials in the haircut. **Just holding SPY: 13.6% a year, worst drop 23.1%, Sharpe 0.85.**

| Strategy | Settings | CAGR | Holding it | Worst drop | Sharpe | Win rate | Trades/yr | Turnover/yr | vs hold | DSR | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vigilant asset allocation (VAA-G4) | 1, 1, 1 | 8.6% | 13.6% | 13.5% | 0.89 | 51.6% | 96 | 96.37× | −5.0% | 0% | Made less than holding (or not clearly more) |
| Value | 0, 0, 0 | 12.2% | 13.6% | 17.6% | 0.89 | – | 0 | 0.00× | −1.3% | 0% | Made less than holding (or not clearly more) |
| Volatility targeting on SPY | 0.1, 0.1, 0.1 | 13.0% | 13.6% | 22.1% | 0.86 | 44.6% | 32 | 2.31× | −0.6% | 0% | Made less than holding (or not clearly more) |
| Trend filter with volatility targeting on QQQ | 0.18, 0.18, 0.18 | 11.6% | 16.6% | 17.6% | 0.86 | 36.4% | 24 | 22.91× | −4.9% | 0% | Made less than holding (or not clearly more) |
| Trend filter with volatility targeting on SPY | 0.18, 0.18, 0.18 | 8.5% | 13.6% | 12.9% | 0.85 | 32.2% | 25 | 24.99× | −5.0% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on SPY | 3, 3, 3 | 6.1% | 13.6% | 10.4% | 0.84 | 76.8% | 299 | 1.89× | −7.4% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on SPY | 5, 5, 5 | 11.8% | 13.6% | 20.1% | 0.84 | 69.6% | 142 | 3.60× | −1.7% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (CPPI) on QQQ | 5, 5, 5 | 15.3% | 16.6% | 25.7% | 0.83 | 65.3% | 135 | 4.40× | −1.3% | 0% | Made less than holding (or not clearly more) |
| Dividend growth | 0, 0, 0 | 11.2% | 13.6% | 18.1% | 0.83 | – | 0 | 0.00× | −2.3% | 0% | Made less than holding (or not clearly more) |
| Quality | 0, 0, 0 | 13.2% | 13.6% | 24.8% | 0.83 | – | 0 | 0.00× | −0.4% | 1% | Made less than holding (or not clearly more) |
| Volatility targeting on QQQ | 0.1, 0.1, 0.1 | 15.5% | 16.6% | 28.9% | 0.82 | 59.3% | 76 | 5.55× | −1.1% | 0% | Made less than holding (or not clearly more) |
| Managed futures (ETF) | 0, 0, 0 | 9.7% | 13.6% | 20.8% | 0.78 | – | 0 | 0.00× | −3.8% | 0% | Made less than holding (or not clearly more) |
| Trend filter on US stocks on QQQ | 150, 150, 150 | 10.4% | 16.6% | 20.7% | 0.78 | 45.7% | 15 | 15.23× | −6.1% | 0% | Made less than holding (or not clearly more) |
| Multi-factor | 0, 0, 0 | 11.4% | 13.6% | 19.9% | 0.78 | 73.7% | 192 | 0.45× | −2.2% | 0% | Made less than holding (or not clearly more) |
| Your mix with a trend filter | 10, 10, 10 | 8.1% | 13.6% | 18.5% | 0.77 | 37.0% | 12 | 11.54× | −5.4% | 0% | Made less than holding (or not clearly more) |
| 60/40 | 0, 0, 0 | 8.1% | 13.6% | 18.2% | 0.76 | 65.0% | 121 | 0.46× | −5.5% | 0% | Made less than holding (or not clearly more) |
| Low volatility | 0, 0, 0 | 8.8% | 13.6% | 17.5% | 0.76 | – | 0 | 0.00× | −4.8% | 0% | Made less than holding (or not clearly more) |
| Permanent portfolio | 0, 0, 0 | 6.2% | 13.6% | 16.3% | 0.76 | 61.3% | 180 | 0.58× | −7.4% | 0% | Made less than holding (or not clearly more) |
| Portfolio insurance (TIPP) on QQQ | 3, 3, 3 | 6.4% | 16.6% | 11.4% | 0.76 | 75.3% | 306 | 2.29× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Golden butterfly | 0, 0, 0 | 7.1% | 13.6% | 16.6% | 0.73 | 63.6% | 259 | 0.72× | −6.5% | 0% | Made less than holding (or not clearly more) |
| Momentum | 0, 0, 0 | 13.9% | 13.6% | 24.5% | 0.71 | – | 0 | 0.00× | 0.3% | 2% | Made less than holding (or not clearly more) |
| No-Brainer portfolio | 0, 0, 0 | 8.6% | 13.6% | 17.8% | 0.71 | 71.0% | 200 | 0.53× | −5.0% | 0% | Made less than holding (or not clearly more) |
| HAA with the No-Brainer | 0, 0, 0 | 6.0% | 13.6% | 11.0% | 0.70 | 64.6% | 289 | 18.66× | −7.6% | 0% | Made less than holding (or not clearly more) |
| Factor rotation | 12, 6, 6 | 10.2% | 13.6% | 23.1% | 0.69 | 67.9% | 158 | 38.89× | −3.4% | 0% | Made less than holding (or not clearly more) |
| Bollinger band pullbacks on SPY | 2, 2, 2 | 3.4% | 13.6% | 4.5% | 0.67 | 72.0% | 32 | 32.13× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Elastic asset allocation (EAA) | 2, 2, 2 | 6.1% | 13.6% | 10.2% | 0.67 | 52.8% | 473 | 45.74× | −7.4% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on QQQ | 6, 6, 6 | 8.8% | 16.6% | 22.6% | 0.66 | 44.7% | 16 | 16.19× | −7.8% | 0% | Made less than holding (or not clearly more) |
| Faber GTAA / Ivy 5 | 8, 8, 8 | 4.1% | 13.6% | 7.6% | 0.64 | 74.2% | 188 | 15.94× | −9.5% | 0% | Made less than holding (or not clearly more) |
| Faber GTAA aggressive | 5, 5, 5 | 5.1% | 13.6% | 10.2% | 0.62 | 69.2% | 278 | 30.06× | −8.5% | 0% | Made less than holding (or not clearly more) |
| Equal weight S&P 500 | 0, 0, 0 | 9.0% | 13.6% | 20.8% | 0.61 | – | 0 | 0.00× | −4.6% | 0% | Made less than holding (or not clearly more) |
| Watch-list blend | 0, 0, 0 | 5.1% | 13.6% | 9.8% | 0.61 | 59.0% | 536 | 39.58× | −8.5% | 0% | Made less than holding (or not clearly more) |
| Sector rotation with a trend filter | 3, 3, 3 | 7.5% | 13.6% | 20.1% | 0.60 | 69.4% | 244 | 44.73× | −6.1% | 0% | Made less than holding (or not clearly more) |
| Risk parity (inverse volatility) | 63, 63, 63 | 4.4% | 13.6% | 18.4% | 0.58 | 55.1% | 388 | 7.35× | −9.2% | 0% | Made less than holding (or not clearly more) |
| Coffeehouse portfolio | 0, 0, 0 | 5.7% | 13.6% | 17.7% | 0.56 | 74.8% | 209 | 0.45× | −7.9% | 0% | Made less than holding (or not clearly more) |
| Trend filter on US stocks on SPY | 100, 100, 150 | 5.3% | 13.6% | 20.9% | 0.54 | 44.2% | 19 | 18.68× | −8.2% | 0% | Made less than holding (or not clearly more) |
| Bold asset allocation (BAA) | 6, 6, 6 | 4.1% | 13.6% | 12.4% | 0.52 | 59.0% | 300 | 51.89× | −9.5% | 0% | Made less than holding (or not clearly more) |
| Kipnis defensive adaptive (KDA) | 5, 5, 5 | 3.6% | 13.6% | 9.7% | 0.51 | 52.5% | 294 | 74.17× | −10.0% | 0% | Made less than holding (or not clearly more) |
| Protective asset allocation (PAA) | 2, 1, 1 | 4.3% | 13.6% | 17.8% | 0.50 | 63.0% | 412 | 33.20× | −9.3% | 0% | Made less than holding (or not clearly more) |
| Shareholder yield | 0, 0, 0 | 8.5% | 13.6% | 27.3% | 0.50 | – | 0 | 0.00× | −5.1% | 0% | Made less than holding (or not clearly more) |
| Sector rotation | 6, 6, 3 | 6.3% | 13.6% | 21.0% | 0.47 | 66.0% | 283 | 51.08× | −7.3% | 0% | Made less than holding (or not clearly more) |
| Small value | 0, 0, 0 | 7.5% | 13.6% | 29.9% | 0.43 | – | 0 | 0.00× | −6.1% | 0% | Made less than holding (or not clearly more) |
| Small companies | 0, 0, 0 | 7.2% | 13.6% | 29.0% | 0.43 | – | 0 | 0.00× | −6.3% | 0% | Made less than holding (or not clearly more) |
| Hybrid asset allocation (HAA) | 4, 4, 4 | 3.2% | 13.6% | 10.1% | 0.42 | 64.1% | 192 | 36.79× | −10.4% | 0% | Made less than holding (or not clearly more) |
| All-weather (fixed) | 0, 0, 0 | 3.3% | 13.6% | 21.9% | 0.38 | 62.5% | 222 | 0.63× | −10.2% | 0% | Made less than holding (or not clearly more) |
| Defensive asset allocation (DAA) | 6, 6, 6 | 2.9% | 13.6% | 12.8% | 0.37 | 55.1% | 498 | 83.01× | −10.7% | 0% | Made less than holding (or not clearly more) |
| Adaptive asset allocation | 5, 3, 3 | 2.8% | 13.6% | 23.5% | 0.34 | 50.8% | 273 | 76.93× | −10.7% | 0% | Made less than holding (or not clearly more) |
| RSI(2) pullbacks on SPY | 5, 5, 5 | 1.3% | 13.6% | 4.9% | 0.33 | 59.9% | 60 | 60.76× | −12.3% | 0% | Made less than holding (or not clearly more) |
| Time-series momentum on SPY | 12, 9, 9 | 2.8% | 13.6% | 24.7% | 0.32 | 37.9% | 13 | 12.43× | −10.8% | 0% | Made less than holding (or not clearly more) |
| Larry portfolio | 0, 0, 0 | 2.0% | 13.6% | 16.8% | 0.29 | 76.0% | 148 | 0.41× | −11.6% | 0% | Made less than holding (or not clearly more) |
| Your mix with absolute momentum | 12, 12, 12 | 2.4% | 13.6% | 24.6% | 0.27 | 35.7% | 12 | 11.60× | −11.2% | 0% | Made less than holding (or not clearly more) |
| Hierarchical risk parity | 126, 126, 126 | 1.6% | 13.6% | 17.5% | 0.27 | 56.2% | 737 | 17.34× | −12.0% | 0% | Made less than holding (or not clearly more) |
| Dual momentum (GEM) | 9, 9, 6 | 2.4% | 13.6% | 21.6% | 0.27 | 43.0% | 40 | 41.09× | −11.2% | 0% | Made less than holding (or not clearly more) |
| Composite dual momentum | 12, 12, 12 | 1.7% | 13.6% | 15.4% | 0.25 | 71.3% | 195 | 21.84× | −11.8% | 0% | Made less than holding (or not clearly more) |
| Maximum diversification with a trend filter | 252, 252, 252 | 1.1% | 13.6% | 13.7% | 0.21 | 62.8% | 312 | 22.92× | −12.5% | 0% | Made less than holding (or not clearly more) |
| Minimum variance | 126, 126, 126 | 1.1% | 13.6% | 19.4% | 0.19 | 53.8% | 387 | 13.48× | −12.5% | 0% | Made less than holding (or not clearly more) |
| Hierarchical risk parity with a trend filter | 252, 252, 252 | 0.7% | 13.6% | 6.2% | 0.19 | 68.0% | 443 | 19.73× | −12.9% | 0% | Made less than holding (or not clearly more) |
| Maximum diversification | 126, 126, 126 | 1.3% | 13.6% | 28.3% | 0.18 | 50.7% | 553 | 29.74× | −12.2% | 0% | Made less than holding (or not clearly more) |
| Bollinger band pullbacks on QQQ | 1.5, 2, 2 | 1.0% | 16.6% | 12.5% | 0.17 | 66.3% | 38 | 38.07× | −15.6% | 0% | Made less than holding (or not clearly more) |
| Low volatility with a trend filter | 10, 10, 10 | 0.4% | 13.6% | 18.5% | 0.09 | 38.2% | 15 | 14.30× | −13.2% | 0% | Made less than holding (or not clearly more) |
| Accelerating dual momentum | 0, 0, 0 | −1.0% | 13.6% | 33.7% | 0.00 | 42.0% | 69 | 68.17× | −14.6% | 0% | Lost money |
| Bond rotation | 3, 3, 3 | −1.1% | 13.6% | 17.3% | −0.07 | 44.0% | 64 | 63.98× | −14.6% | 0% | Lost money |
| RSI(2) pullbacks on QQQ | 10, 10, 5 | −2.4% | 16.6% | 15.8% | −0.36 | 61.2% | 88 | 87.67× | −19.0% | 0% | Lost money |
| Internal bar strength on QQQ | 0.15, 0.25, 0.15 | −14.4% | 16.6% | 54.8% | −1.53 | 46.8% | 514 | 515.66× | −31.0% | 0% | Lost money |
| Internal bar strength on SPY | 0.15, 0.15, 0.15 | −13.7% | 13.6% | 49.8% | −2.05 | 42.2% | 447 | 446.66× | −27.2% | 0% | Lost money |
