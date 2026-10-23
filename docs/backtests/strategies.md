# Strategies by level: what each level's practice portfolio follows, and why

The practice autopilot used to hold one fixed mix per level ("a percentage in stocks"). This log
replays a small library of strategies (`src/planning/strategies/`) over real prices, per level,
and records which one each level follows and the numbers behind it. Practice money and demo
advice only: these are replays of the past, never a forecast. REAL_ACCOUNT_ADVICE stays false.

## The strategies (each with a small, fixed grid: `STRATEGY_GRID` in `src/config/strategies.ts`)

| Strategy | What it does | Grid |
| --- | --- | --- |
| `static` | The level's mix (today's autopilot), rebalanced on the 5-point band or on the calendar | band, monthly, quarterly, annual |
| `inverse_vol` | Each sleeve (or everything) split in inverse proportion to each fund's volatility | 63 or 126 days; by sleeve or all |
| `vol_target` | The mix with stocks scaled down when their volatility would take the portfolio past the level's cap; the rest in bills | 21 or 63 days |
| `trend` | The mix, each risky fund held only while above its moving average; otherwise bills | 6 or 10 months |
| `dual_momentum` | The stock sleeve in the stock fund with the best return (relative), or intermediate Treasuries when even that trails bills (absolute) | 126 or 252 days |
| `min_variance` | The least-volatile long-only mix with the level's stock share | 126 or 252 days |
| `cppi` | A floor the level's maximum drawdown below the high; stocks are a multiple of the cushion | multiplier 3 or 5 |

Every strategy's weights go through the same limits (`finish` in `library.ts`):
- never more stocks than the level's mix, so no strategy takes more risk than its level;
- no fund over 60%, and gold at most 15%;
- no negatives, no leverage, no shorting, no options;
- whatever is left goes to bills.

The universe is plain index ETFs (`STRATEGY_ASSETS` in `src/config/portfolios.ts`): VTI, VBR, VXUS, VEA, VWO, VNQ, BND, SHY, IEF, TLT, TIP, GLD and BIL.

## How a level's strategy is chosen (`src/planning/strategies/select.ts`)

- **The budget.** Each level has a risk budget (`RISK_BUDGETS`): a maximum drawdown and a volatility cap, from Very low (8%, 5%) to Very high (40%, 18%).
- **Walk-forward.** Every candidate (18: each strategy with each parameter set) is replayed on the training years (the start year to 2021). The pick is the best Sortino ratio inside the budget, after 2 basis points a trade. The pick is then scored from a fresh start on 2022 to now.
- **Kept only if it wins.** The pick is kept only if, on the later years, it stays inside the budget and beats the level's mix by at least 10% of its Sortino (or the mix itself breaks the budget there).
- **Different start years.** The same choice is made from 2016, 2017 and 2018 starts. The pick from each must win on the later years too; otherwise the level keeps its mix.
- **Sortino** is the return above bills for each unit of volatility below bills' daily return. Fund costs are inside the adjusted closes, and taxes aren't counted.

## Data
- **Here:** the real-closes fixture (`src/lib/market/__fixtures__/real/`), Yahoo Finance's keyless adjusted daily closes, 2016-01-04 to 2026-10-21. Stooq's download now asks for a browser check.
- **In production:** the weekly evaluation job reruns the same choice on the Alpaca history stored in `market_prices`, and the autopilot follows that.
- **Limits of this data:**
  - It starts in 2016, so it has no 2008. Its stress periods are late 2018, 2020 and 2022.
  - Training (2016–2021) and the later years (2022–2026) each hold one sharp fall. 2022 was unusual: stocks and bonds fell together.

## Results, 2026-10-23 (fixture)

| Level | Budget (worst drop / volatility) | Follows | The mix on 2022 to now | The chosen strategy on 2022 to now |
| --- | --- | --- | --- | --- |
| Very low | 8% / 5% | Trend filter, 6 months | worst drop 17.0%, Sortino −0.06 | worst drop 4.0%, Sortino 0.15 |
| Low | 15% / 8% | Trend filter, 6 months | worst drop 19.3%, Sortino 0.18 | worst drop 5.2%, Sortino 0.34 |
| Medium | 22% / 11% | Trend filter, 6 months | worst drop 20.9%, Sortino 0.37 | worst drop 6.7%, Sortino 0.48 |
| High | 30% / 14% | Trend filter, 6 months | worst drop 22.6%, Sortino 0.49 | worst drop 8.4%, Sortino 0.56 |
| Very high | 40% / 18% | The mix (band) | worst drop 24.7%, Sortino 0.57 | trend's 0.60 isn't 10% better, so the mix stays |

What it says:
- **The trend filter is the one strategy that wins from every start year, at four of five levels.** Its edge is mostly in falls. On 2022 to now it cut the worst drop to about a third of the mix's, because it stepped out of bonds as well as stocks in 2022. It gave up some return in the rising years (6.2% against 7.1% a year in training at Very low).
- **Very high keeps its mix.** There the trend filter's Sortino on the later years is only 5% better, under the 10% margin.
- **Sensitive to its parameter.** The 10-month filter did clearly worse than the 6-month one on the later years, at every level. The 6-month filter was picked in training from every start year, and the choice is rerun weekly on new data.
- **It trades more.** About four times the portfolio a year, against a quarter for the band. At 2 basis points a trade that costs under 0.1% a year, and taxes don't apply to practice money.
- **The rest don't earn their place on this history:**
  - inverse volatility, volatility targeting, minimum variance, the drawdown floor and dual momentum all trail the trend filter in training;
  - most trail the mix on the later years too;
  - dual momentum trades the most and does worst.
- **Calendar against band rebalancing makes no real difference** (Sortino within 0.05 at every level).

## Research rounds

Each round is run with the research CLI (`STRATEGY_RESEARCH=all RESEARCH_SOURCE=fixture`
locally, or the `strategy-research` workflow on Alpaca bars). Each is scored as above:
walk-forward, chosen on 2016–2021, scored on 2022 to now.

### Round 1, 2026-10-23 (fixture): the library as above
The 6-month trend filter for Very low to High; the mix for Very high. The full tables are below.

### Round 2, 2026-10-23 (fixture): how sensitive is the trend filter to its look-back?
The trend filter on 2022 to now, by look-back in months (Sortino / worst drop):

| Level | The mix | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Very low | −0.06 / 17.0% | −0.21 / 8.8% | −0.20 / 8.3% | −0.14 / 6.8% | **0.15 / 4.0%** | −0.09 / 4.6% | −0.10 / 4.6% | 0.02 / 4.6% | −0.29 / 9.0% | 0.11 / 5.8% |
| Medium | 0.37 / 20.9% | 0.07 / 13.9% | 0.23 / 12.9% | 0.34 / 9.4% | **0.48 / 6.7%** | 0.34 / 7.5% | 0.34 / 7.5% | 0.38 / 7.5% | 0.02 / 14.9% | 0.45 / 10.4% |
| Very high | 0.57 / 24.7% | 0.20 / 18.6% | 0.42 / 17.2% | 0.54 / 12.5% | **0.60 / 10.2%** | 0.53 / 10.4% | 0.53 / 10.4% | 0.53 / 10.4% | 0.15 / 20.4% | 0.58 / 14.6% |

- **What holds across look-backs:** from 5 to 9 months the filter cut the worst drop to a third to a half of the mix's at every level.
- **What doesn't:** its edge in Sortino over the mix is mostly the 6-month window. From 7 to 9 months it is level with the mix at Medium and Very high and below it at Very low.
- **Tried and rejected:** a blend of look-backs (3, 4, 6, 8, 10 and 12 months, each fund held in proportion to the votes) did worse than 6 months on the later years at every level. It was below the mix's Sortino at Very low to High, with worst drops of 6–15%, because the short windows whipsaw. Not added to the library.
- **Kept:** the 6-month filter is still the walk-forward pick from every start year. It is the weakest-supported part of the result, so the daily evaluation and the Alpaca runs re-check it on new data. If Alpaca's closes don't confirm it, the mix comes back by the same rule.

### Round 3, 2026-10-23 (fixture): the filter on one sleeve only
On 2022 to now (Sortino / worst drop), 6-month look-back:

| Level | Both sleeves (the library's) | Bonds only | Stocks only |
| --- | --- | --- | --- |
| Very low | 0.15 / 4.0% | 0.28 / 8.0% | −0.27 / 10.8% |
| Medium | 0.48 / 6.7% | 0.51 / 16.1% | 0.28 / 10.3% |
| Very high | 0.60 / 10.2% | 0.58 / 23.7% | 0.57 / 11.0% |

- **Bonds only** did well on the later years and isn't sensitive to its look-back (10 months is close). But it was weaker in training (Sortino 1.33 against 1.76 at Very low), and its 12.9% training drop breaks Very low's 8% budget. Walk-forward wouldn't choose it, and choosing it for its later years would be fitting them. Not adopted.
- **Stocks only** trails the filter on both sleeves at every level. Not adopted.

### Round 4, 2026-10-23 (Alpaca, IEX feed; workflow run 39935066721): too little history
- **The data:** Alpaca's IEX feed has daily bars only from 2020-07-27 for every fund (1,551 shared trading days to 2026-10-22). So the "training" years are 17 months, the start years 2016–2018 all start in mid-2020, and the 6- and 12-month look-backs barely warm up.
- **What it chose:** each level's training pick (inverse volatility at Very low to High, minimum variance at Very high) failed on the later years. Every level kept its mix, as the rule says when the evidence is too thin.
- **The later years matched the fixture's for the mix** (Medium: worst drop 20.9%, 6.5% a year, Sortino 0.36), so the two data sources agree where they overlap.
- **What changes:** the research workflow now asks Alpaca for the SIP feed by default, which goes back to 2016 on the free plan for bars older than 15 minutes. Production's stored history comes from the same IEX feed, so it has the same 2020 start, and the daily evaluation would keep every level on its mix until it has longer history. See round 5.

## Every candidate, by level (training from 2016; "later" is 2022 to now)

### Very low: worst drop up to 8.0%, volatility up to 5.0%

**Chosen: `trend(months=6)`.** Chosen on 2016 to 2021 (Sortino 1.76, worst drop 5.9%), it then beat the level's mix on the later years: Sortino 0.15 against -0.06, worst drop 4.0% against 17.0%, from every start year tried.

Picks by start year: 2016: `trend(months=6)` (beat the mix later); 2017: `trend(months=6)` (beat the mix later); 2018: `trend(months=6)` (beat the mix later).

| Candidate | Train: yearly | Train: worst drop | Train: volatility | Train: Sortino | Later: yearly | Later: worst drop | Later: volatility | Later: Sortino | Turnover a year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `trend(months=6)` | 6.2% | 5.9% | 4.2% | 1.76 | 4.3% | 4.0% | 4.2% | 0.15 | 3.86× |
| `inverse_vol(windowDays=126,scope=sleeves)` | 6.5% | 11.4% | 5.1% | 1.51 | 3.6% | 14.0% | 6.0% | -0.07 | 0.61× |
| `inverse_vol(windowDays=63,scope=all)` | 3.8% | 6.9% | 2.9% | 1.44 | 3.0% | 12.3% | 5.0% | -0.26 | 0.91× |
| `trend(months=10)` | 5.3% | 5.9% | 4.3% | 1.44 | 2.9% | 9.0% | 4.7% | -0.29 | 3.36× |
| `inverse_vol(windowDays=63,scope=sleeves)` | 6.2% | 11.5% | 5.1% | 1.43 | 3.5% | 14.1% | 6.0% | -0.09 | 0.80× |
| `inverse_vol(windowDays=126,scope=all)` | 4.0% | 7.6% | 3.2% | 1.39 | 3.1% | 12.0% | 5.0% | -0.23 | 0.67× |
| `static(rebalance=quarterly)` | 6.9% | 12.5% | 6.0% | 1.36 | 3.5% | 17.1% | 6.9% | -0.08 | 0.30× |
| `static(rebalance=band)` | 7.1% | 12.8% | 6.2% | 1.36 | 3.6% | 17.0% | 6.8% | -0.06 | 0.25× |
| `static(rebalance=annual)` | 6.7% | 12.5% | 6.0% | 1.33 | 3.6% | 17.0% | 6.8% | -0.07 | 0.26× |
| `static(rebalance=monthly)` | 6.8% | 12.9% | 6.1% | 1.32 | 3.5% | 17.0% | 6.9% | -0.08 | 0.37× |
| `min_variance(windowDays=126)` | 5.2% | 10.4% | 4.6% | 1.27 | 3.6% | 13.3% | 5.0% | -0.09 | 1.53× |
| `vol_target(windowDays=21)` | 5.8% | 11.1% | 5.3% | 1.25 | 3.2% | 16.0% | 6.4% | -0.15 | 0.81× |
| `min_variance(windowDays=252)` | 5.1% | 10.1% | 4.7% | 1.21 | 3.8% | 12.8% | 5.0% | -0.03 | 1.04× |
| `cppi(multiplier=3)` | 5.0% | 10.1% | 4.7% | 1.19 | 2.4% | 12.0% | 4.8% | -0.43 | 0.75× |
| `vol_target(windowDays=63)` | 5.5% | 12.9% | 5.7% | 1.07 | 3.4% | 15.7% | 6.4% | -0.11 | 0.58× |
| `cppi(multiplier=5)` | 4.9% | 12.9% | 5.6% | 0.94 | 2.8% | 12.7% | 5.4% | -0.27 | 0.66× |
| `dual_momentum(lookbackDays=126)` | 4.7% | 13.2% | 6.3% | 0.82 | 2.3% | 14.3% | 6.7% | -0.33 | 3.10× |
| `dual_momentum(lookbackDays=252)` | 3.7% | 12.8% | 6.3% | 0.62 | 3.0% | 15.0% | 6.9% | -0.17 | 2.34× |

### Low: worst drop up to 15.0%, volatility up to 8.0%

**Chosen: `trend(months=6)`.** Chosen on 2016 to 2021 (Sortino 1.73, worst drop 6.6%), it then beat the level's mix on the later years: Sortino 0.34 against 0.18, worst drop 5.2% against 19.3%, from every start year tried.

Picks by start year: 2016: `trend(months=6)` (beat the mix later); 2017: `trend(months=6)` (beat the mix later); 2018: `trend(months=6)` (beat the mix later).

| Candidate | Train: yearly | Train: worst drop | Train: volatility | Train: Sortino | Later: yearly | Later: worst drop | Later: volatility | Later: Sortino | Turnover a year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `trend(months=6)` | 7.8% | 6.6% | 5.5% | 1.73 | 5.2% | 5.2% | 5.4% | 0.34 | 3.99× |
| `trend(months=10)` | 6.8% | 6.6% | 5.7% | 1.44 | 3.4% | 12.1% | 5.9% | -0.12 | 3.76× |
| `inverse_vol(windowDays=63,scope=all)` | 4.2% | 7.3% | 3.3% | 1.43 | 2.9% | 13.0% | 5.3% | -0.26 | 0.95× |
| `inverse_vol(windowDays=126,scope=all)` | 4.4% | 8.0% | 3.6% | 1.40 | 3.0% | 12.7% | 5.3% | -0.23 | 0.69× |
| `static(rebalance=quarterly)` | 8.8% | 16.7% | 8.3% | 1.31 | 4.9% | 19.4% | 8.7% | 0.17 | 0.32× |
| `inverse_vol(windowDays=126,scope=sleeves)` | 8.0% | 16.6% | 7.6% | 1.28 | 4.3% | 17.0% | 7.9% | 0.08 | 0.63× |
| `static(rebalance=annual)` | 8.6% | 16.7% | 8.2% | 1.28 | 5.0% | 19.3% | 8.7% | 0.18 | 0.27× |
| `static(rebalance=band)` | 8.9% | 17.5% | 8.6% | 1.27 | 5.0% | 19.3% | 8.7% | 0.18 | 0.25× |
| `static(rebalance=monthly)` | 8.6% | 17.2% | 8.3% | 1.27 | 4.9% | 19.4% | 8.7% | 0.16 | 0.40× |
| `inverse_vol(windowDays=63,scope=sleeves)` | 7.7% | 16.7% | 7.6% | 1.22 | 4.3% | 17.1% | 7.9% | 0.07 | 0.83× |
| `vol_target(windowDays=21)` | 7.3% | 15.0% | 7.2% | 1.18 | 4.5% | 18.1% | 8.1% | 0.11 | 0.98× |
| `min_variance(windowDays=126)` | 6.9% | 16.0% | 7.0% | 1.15 | 4.1% | 17.9% | 7.1% | 0.04 | 1.88× |
| `cppi(multiplier=3)` | 7.1% | 15.6% | 7.2% | 1.15 | 3.0% | 15.9% | 6.6% | -0.18 | 1.06× |
| `cppi(multiplier=5)` | 7.7% | 17.2% | 8.0% | 1.13 | 3.0% | 16.9% | 7.2% | -0.17 | 1.11× |
| `min_variance(windowDays=252)` | 6.8% | 15.7% | 7.0% | 1.12 | 4.3% | 17.2% | 7.1% | 0.07 | 1.27× |
| `vol_target(windowDays=63)` | 6.9% | 17.2% | 7.8% | 1.03 | 4.8% | 17.5% | 8.1% | 0.16 | 0.70× |
| `dual_momentum(lookbackDays=126)` | 5.6% | 17.6% | 8.6% | 0.72 | 3.1% | 15.0% | 8.3% | -0.13 | 4.49× |
| `dual_momentum(lookbackDays=252)` | 4.1% | 17.3% | 8.6% | 0.50 | 4.2% | 16.6% | 8.5% | 0.06 | 3.36× |

### Medium: worst drop up to 22.0%, volatility up to 11.0%

**Chosen: `trend(months=6)`.** Chosen on 2016 to 2021 (Sortino 1.63, worst drop 7.1%), it then beat the level's mix on the later years: Sortino 0.48 against 0.37, worst drop 6.7% against 20.9%, from every start year tried.

Picks by start year: 2016: `trend(months=6)` (beat the mix later); 2017: `trend(months=6)` (beat the mix later); 2018: `trend(months=6)` (beat the mix later).

| Candidate | Train: yearly | Train: worst drop | Train: volatility | Train: Sortino | Later: yearly | Later: worst drop | Later: volatility | Later: Sortino | Turnover a year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `trend(months=6)` | 9.3% | 7.1% | 7.1% | 1.63 | 6.2% | 6.7% | 6.7% | 0.48 | 3.91× |
| `inverse_vol(windowDays=63,scope=all)` | 4.2% | 7.3% | 3.4% | 1.43 | 2.9% | 13.0% | 5.3% | -0.26 | 0.95× |
| `inverse_vol(windowDays=126,scope=all)` | 4.5% | 8.0% | 3.7% | 1.40 | 3.0% | 12.7% | 5.3% | -0.23 | 0.69× |
| `trend(months=10)` | 8.1% | 8.5% | 7.3% | 1.37 | 4.0% | 14.9% | 7.3% | 0.02 | 3.99× |
| `static(rebalance=quarterly)` | 10.5% | 21.2% | 10.6% | 1.24 | 6.6% | 21.0% | 10.6% | 0.36 | 0.32× |
| `static(rebalance=band)` | 10.6% | 22.1% | 10.9% | 1.22 | 6.6% | 20.9% | 10.6% | 0.37 | 0.25× |
| `static(rebalance=annual)` | 10.3% | 21.2% | 10.5% | 1.21 | 6.6% | 20.9% | 10.6% | 0.37 | 0.27× |
| `static(rebalance=monthly)` | 10.3% | 21.9% | 10.7% | 1.20 | 6.5% | 21.0% | 10.6% | 0.35 | 0.40× |
| `cppi(multiplier=5)` | 9.7% | 21.9% | 10.4% | 1.13 | 4.9% | 20.7% | 9.8% | 0.15 | 1.22× |
| `inverse_vol(windowDays=126,scope=sleeves)` | 9.3% | 22.3% | 10.3% | 1.11 | 5.2% | 19.5% | 9.9% | 0.19 | 0.63× |
| `vol_target(windowDays=21)` | 8.6% | 19.0% | 9.3% | 1.10 | 6.1% | 19.6% | 9.8% | 0.31 | 1.15× |
| `min_variance(windowDays=252)` | 8.6% | 21.3% | 9.4% | 1.09 | 4.8% | 21.1% | 9.3% | 0.13 | 1.49× |
| `cppi(multiplier=3)` | 8.7% | 20.5% | 9.7% | 1.08 | 4.6% | 19.0% | 9.0% | 0.12 | 0.97× |
| `inverse_vol(windowDays=63,scope=sleeves)` | 9.1% | 22.4% | 10.3% | 1.08 | 5.2% | 19.6% | 9.9% | 0.19 | 0.84× |
| `min_variance(windowDays=126)` | 8.5% | 21.6% | 9.4% | 1.07 | 4.6% | 22.1% | 9.3% | 0.11 | 2.27× |
| `vol_target(windowDays=63)` | 8.1% | 21.9% | 10.0% | 0.96 | 6.4% | 18.9% | 9.9% | 0.36 | 0.80× |
| `dual_momentum(lookbackDays=126)` | 6.2% | 21.6% | 11.1% | 0.64 | 4.1% | 14.9% | 10.0% | 0.03 | 5.87× |
| `dual_momentum(lookbackDays=252)` | 4.2% | 25.2% | 11.2% | 0.40 | 5.6% | 17.7% | 10.1% | 0.24 | 4.36× |

### High: worst drop up to 30.0%, volatility up to 14.0%

**Chosen: `trend(months=6)`.** Chosen on 2016 to 2021 (Sortino 1.53, worst drop 8.4%), it then beat the level's mix on the later years: Sortino 0.56 against 0.49, worst drop 8.4% against 22.6%, from every start year tried.

Picks by start year: 2016: `trend(months=6)` (beat the mix later); 2017: `trend(months=6)` (beat the mix later); 2018: `trend(months=6)` (beat the mix later).

| Candidate | Train: yearly | Train: worst drop | Train: volatility | Train: Sortino | Later: yearly | Later: worst drop | Later: volatility | Later: Sortino | Turnover a year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `trend(months=6)` | 10.7% | 8.4% | 8.9% | 1.53 | 7.2% | 8.4% | 8.2% | 0.56 | 3.84× |
| `inverse_vol(windowDays=63,scope=all)` | 4.2% | 7.3% | 3.4% | 1.43 | 2.9% | 13.0% | 5.3% | -0.26 | 0.95× |
| `inverse_vol(windowDays=126,scope=all)` | 4.5% | 8.0% | 3.7% | 1.40 | 3.0% | 12.7% | 5.3% | -0.23 | 0.69× |
| `trend(months=10)` | 9.4% | 11.5% | 9.0% | 1.30 | 4.5% | 17.6% | 8.8% | 0.10 | 4.21× |
| `static(rebalance=band)` | 12.4% | 26.6% | 13.4% | 1.17 | 8.2% | 22.6% | 12.7% | 0.49 | 0.23× |
| `static(rebalance=quarterly)` | 12.1% | 26.2% | 13.2% | 1.16 | 8.2% | 22.7% | 12.7% | 0.48 | 0.31× |
| `static(rebalance=annual)` | 11.9% | 26.2% | 13.1% | 1.15 | 8.2% | 22.6% | 12.7% | 0.49 | 0.27× |
| `static(rebalance=monthly)` | 12.0% | 26.6% | 13.2% | 1.14 | 8.2% | 22.7% | 12.7% | 0.48 | 0.38× |
| `cppi(multiplier=5)` | 11.6% | 26.6% | 13.0% | 1.11 | 7.9% | 22.6% | 12.6% | 0.45 | 0.49× |
| `min_variance(windowDays=252)` | 10.4% | 26.7% | 12.0% | 1.06 | 5.1% | 25.1% | 11.5% | 0.15 | 1.72× |
| `vol_target(windowDays=21)` | 9.8% | 23.5% | 11.6% | 1.03 | 7.6% | 21.1% | 11.8% | 0.45 | 1.32× |
| `cppi(multiplier=3)` | 10.4% | 26.6% | 12.7% | 1.01 | 7.1% | 21.4% | 11.6% | 0.40 | 0.90× |
| `inverse_vol(windowDays=126,scope=sleeves)` | 10.6% | 28.0% | 13.1% | 1.00 | 6.0% | 21.9% | 12.0% | 0.26 | 0.62× |
| `min_variance(windowDays=126)` | 9.9% | 26.8% | 12.0% | 0.99 | 5.1% | 25.9% | 11.5% | 0.15 | 2.72× |
| `inverse_vol(windowDays=63,scope=sleeves)` | 10.4% | 28.2% | 13.2% | 0.98 | 6.0% | 22.0% | 12.0% | 0.26 | 0.85× |
| `vol_target(windowDays=63)` | 9.2% | 26.6% | 12.4% | 0.90 | 8.0% | 20.2% | 11.8% | 0.50 | 0.88× |
| `dual_momentum(lookbackDays=126)` | 6.5% | 25.7% | 13.0% | 0.58 | 4.2% | 16.6% | 11.2% | 0.04 | 6.58× |
| `dual_momentum(lookbackDays=252)` | 5.4% | 27.9% | 12.1% | 0.51 | 6.6% | 19.0% | 11.5% | 0.33 | 4.72× |

### Very high: worst drop up to 40.0%, volatility up to 18.0%

**Chosen: `static(rebalance=band)`.** The training pick (trend(months=6)) didn't beat the level's mix on the later years from every start year by 10.0% of its Sortino inside the budget, so the mix stays: Sortino 0.57, worst drop 24.7% on the later years.

Picks by start year: 2016: `trend(months=6)` (didn't beat the mix later); 2017: `trend(months=6)` (didn't beat the mix later); 2018: `trend(months=6)` (didn't beat the mix later).

| Candidate | Train: yearly | Train: worst drop | Train: volatility | Train: Sortino | Later: yearly | Later: worst drop | Later: volatility | Later: Sortino | Turnover a year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `trend(months=6)` | 12.2% | 10.3% | 10.7% | 1.46 | 8.1% | 10.2% | 9.7% | 0.60 | 3.95× |
| `inverse_vol(windowDays=63,scope=all)` | 4.3% | 7.5% | 3.5% | 1.43 | 2.9% | 13.4% | 5.4% | -0.26 | 0.96× |
| `inverse_vol(windowDays=126,scope=all)` | 4.6% | 8.3% | 3.8% | 1.40 | 3.0% | 13.1% | 5.5% | -0.24 | 0.70× |
| `trend(months=10)` | 10.8% | 15.1% | 10.9% | 1.25 | 5.0% | 20.4% | 10.3% | 0.15 | 4.52× |
| `static(rebalance=quarterly)` | 13.7% | 31.2% | 15.9% | 1.10 | 9.7% | 24.7% | 15.0% | 0.55 | 0.30× |
| `static(rebalance=band)` | 13.7% | 31.3% | 15.9% | 1.10 | 9.8% | 24.7% | 14.9% | 0.57 | 0.25× |
| `static(rebalance=annual)` | 13.6% | 31.2% | 15.8% | 1.10 | 9.7% | 24.7% | 14.9% | 0.56 | 0.26× |
| `static(rebalance=monthly)` | 13.6% | 31.4% | 15.9% | 1.10 | 9.6% | 24.7% | 15.0% | 0.55 | 0.34× |
| `cppi(multiplier=5)` | 13.6% | 31.4% | 15.9% | 1.10 | 9.6% | 24.7% | 15.0% | 0.55 | 0.34× |
| `cppi(multiplier=3)` | 12.9% | 31.4% | 15.6% | 1.04 | 9.0% | 24.6% | 14.6% | 0.50 | 0.71× |
| `vol_target(windowDays=21)` | 11.1% | 29.0% | 14.4% | 0.95 | 9.1% | 23.1% | 14.1% | 0.53 | 1.34× |
| `min_variance(windowDays=252)` | 11.5% | 32.7% | 15.0% | 0.94 | 5.6% | 28.6% | 13.7% | 0.18 | 1.82× |
| `min_variance(windowDays=126)` | 11.4% | 32.6% | 15.1% | 0.92 | 5.9% | 28.4% | 13.6% | 0.20 | 2.88× |
| `inverse_vol(windowDays=126,scope=sleeves)` | 11.8% | 33.6% | 16.1% | 0.92 | 6.8% | 24.6% | 14.2% | 0.29 | 0.61× |
| `inverse_vol(windowDays=63,scope=sleeves)` | 11.7% | 33.8% | 16.1% | 0.91 | 6.8% | 24.7% | 14.2% | 0.29 | 0.86× |
| `vol_target(windowDays=63)` | 10.6% | 31.4% | 15.0% | 0.87 | 9.4% | 22.9% | 14.2% | 0.56 | 0.89× |
| `dual_momentum(lookbackDays=252)` | 6.7% | 30.5% | 13.3% | 0.60 | 7.3% | 20.8% | 13.2% | 0.37 | 5.06× |
| `dual_momentum(lookbackDays=126)` | 6.9% | 30.5% | 15.3% | 0.52 | 4.2% | 19.3% | 12.6% | 0.03 | 7.28× |

