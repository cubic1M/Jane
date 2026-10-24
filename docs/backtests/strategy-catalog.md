# Strategy catalog

Every well-documented, rules-based strategy we found, written as the rules the replay runs. Generic versions of public concepts with liquid ETF proxies; nothing from paid material. The results are in [strategy-results.md](strategy-results.md). Generated from `src/config/strategy-catalog.ts`.

Also tested, separately and at Very high only: the five day-trading rules on 5-minute bars (`src/config/intraday-strategies.ts`, `src/config/intraday-evidence.ts`) and the three crypto rules (`src/config/crypto-strategies.ts`, `src/config/crypto-evidence.ts`).

## Fixed mixes

### 60/40 (`sixty_forty`)

- **Source:** [The classic balanced fund](https://en.wikipedia.org/wiki/Modern_portfolio_theory)
- **Rules:** 60% US stocks (VTI), 40% US bonds (BND), rebalanced monthly.
- **Setting:** none
- **Funds:** VTI, BND
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Permanent portfolio (`permanent_portfolio`)

- **Source:** [Harry Browne, Fail-Safe Investing (1999); Portfolio Charts](https://portfoliocharts.com/portfolio/permanent-portfolio/)
- **Rules:** 25% each in US stocks (SPY), long Treasuries (TLT), gold (GLD) and bills (BIL), rebalanced monthly.
- **Setting:** none
- **Funds:** SPY, TLT, GLD, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Golden butterfly (`golden_butterfly`)

- **Source:** [Portfolio Charts, the Golden Butterfly](https://portfoliocharts.com/portfolio/golden-butterfly/)
- **Rules:** 20% each in the US market (VTI), US small value (IJS), long Treasuries (TLT), short Treasuries (SHY) and gold (GLD), rebalanced monthly.
- **Setting:** none
- **Funds:** VTI, IJS, TLT, SHY, GLD
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### No-Brainer portfolio (`no_brainer`)

- **Source:** [Bernstein, The Intelligent Asset Allocator (2000); Portfolio Charts](https://portfoliocharts.com/portfolios/no-brainer-portfolio/)
- **Rules:** 25% each in US large companies (SPY), US small companies (IJR), developed foreign stocks (EFA) and short Treasuries (SHY), rebalanced monthly.
- **Setting:** none
- **Funds:** SPY, IJR, EFA, SHY
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Coffeehouse portfolio (`coffeehouse`)

- **Source:** [Schultheis, The Coffeehouse Investor (1998); Portfolio Charts](https://portfoliocharts.com/portfolios/coffeehouse-portfolio/)
- **Rules:** 10% each in US large (SPY), large value (IVE), small (IJR) and small value (IJS) companies, foreign stocks (EFA) and REITs (VNQ); 40% US bonds (BND). Rebalanced monthly.
- **Setting:** none
- **Funds:** SPY, IVE, IJR, IJS, EFA, VNQ, BND
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Larry portfolio (`larry`)

- **Source:** [Swedroe & Grogan, Reducing the Risk of Black Swans (2014): a small, high-tilt stock share and the rest in Treasuries](https://www.moneycrashers.com/larry-swedroe-portfolio/)
- **Rules:** 15% US small value (IJS), 7.5% foreign small companies paying dividends (DLS), 7.5% emerging small companies paying dividends (DGS), 70% intermediate Treasuries (IEF). Rebalanced monthly.
- **Setting:** none
- **Funds:** IJS, DLS, DGS, IEF
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### All-weather (fixed) (`all_weather_fixed`)

- **Source:** [The widely published retail split of Dalio's All Weather idea (30/40/15/7.5/7.5); not Bridgewater's own fund](https://de.tradingview.com/script/GSYS7QZ2-Ray-Dalio-s-All-Weather-Strategy-Portfolio-Calculator)
- **Rules:** 30% US stocks (VTI), 40% long Treasuries (TLT), 15% intermediate Treasuries (IEF), 7.5% gold (GLD), 7.5% commodities (DBC), rebalanced monthly.
- **Setting:** none
- **Funds:** VTI, TLT, IEF, GLD, DBC
- **At each level:** a whole portfolio, blended with bills to the level's volatility

## Tactical asset allocation

### Faber GTAA / Ivy 5 (`faber_gtaa5`)

- **Source:** [Faber, A Quantitative Approach to Tactical Asset Allocation (J. Wealth Management, 2007); The Ivy Portfolio](https://papers.ssrn.com/abstract=962461)
- **Rules:** A fifth each in US stocks (VTI), foreign stocks (VEU), real estate (VNQ), intermediate Treasuries (IEF) and commodities (DBC); at each month-end, a fund below its N-month moving average is held as bills (BIL) instead.
- **Setting:** months in the moving average: 8, 10, 12
- **Funds:** VTI, VEU, VNQ, IEF, DBC, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Faber GTAA aggressive (`faber_gtaa_top`)

- **Source:** [Faber, Relative Strength Strategies for Investing (2010)](https://papers.ssrn.com/abstract=1585517)
- **Rules:** Of ten asset ETFs, the top K by the average of their 1, 3, 6 and 12-month returns, each also above its 10-month average, equal weight; empty slots in bills (BIL). Monthly.
- **Setting:** how many to hold: 3, 5
- **Funds:** SPY, EFA, EEM, VNQ, DBC, GLD, TLT, IEF, LQD, TIP, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Dual momentum (GEM) (`dual_momentum`)

- **Source:** [Antonacci, Risk Premia Harvesting Through Dual Momentum (2012); Dual Momentum Investing (2014)](https://alphaarchitect.com/2012/07/risk-premia-harvesting-through-momentum/)
- **Rules:** Each month: if US stocks (SPY) beat bills (BIL) over the last N months, hold whichever of US stocks or foreign stocks (VEU) did better; otherwise hold US bonds (AGG).
- **Setting:** months of look-back: 6, 9, 12
- **Funds:** SPY, VEU, AGG, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Vigilant asset allocation (VAA-G4) (`vaa_g4`)

- **Source:** [Keller & Keuning, Breadth Momentum and Vigilant Asset Allocation (2017)](https://papers.ssrn.com/abstract=3002624)
- **Rules:** 13612W momentum (12x the 1-month return + 4x the 3-month + 2x the 6-month + the 12-month, over 4). Each month, if all of SPY, EFA, EEM and AGG are positive, hold the best of them; otherwise the best of SHY, IEF and LQD.
- **Setting:** assets held: 1
- **Funds:** SPY, EFA, EEM, AGG, SHY, IEF, LQD
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Defensive asset allocation (DAA) (`daa`)

- **Source:** [Keller & Keuning, Breadth Momentum and the Canary Universe: Defensive Asset Allocation (2018)](https://papers.ssrn.com/abstract=3212862)
- **Rules:** 13612W momentum. A canary of emerging stocks (EEM) and US bonds (BND): none negative, the top K of SPY, IWM, QQQ, EFA, EEM, VNQ, DBC, GLD, TLT, HYG, LQD and IEF, equal weight; one negative, half that and half the best of SHY, IEF and LQD; both, all in that one. Monthly.
- **Setting:** how many to hold: 3, 6
- **Funds:** SPY, IWM, QQQ, EFA, EEM, VNQ, DBC, GLD, TLT, HYG, LQD, IEF, SHY, BND
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Bold asset allocation (BAA) (`baa`)

- **Source:** [Keller, Relative and Absolute Momentum in Times of Rising/Low Yields: Bold Asset Allocation (2022)](https://papers.ssrn.com/abstract=4166845)
- **Rules:** Canary SPY, EEM, EFA and BND on 13612W: none negative, the top K of the same twelve as DAA by their price against their 12-month average, equal weight; any negative, the top 3 of TIP, DBC, BIL, IEF, TLT, LQD and BND by the same measure, each below bills replaced by bills. Monthly.
- **Setting:** how many to hold (offensive): 1, 6
- **Funds:** SPY, IWM, QQQ, EFA, EEM, VNQ, DBC, GLD, TLT, HYG, LQD, IEF, TIP, BIL, BND
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Hybrid asset allocation (HAA) (`haa`)

- **Source:** [Keller & Keuning, Dual and Canary Momentum with Rising Yields/Inflation: Hybrid Asset Allocation (2023)](https://papers.ssrn.com/abstract=4346906)
- **Rules:** Momentum is the average of the 1, 3, 6 and 12-month returns. With inflation-linked bonds (TIP) positive: the top K of SPY, IWM, EFA, EEM, VNQ, DBC, IEF and TLT, each with negative momentum replaced by the better of bills (BIL) and IEF; TIP negative, all in that better one. Monthly.
- **Setting:** how many to hold: 4
- **Funds:** SPY, IWM, EFA, EEM, VNQ, DBC, IEF, TLT, TIP, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Protective asset allocation (PAA) (`paa`)

- **Source:** [Keller & Keuning, Protective Asset Allocation (PAA): A Simple Momentum-Based Alternative for Term Deposits (2016)](https://www.cxoadvisory.com/technical-trading/dual-momentum-with-multi-market-breadth-crash-protection)
- **Rules:** Momentum is the price against its 12-month average, less one, over SPY, QQQ, IWM, VGK, EWJ, EEM, IYR, GSG, GLD, HYG, LQD and TLT. With n of the 12 positive and protection A, the bond share is (12 − n) / (12 − 3A), between 0 and 1, held in IEF; the rest in the top 6 positive ones, equal weight. Monthly.
- **Setting:** protection (A): 1, 2
- **Funds:** SPY, QQQ, IWM, VGK, EWJ, EEM, IYR, GSG, GLD, HYG, LQD, TLT, IEF
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Accelerating dual momentum (`accelerating_dual_momentum`)

- **Source:** [Engineered Portfolio's Accelerating Dual Momentum (2018), as published in an open TradingView script](https://www.tradingview.com/script/LyF7R2tF/)
- **Rules:** Each month, the better of US stocks (SPY) and foreign small companies (SCZ) by the average of their 1, 3 and 6-month returns, if positive; otherwise the better of long Treasuries (TLT) and inflation-linked bonds (TIP) over the last month.
- **Setting:** none
- **Funds:** SPY, SCZ, TLT, TIP
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Composite dual momentum (`composite_dual_momentum`)

- **Source:** [Antonacci, Risk Premia Harvesting Through Dual Momentum (2012): its four modules](https://alphaarchitect.com/2012/07/risk-premia-harvesting-through-momentum/)
- **Rules:** A quarter each in four pairs: US/foreign stocks (SPY/EFA), high-yield/credit bonds (HYG/LQD), equity/mortgage REITs (VNQ/REM) and gold/Treasuries (GLD/TLT). Each month each quarter holds the pair's better fund over the last 12 months if it beat bills (BIL), else bills.
- **Setting:** months of look-back: 12
- **Funds:** SPY, EFA, HYG, LQD, VNQ, REM, GLD, TLT, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Elastic asset allocation (EAA) (`eaa`)

- **Source:** [Keller & Butler, A Century of Generalized Momentum: From Flexible (FAA) to Elastic Asset Allocation (EAA) (2014)](https://www.cxoadvisory.com/momentum-investing/long-run-test-of-a-tactical-tractable-mpt)
- **Rules:** For SPY, QQQ, IWM, VGK, EWJ, EEM, VNQ, DBC, GLD, TLT and IEF: R is the average of the 1, 3, 6 and 12-month returns over bills, C the 12-month correlation with their equal-weight average. Each month, of those with R above 0, the top 1 + √11 by z = (R · √(1 − C))^S, weighted by z; the share of funds with R at or below 0 goes to short Treasuries (SHY).
- **Setting:** selection aggressiveness (S): 2
- **Funds:** SPY, QQQ, IWM, VGK, EWJ, EEM, VNQ, DBC, GLD, TLT, IEF, SHY, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

## Risk-based allocation

### Kipnis defensive adaptive (KDA) (`kda`)

- **Source:** [Kipnis, Right Now It's KDA... Asset Allocation (QuantStrat TradeR, 2019): DAA's canary with AAA's minimum variance](https://www.r-bloggers.com/2019/01/right-now-its-kdaasset-allocation/)
- **Rules:** 13612W momentum. The canary VWO and BND sets the risky share: both positive 100%, one 50%, none 0%. The risky share goes to the top 5 of SPY, VGK, EWJ, EEM, VNQ, DBC, GLD, IEF and TLT by momentum, weighted to the least variance (21-day volatility, 252-day correlation); the rest to IEF if its momentum is positive, else bills (BIL). Monthly.
- **Setting:** how many to hold: 5
- **Funds:** SPY, VGK, EWJ, EEM, VNQ, DBC, GLD, IEF, TLT, VWO, BND, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Adaptive asset allocation (`adaptive_aa`)

- **Source:** [Butler, Philbrick, Gordillo & Varadi, Adaptive Asset Allocation: A Primer (2012)](https://www.r-bloggers.com/2023/12/adaptive-asset-allocation-replication/)
- **Rules:** Of the ten asset ETFs, the top K by 6-month return, weighted to the least variance from their last 60 days' volatility and 250 days' correlations (long only). Monthly.
- **Setting:** how many to hold: 3, 5
- **Funds:** SPY, EFA, EEM, VNQ, DBC, GLD, TLT, IEF, LQD, TIP
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Risk parity (inverse volatility) (`risk_parity`)

- **Source:** [Asness, Frazzini & Pedersen, Leverage Aversion and Risk Parity (Financial Analysts Journal, 2012)](https://www.aqr.com/Insights/Research/Journal-Article/Leverage-Aversion-and-Risk-Parity)
- **Rules:** VTI, TLT, IEF, GLD and DBC, each weighted by the inverse of its volatility over the last N trading days, no leverage. Monthly.
- **Setting:** trading days of volatility: 63, 126
- **Funds:** VTI, TLT, IEF, GLD, DBC
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Minimum variance (`min_variance`)

- **Source:** [Clarke, de Silva & Thorley, Minimum-Variance Portfolio Composition (J. Portfolio Management, 2011)](https://doi.org/10.3905/jpm.2011.37.2.031)
- **Rules:** The ten asset ETFs weighted to the least variance over the last N trading days, long only, at most 40% in one. Monthly.
- **Setting:** trading days of history: 126, 252
- **Funds:** SPY, EFA, EEM, VNQ, DBC, GLD, TLT, IEF, LQD, TIP
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Maximum diversification (`max_diversification`)

- **Source:** [Choueifaty & Coignard, Toward Maximum Diversification (J. Portfolio Management, 2008); Properties of the Most Diversified Portfolio (2013)](https://ideas.repec.org/a/rsk/journ6/2255764.html)
- **Rules:** The ten asset ETFs weighted to the highest diversification ratio (average volatility over portfolio volatility) over the last N trading days, long only, at most 40% in one. Monthly.
- **Setting:** trading days of history: 126, 252
- **Funds:** SPY, EFA, EEM, VNQ, DBC, GLD, TLT, IEF, LQD, TIP
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Hierarchical risk parity (`hrp`)

- **Source:** [López de Prado, Building Diversified Portfolios that Outperform Out-of-Sample (J. Portfolio Management, 2016)](https://papers.ssrn.com/abstract=2708678)
- **Rules:** The ten asset ETFs clustered by correlation over the last N trading days (single linkage), then weighted by recursive bisection on inverse variance. Monthly.
- **Setting:** trading days of history: 126, 252
- **Funds:** SPY, EFA, EEM, VNQ, DBC, GLD, TLT, IEF, LQD, TIP
- **At each level:** a whole portfolio, blended with bills to the level's volatility

## Factor tilts

### Value (`value`)

- **Source:** [Fama & French, The Cross-Section of Expected Stock Returns (1992)](https://doi.org/10.1111/j.1540-6261.1992.tb04398.x)
- **Rules:** The level's US-stocks share held in a large-cap value fund (VTV).
- **Setting:** none
- **Funds:** VTV
- **At each level:** replaces the level mix's US-stocks share

### Momentum (`momentum`)

- **Source:** [Jegadeesh & Titman, Returns to Buying Winners and Selling Losers (1993)](https://doi.org/10.1111/j.1540-6261.1993.tb04702.x)
- **Rules:** The level's US-stocks share held in a momentum fund (MTUM).
- **Setting:** none
- **Funds:** MTUM
- **At each level:** replaces the level mix's US-stocks share

### Quality (`quality`)

- **Source:** [Asness, Frazzini & Pedersen, Quality Minus Junk (Review of Accounting Studies, 2019)](https://papers.ssrn.com/abstract=2312432)
- **Rules:** The level's US-stocks share held in a quality fund (QUAL).
- **Setting:** none
- **Funds:** QUAL
- **At each level:** replaces the level mix's US-stocks share

### Low volatility (`low_volatility`)

- **Source:** [Baker, Bradley & Wurgler, Benchmarks as Limits to Arbitrage: Understanding the Low-Volatility Anomaly (FAJ, 2011)](https://papers.ssrn.com/abstract=1745108)
- **Rules:** The level's US-stocks share held in a minimum-volatility fund (USMV).
- **Setting:** none
- **Funds:** USMV
- **At each level:** replaces the level mix's US-stocks share

### Small companies (`size`)

- **Source:** [Banz, The Relationship Between Return and Market Value of Common Stocks (1981)](https://doi.org/10.1016/0304-405X(81)90018-0)
- **Rules:** The level's US-stocks share held in a small-cap fund (IJR).
- **Setting:** none
- **Funds:** IJR
- **At each level:** replaces the level mix's US-stocks share

### Small value (`small_value`)

- **Source:** [Fama & French, Common Risk Factors in the Returns on Stocks and Bonds (1993)](https://doi.org/10.1016/0304-405X(93)90023-5)
- **Rules:** The level's US-stocks share held in a small-cap value fund (IJS).
- **Setting:** none
- **Funds:** IJS
- **At each level:** replaces the level mix's US-stocks share

### Multi-factor (`multi_factor`)

- **Source:** [Asness, Moskowitz & Pedersen, Value and Momentum Everywhere (J. Finance, 2013)](https://www.aqr.com/Insights/Research/Journal-Article/Value-and-Momentum-Everywhere)
- **Rules:** The level's US-stocks share split equally among value (VTV), momentum (MTUM), quality (QUAL), low volatility (USMV) and small companies (IJR), rebalanced monthly.
- **Setting:** none
- **Funds:** VTV, MTUM, QUAL, USMV, IJR
- **At each level:** replaces the level mix's US-stocks share

### Equal weight S&P 500 (`equal_weight`)

- **Source:** [Plyakha, Uppal & Vilkov, Why Does an Equal-Weighted Portfolio Outperform? (2012)](https://climateinstitute.edhec.edu/publications/why-does-equal-weighted-portfolio-outperform-value-and-price-weighted-portfolios)
- **Rules:** The level's US-stocks share held in an equal-weight S&P 500 fund (RSP).
- **Setting:** none
- **Funds:** RSP
- **At each level:** replaces the level mix's US-stocks share

### Dividend growth (`dividend_growth`)

- **Source:** [Vanguard Dividend Appreciation (VIG): companies that have raised their dividends for 10+ years; the fund's own index](https://investor.vanguard.com/investment-products/etfs/profile/vig)
- **Rules:** The level's US-stocks share held in a dividend-growth fund (VIG).
- **Setting:** none
- **Funds:** VIG
- **At each level:** replaces the level mix's US-stocks share

### Shareholder yield (`shareholder_yield`)

- **Source:** [Faber, Shareholder Yield (2013); Cambria's SYLD screens on dividends, buybacks and debt paydown](https://www.etftrends.com/2013/05/new-shareholder-yield-etf-co-managed-by-mebane-faber/)
- **Rules:** The level's US-stocks share held in a shareholder-yield fund (SYLD): dividends, buybacks and debt paid down.
- **Setting:** none
- **Funds:** SYLD
- **At each level:** replaces the level mix's US-stocks share

## Trend following

### Trend filter on US stocks (`trend_200`)

- **Source:** [Faber (2007); Siegel, Stocks for the Long Run (the 200-day average)](https://papers.ssrn.com/abstract=962461)
- **Rules:** At each month-end, the level's US-stocks share in SPY while it closes above its N-day average, else in bills (BIL).
- **Setting:** days in the average: 100, 150, 200
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Time-series momentum (`time_series_momentum`)

- **Source:** [Moskowitz, Ooi & Pedersen, Time Series Momentum (J. Financial Economics, 2012)](https://doi.org/10.1016/j.jfineco.2011.11.003)
- **Rules:** At each month-end, the level's US-stocks share in SPY when its last N months beat bills (BIL), else in bills.
- **Setting:** months of look-back: 6, 9, 12
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Managed futures (ETF) (`managed_futures`)

- **Source:** [Hurst, Ooi & Pedersen, A Century of Evidence on Trend-Following Investing (2017); DBMF as the ETF proxy](https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing)
- **Rules:** 10% of the portfolio moved from its bonds into a managed-futures ETF (DBMF), rebalanced monthly. DBMF began in 2019, so there are no earlier years to choose on.
- **Setting:** none
- **Funds:** DBMF
- **At each level:** a 10% sleeve taken from the mix's bonds

## Rotation

### Bond rotation (`bond_rotation`)

- **Source:** [Antonacci, Dual Momentum Fixed Income (2014), widened to the main bond funds](https://seekingalpha.com/article/2779905-dual-momentum-fixed-income)
- **Rules:** Each month, the one of long, intermediate and short Treasuries (TLT, IEF, SHY), investment-grade and high-yield credit (LQD, HYG) and inflation-linked bonds (TIP) with the best last N months, if it beat bills (BIL); otherwise bills.
- **Setting:** months of look-back: 3, 6
- **Funds:** TLT, IEF, SHY, LQD, HYG, TIP, BIL
- **At each level:** a whole portfolio, blended with bills to the level's volatility

### Sector rotation (`sector_rotation`)

- **Source:** [Moskowitz & Grinblatt, Do Industries Explain Momentum? (1999)](https://doi.org/10.1111/0022-1082.00146)
- **Rules:** Each month, the level's US-stocks share split equally among the 3 of 9 sector funds with the best return over the last N months.
- **Setting:** months of look-back: 3, 6, 12
- **Funds:** XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY
- **At each level:** replaces the level mix's US-stocks share

### Sector rotation with a trend filter (`sector_trend`)

- **Source:** [Faber, Relative Strength Strategies for Investing (2010): top sectors, each above its 10-month average](https://papers.ssrn.com/abstract=1585517)
- **Rules:** Each month, a third each in the 3 of 9 sector funds with the best average 1, 3, 6 and 12-month return; any of them below its 10-month average is held as bills (BIL) instead.
- **Setting:** how many sectors: 3
- **Funds:** XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, BIL
- **At each level:** replaces the level mix's US-stocks share

## Volatility and drawdown control

### Trend filter with volatility targeting (`trend_vol`)

- **Source:** [Faber (2007) and Moreira & Muir (2017), together](https://www.nber.org/papers/w22208)
- **Rules:** Each week, the US-stocks share in bills (BIL) while SPY is below its 200-day average; above it, SPY scaled to a target volatility (its last 20 days', never above 100%), the rest in bills.
- **Setting:** target volatility, a year: 0.12, 0.18
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Volatility targeting (`vol_target`)

- **Source:** [Moreira & Muir, Volatility-Managed Portfolios (J. Finance, 2017)](https://www.nber.org/papers/w22208)
- **Rules:** Each week, the level's US-stocks share is SPY scaled to a target volatility (its last 20 days' volatility, never above 100%), the rest in bills (BIL).
- **Setting:** target volatility, a year: 0.1, 0.15
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Portfolio insurance (CPPI) (`cppi`)

- **Source:** [Perold (1986); Black & Jones, Simplifying Portfolio Insurance (1987)](https://en.wikipedia.org/wiki/Constant_proportion_portfolio_insurance)
- **Rules:** Within the US-stocks share: a floor of 80% of its value at each year's start; SPY is M times the cushion above the floor (at most all), the rest in bills (BIL). Weekly.
- **Setting:** multiplier: 3, 5
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Portfolio insurance (TIPP) (`tipp`)

- **Source:** [Estep & Kritzman, TIPP: Insurance without Complexity (J. Portfolio Management, 1988)](https://quantpedia.com/time-invariant-portfolio-protection/)
- **Rules:** As CPPI, but the floor is 80% of the highest value so far (it only ratchets up). Weekly.
- **Setting:** multiplier: 3, 5
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

## Seasonality

### Sell in May (`sell_in_may`)

- **Source:** [Bouman & Jacobsen, The Halloween Indicator (American Economic Review, 2002)](https://doi.org/10.1257/000282802762024683)
- **Rules:** The level's US-stocks share in SPY from November through April, in bills (BIL) from May through October.
- **Setting:** none
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Turn of the month (`turn_of_month`)

- **Source:** [Lakonishok & Smidt, Are Seasonal Anomalies Real? (Review of Financial Studies, 1988)](https://doi.org/10.1093/rfs/1.4.403)
- **Rules:** The level's US-stocks share in SPY from the last trading day of each month through the Nth trading day of the next, in bills (BIL) otherwise.
- **Setting:** trading days into the month: 3, 4
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

## Mean reversion

### RSI(2) pullbacks (`rsi2`)

- **Source:** [Connors & Alvarez, Short Term Trading Strategies That Work (2008)](https://www.luxalgo.com/library/concept/rsi-2/)
- **Rules:** While SPY is above its 200-day average, buy the US-stocks share into SPY at a close with a 2-day RSI below X; out to bills (BIL) at the first close above the 5-day average.
- **Setting:** RSI(2) below: 5, 10
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Internal bar strength (`ibs`)

- **Source:** [Pagonidis, The IBS Effect: Mean Reversion in Equity ETFs (2013); replication, arXiv 2306.12434](https://arxiv.org/abs/2306.12434)
- **Rules:** Hold the US-stocks share in SPY for the next day after a close in the bottom X of the day's range ((close − low) / (high − low)); bills (BIL) otherwise.
- **Setting:** IBS below: 0.15, 0.25
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share

### Bollinger band pullbacks (`bollinger`)

- **Source:** [Bollinger, Bollinger on Bollinger Bands (2001)](https://www.bollingerbands.com/)
- **Rules:** While SPY is above its 200-day average, buy the US-stocks share into SPY at a close below its 20-day average less K standard deviations; out to bills (BIL) at a close above the 20-day average.
- **Setting:** standard deviations: 1.5, 2
- **Funds:** SPY, BIL
- **At each level:** replaces the level mix's US-stocks share
