// The strategy catalog (Phase AW, Stage A; the founder's overnight research): every
// well-documented, rules-based strategy we could find, each with its public source, its rules,
// a small fixed parameter grid and liquid ETF proxies. Each is replayed on Alpaca's daily
// closes after costs (src/planning/catalog/), walk-forward, at every risk level, and only those
// that beat the level's own mix on the later years after a multiple-testing haircut are marked
// recommendable (docs/backtests/strategy-results.md). Generic versions of public concepts only;
// nothing from paid material. Practice money and demo advice only. FOR REVIEW: every number.

export type CatalogKind =
  // Replaces the level mix's US-stocks share (a tilt, a timing rule on US stocks).
  | "equity"
  // A whole portfolio, blended with bills so its volatility matches the level's mix on the
  // years before (never levered).
  | "portfolio"
  // A small sleeve beside the mix, taken from its bonds.
  | "sleeve";

export type CatalogFamily =
  | "static"
  | "tactical"
  | "risk"
  | "factor"
  | "trend"
  | "rotation"
  | "protection"
  | "seasonal"
  | "reversion";

export type CatalogEntry = {
  label: string;
  family: CatalogFamily;
  kind: CatalogKind;
  // The public source the rules come from.
  source: { title: string; url: string };
  // The rules in plain words, as replayed.
  rules: string;
  // The one setting, its name and its small grid.
  param: string;
  grid: readonly number[];
  // The ETFs it holds or reads.
  tickers: readonly string[];
};

const MIX = ["VTI", "VXUS", "BND", "BIL"] as const;
// The ten-asset universe the risk-based and adaptive strategies choose from.
export const TEN = ["SPY", "EFA", "EEM", "VNQ", "DBC", "GLD", "TLT", "IEF", "LQD", "TIP"] as const;
export const SECTORS = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"] as const;

export const CATALOG = {
  sixty_forty: {
    label: "60/40",
    family: "static",
    kind: "portfolio",
    source: {
      title: "The classic balanced fund",
      url: "https://en.wikipedia.org/wiki/Modern_portfolio_theory",
    },
    rules: "60% US stocks (VTI), 40% US bonds (BND), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["VTI", "BND"],
  },
  permanent_portfolio: {
    label: "Permanent portfolio",
    family: "static",
    kind: "portfolio",
    source: {
      title: "Harry Browne, Fail-Safe Investing (1999); Portfolio Charts",
      url: "https://portfoliocharts.com/portfolio/permanent-portfolio/",
    },
    rules:
      "25% each in US stocks (SPY), long Treasuries (TLT), gold (GLD) and bills (BIL), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["SPY", "TLT", "GLD", "BIL"],
  },
  golden_butterfly: {
    label: "Golden butterfly",
    family: "static",
    kind: "portfolio",
    source: {
      title: "Portfolio Charts, the Golden Butterfly",
      url: "https://portfoliocharts.com/portfolio/golden-butterfly/",
    },
    rules:
      "20% each in the US market (VTI), US small value (IJS), long Treasuries (TLT), short Treasuries (SHY) and gold (GLD), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["VTI", "IJS", "TLT", "SHY", "GLD"],
  },
  no_brainer: {
    label: "No-Brainer portfolio",
    family: "static",
    kind: "portfolio",
    source: {
      title: "Bernstein, The Intelligent Asset Allocator (2000); Portfolio Charts",
      url: "https://portfoliocharts.com/portfolios/no-brainer-portfolio/",
    },
    rules:
      "25% each in US large companies (SPY), US small companies (IJR), developed foreign stocks (EFA) and short Treasuries (SHY), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["SPY", "IJR", "EFA", "SHY"],
  },
  coffeehouse: {
    label: "Coffeehouse portfolio",
    family: "static",
    kind: "portfolio",
    source: {
      title: "Schultheis, The Coffeehouse Investor (1998); Portfolio Charts",
      url: "https://portfoliocharts.com/portfolios/coffeehouse-portfolio/",
    },
    rules:
      "10% each in US large (SPY), large value (IVE), small (IJR) and small value (IJS) companies, foreign stocks (EFA) and REITs (VNQ); 40% US bonds (BND). Rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["SPY", "IVE", "IJR", "IJS", "EFA", "VNQ", "BND"],
  },
  larry: {
    label: "Larry portfolio",
    family: "static",
    kind: "portfolio",
    source: {
      title:
        "Swedroe & Grogan, Reducing the Risk of Black Swans (2014): a small, high-tilt stock share and the rest in Treasuries",
      url: "https://www.moneycrashers.com/larry-swedroe-portfolio/",
    },
    rules:
      "15% US small value (IJS), 7.5% foreign small companies paying dividends (DLS), 7.5% emerging small companies paying dividends (DGS), 70% intermediate Treasuries (IEF). Rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["IJS", "DLS", "DGS", "IEF"],
  },
  all_weather_fixed: {
    label: "All-weather (fixed)",
    family: "static",
    kind: "portfolio",
    source: {
      title:
        "The widely published retail split of Dalio's All Weather idea (30/40/15/7.5/7.5); not Bridgewater's own fund",
      url: "https://de.tradingview.com/script/GSYS7QZ2-Ray-Dalio-s-All-Weather-Strategy-Portfolio-Calculator",
    },
    rules:
      "30% US stocks (VTI), 40% long Treasuries (TLT), 15% intermediate Treasuries (IEF), 7.5% gold (GLD), 7.5% commodities (DBC), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["VTI", "TLT", "IEF", "GLD", "DBC"],
  },
  faber_gtaa5: {
    label: "Faber GTAA / Ivy 5",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Faber, A Quantitative Approach to Tactical Asset Allocation (J. Wealth Management, 2007); The Ivy Portfolio",
      url: "https://papers.ssrn.com/abstract=962461",
    },
    rules:
      "A fifth each in US stocks (VTI), foreign stocks (VEU), real estate (VNQ), intermediate Treasuries (IEF) and commodities (DBC); at each month-end, a fund below its N-month moving average is held as bills (BIL) instead.",
    param: "months in the moving average",
    grid: [8, 10, 12],
    tickers: ["VTI", "VEU", "VNQ", "IEF", "DBC", "BIL"],
  },
  faber_gtaa_top: {
    label: "Faber GTAA aggressive",
    family: "tactical",
    kind: "portfolio",
    source: {
      title: "Faber, Relative Strength Strategies for Investing (2010)",
      url: "https://papers.ssrn.com/abstract=1585517",
    },
    rules:
      "Of ten asset ETFs, the top K by the average of their 1, 3, 6 and 12-month returns, each also above its 10-month average, equal weight; empty slots in bills (BIL). Monthly.",
    param: "how many to hold",
    grid: [3, 5],
    tickers: [...TEN, "BIL"],
  },
  dual_momentum: {
    label: "Dual momentum (GEM)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Antonacci, Risk Premia Harvesting Through Dual Momentum (2012); Dual Momentum Investing (2014)",
      url: "https://alphaarchitect.com/2012/07/risk-premia-harvesting-through-momentum/",
    },
    rules:
      "Each month: if US stocks (SPY) beat bills (BIL) over the last N months, hold whichever of US stocks or foreign stocks (VEU) did better; otherwise hold US bonds (AGG).",
    param: "months of look-back",
    grid: [6, 9, 12],
    tickers: ["SPY", "VEU", "AGG", "BIL"],
  },
  vaa_g4: {
    label: "Vigilant asset allocation (VAA-G4)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title: "Keller & Keuning, Breadth Momentum and Vigilant Asset Allocation (2017)",
      url: "https://papers.ssrn.com/abstract=3002624",
    },
    rules:
      "13612W momentum (12x the 1-month return + 4x the 3-month + 2x the 6-month + the 12-month, over 4). Each month, if all of SPY, EFA, EEM and AGG are positive, hold the best of them; otherwise the best of SHY, IEF and LQD.",
    param: "assets held",
    grid: [1],
    tickers: ["SPY", "EFA", "EEM", "AGG", "SHY", "IEF", "LQD"],
  },
  daa: {
    label: "Defensive asset allocation (DAA)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Keller & Keuning, Breadth Momentum and the Canary Universe: Defensive Asset Allocation (2018)",
      url: "https://papers.ssrn.com/abstract=3212862",
    },
    rules:
      "13612W momentum. A canary of emerging stocks (EEM) and US bonds (BND): none negative, the top K of SPY, IWM, QQQ, EFA, EEM, VNQ, DBC, GLD, TLT, HYG, LQD and IEF, equal weight; one negative, half that and half the best of SHY, IEF and LQD; both, all in that one. Monthly.",
    param: "how many to hold",
    grid: [3, 6],
    tickers: [
      "SPY",
      "IWM",
      "QQQ",
      "EFA",
      "EEM",
      "VNQ",
      "DBC",
      "GLD",
      "TLT",
      "HYG",
      "LQD",
      "IEF",
      "SHY",
      "BND",
    ],
  },
  baa: {
    label: "Bold asset allocation (BAA)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Keller, Relative and Absolute Momentum in Times of Rising/Low Yields: Bold Asset Allocation (2022)",
      url: "https://papers.ssrn.com/abstract=4166845",
    },
    rules:
      "Canary SPY, EEM, EFA and BND on 13612W: none negative, the top K of the same twelve as DAA by their price against their 12-month average, equal weight; any negative, the top 3 of TIP, DBC, BIL, IEF, TLT, LQD and BND by the same measure, each below bills replaced by bills. Monthly.",
    param: "how many to hold (offensive)",
    grid: [1, 6],
    tickers: [
      "SPY",
      "IWM",
      "QQQ",
      "EFA",
      "EEM",
      "VNQ",
      "DBC",
      "GLD",
      "TLT",
      "HYG",
      "LQD",
      "IEF",
      "TIP",
      "BIL",
      "BND",
    ],
  },
  haa: {
    label: "Hybrid asset allocation (HAA)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Keller & Keuning, Dual and Canary Momentum with Rising Yields/Inflation: Hybrid Asset Allocation (2023)",
      url: "https://papers.ssrn.com/abstract=4346906",
    },
    rules:
      "Momentum is the average of the 1, 3, 6 and 12-month returns. With inflation-linked bonds (TIP) positive: the top K of SPY, IWM, EFA, EEM, VNQ, DBC, IEF and TLT, each with negative momentum replaced by the better of bills (BIL) and IEF; TIP negative, all in that better one. Monthly.",
    param: "how many to hold",
    grid: [4],
    tickers: ["SPY", "IWM", "EFA", "EEM", "VNQ", "DBC", "IEF", "TLT", "TIP", "BIL"],
  },
  paa: {
    label: "Protective asset allocation (PAA)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Keller & Keuning, Protective Asset Allocation (PAA): A Simple Momentum-Based Alternative for Term Deposits (2016)",
      url: "https://www.cxoadvisory.com/technical-trading/dual-momentum-with-multi-market-breadth-crash-protection",
    },
    rules:
      "Momentum is the price against its 12-month average, less one, over SPY, QQQ, IWM, VGK, EWJ, EEM, IYR, GSG, GLD, HYG, LQD and TLT. With n of the 12 positive and protection A, the bond share is (12 − n) / (12 − 3A), between 0 and 1, held in IEF; the rest in the top 6 positive ones, equal weight. Monthly.",
    param: "protection (A)",
    grid: [1, 2],
    tickers: [
      "SPY",
      "QQQ",
      "IWM",
      "VGK",
      "EWJ",
      "EEM",
      "IYR",
      "GSG",
      "GLD",
      "HYG",
      "LQD",
      "TLT",
      "IEF",
    ],
  },
  accelerating_dual_momentum: {
    label: "Accelerating dual momentum",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Engineered Portfolio's Accelerating Dual Momentum (2018), as published in an open TradingView script",
      url: "https://www.tradingview.com/script/LyF7R2tF/",
    },
    rules:
      "Each month, the better of US stocks (SPY) and foreign small companies (SCZ) by the average of their 1, 3 and 6-month returns, if positive; otherwise the better of long Treasuries (TLT) and inflation-linked bonds (TIP) over the last month.",
    param: "none",
    grid: [0],
    tickers: ["SPY", "SCZ", "TLT", "TIP"],
  },
  composite_dual_momentum: {
    label: "Composite dual momentum",
    family: "tactical",
    kind: "portfolio",
    source: {
      title: "Antonacci, Risk Premia Harvesting Through Dual Momentum (2012): its four modules",
      url: "https://alphaarchitect.com/2012/07/risk-premia-harvesting-through-momentum/",
    },
    rules:
      "A quarter each in four pairs: US/foreign stocks (SPY/EFA), high-yield/credit bonds (HYG/LQD), equity/mortgage REITs (VNQ/REM) and gold/Treasuries (GLD/TLT). Each month each quarter holds the pair's better fund over the last 12 months if it beat bills (BIL), else bills.",
    param: "months of look-back",
    grid: [12],
    tickers: ["SPY", "EFA", "HYG", "LQD", "VNQ", "REM", "GLD", "TLT", "BIL"],
  },
  eaa: {
    label: "Elastic asset allocation (EAA)",
    family: "tactical",
    kind: "portfolio",
    source: {
      title:
        "Keller & Butler, A Century of Generalized Momentum: From Flexible (FAA) to Elastic Asset Allocation (EAA) (2014)",
      url: "https://www.cxoadvisory.com/momentum-investing/long-run-test-of-a-tactical-tractable-mpt",
    },
    rules:
      "For SPY, QQQ, IWM, VGK, EWJ, EEM, VNQ, DBC, GLD, TLT and IEF: R is the average of the 1, 3, 6 and 12-month returns over bills, C the 12-month correlation with their equal-weight average. Each month, of those with R above 0, the top 1 + √11 by z = (R · √(1 − C))^S, weighted by z; the share of funds with R at or below 0 goes to short Treasuries (SHY).",
    param: "selection aggressiveness (S)",
    grid: [2],
    tickers: [
      "SPY",
      "QQQ",
      "IWM",
      "VGK",
      "EWJ",
      "EEM",
      "VNQ",
      "DBC",
      "GLD",
      "TLT",
      "IEF",
      "SHY",
      "BIL",
    ],
  },
  kda: {
    label: "Kipnis defensive adaptive (KDA)",
    family: "risk",
    kind: "portfolio",
    source: {
      title:
        "Kipnis, Right Now It's KDA... Asset Allocation (QuantStrat TradeR, 2019): DAA's canary with AAA's minimum variance",
      url: "https://www.r-bloggers.com/2019/01/right-now-its-kdaasset-allocation/",
    },
    rules:
      "13612W momentum. The canary VWO and BND sets the risky share: both positive 100%, one 50%, none 0%. The risky share goes to the top 5 of SPY, VGK, EWJ, EEM, VNQ, DBC, GLD, IEF and TLT by momentum, weighted to the least variance (21-day volatility, 252-day correlation); the rest to IEF if its momentum is positive, else bills (BIL). Monthly.",
    param: "how many to hold",
    grid: [5],
    tickers: ["SPY", "VGK", "EWJ", "EEM", "VNQ", "DBC", "GLD", "IEF", "TLT", "VWO", "BND", "BIL"],
  },
  adaptive_aa: {
    label: "Adaptive asset allocation",
    family: "risk",
    kind: "portfolio",
    source: {
      title: "Butler, Philbrick, Gordillo & Varadi, Adaptive Asset Allocation: A Primer (2012)",
      url: "https://www.r-bloggers.com/2023/12/adaptive-asset-allocation-replication/",
    },
    rules:
      "Of the ten asset ETFs, the top K by 6-month return, weighted to the least variance from their last 60 days' volatility and 250 days' correlations (long only). Monthly.",
    param: "how many to hold",
    grid: [3, 5],
    tickers: [...TEN],
  },
  risk_parity: {
    label: "Risk parity (inverse volatility)",
    family: "risk",
    kind: "portfolio",
    source: {
      title:
        "Asness, Frazzini & Pedersen, Leverage Aversion and Risk Parity (Financial Analysts Journal, 2012)",
      url: "https://www.aqr.com/Insights/Research/Journal-Article/Leverage-Aversion-and-Risk-Parity",
    },
    rules:
      "VTI, TLT, IEF, GLD and DBC, each weighted by the inverse of its volatility over the last N trading days, no leverage. Monthly.",
    param: "trading days of volatility",
    grid: [63, 126],
    tickers: ["VTI", "TLT", "IEF", "GLD", "DBC"],
  },
  min_variance: {
    label: "Minimum variance",
    family: "risk",
    kind: "portfolio",
    source: {
      title:
        "Clarke, de Silva & Thorley, Minimum-Variance Portfolio Composition (J. Portfolio Management, 2011)",
      url: "https://doi.org/10.3905/jpm.2011.37.2.031",
    },
    rules:
      "The ten asset ETFs weighted to the least variance over the last N trading days, long only, at most 40% in one. Monthly.",
    param: "trading days of history",
    grid: [126, 252],
    tickers: [...TEN],
  },
  max_diversification: {
    label: "Maximum diversification",
    family: "risk",
    kind: "portfolio",
    source: {
      title:
        "Choueifaty & Coignard, Toward Maximum Diversification (J. Portfolio Management, 2008); Properties of the Most Diversified Portfolio (2013)",
      url: "https://ideas.repec.org/a/rsk/journ6/2255764.html",
    },
    rules:
      "The ten asset ETFs weighted to the highest diversification ratio (average volatility over portfolio volatility) over the last N trading days, long only, at most 40% in one. Monthly.",
    param: "trading days of history",
    grid: [126, 252],
    tickers: [...TEN],
  },
  hrp: {
    label: "Hierarchical risk parity",
    family: "risk",
    kind: "portfolio",
    source: {
      title:
        "López de Prado, Building Diversified Portfolios that Outperform Out-of-Sample (J. Portfolio Management, 2016)",
      url: "https://papers.ssrn.com/abstract=2708678",
    },
    rules:
      "The ten asset ETFs clustered by correlation over the last N trading days (single linkage), then weighted by recursive bisection on inverse variance. Monthly.",
    param: "trading days of history",
    grid: [126, 252],
    tickers: [...TEN],
  },
  bond_rotation: {
    label: "Bond rotation",
    family: "rotation",
    kind: "portfolio",
    source: {
      title: "Antonacci, Dual Momentum Fixed Income (2014), widened to the main bond funds",
      url: "https://seekingalpha.com/article/2779905-dual-momentum-fixed-income",
    },
    rules:
      "Each month, the one of long, intermediate and short Treasuries (TLT, IEF, SHY), investment-grade and high-yield credit (LQD, HYG) and inflation-linked bonds (TIP) with the best last N months, if it beat bills (BIL); otherwise bills.",
    param: "months of look-back",
    grid: [3, 6],
    tickers: ["TLT", "IEF", "SHY", "LQD", "HYG", "TIP", "BIL"],
  },
  value: {
    label: "Value",
    family: "factor",
    kind: "equity",
    source: {
      title: "Fama & French, The Cross-Section of Expected Stock Returns (1992)",
      url: "https://doi.org/10.1111/j.1540-6261.1992.tb04398.x",
    },
    rules: "The level's US-stocks share held in a large-cap value fund (VTV).",
    param: "none",
    grid: [0],
    tickers: ["VTV"],
  },
  momentum: {
    label: "Momentum",
    family: "factor",
    kind: "equity",
    source: {
      title: "Jegadeesh & Titman, Returns to Buying Winners and Selling Losers (1993)",
      url: "https://doi.org/10.1111/j.1540-6261.1993.tb04702.x",
    },
    rules: "The level's US-stocks share held in a momentum fund (MTUM).",
    param: "none",
    grid: [0],
    tickers: ["MTUM"],
  },
  quality: {
    label: "Quality",
    family: "factor",
    kind: "equity",
    source: {
      title: "Asness, Frazzini & Pedersen, Quality Minus Junk (Review of Accounting Studies, 2019)",
      url: "https://papers.ssrn.com/abstract=2312432",
    },
    rules: "The level's US-stocks share held in a quality fund (QUAL).",
    param: "none",
    grid: [0],
    tickers: ["QUAL"],
  },
  low_volatility: {
    label: "Low volatility",
    family: "factor",
    kind: "equity",
    source: {
      title:
        "Baker, Bradley & Wurgler, Benchmarks as Limits to Arbitrage: Understanding the Low-Volatility Anomaly (FAJ, 2011)",
      url: "https://papers.ssrn.com/abstract=1745108",
    },
    rules: "The level's US-stocks share held in a minimum-volatility fund (USMV).",
    param: "none",
    grid: [0],
    tickers: ["USMV"],
  },
  size: {
    label: "Small companies",
    family: "factor",
    kind: "equity",
    source: {
      title: "Banz, The Relationship Between Return and Market Value of Common Stocks (1981)",
      url: "https://doi.org/10.1016/0304-405X(81)90018-0",
    },
    rules: "The level's US-stocks share held in a small-cap fund (IJR).",
    param: "none",
    grid: [0],
    tickers: ["IJR"],
  },
  small_value: {
    label: "Small value",
    family: "factor",
    kind: "equity",
    source: {
      title: "Fama & French, Common Risk Factors in the Returns on Stocks and Bonds (1993)",
      url: "https://doi.org/10.1016/0304-405X(93)90023-5",
    },
    rules: "The level's US-stocks share held in a small-cap value fund (IJS).",
    param: "none",
    grid: [0],
    tickers: ["IJS"],
  },
  multi_factor: {
    label: "Multi-factor",
    family: "factor",
    kind: "equity",
    source: {
      title: "Asness, Moskowitz & Pedersen, Value and Momentum Everywhere (J. Finance, 2013)",
      url: "https://www.aqr.com/Insights/Research/Journal-Article/Value-and-Momentum-Everywhere",
    },
    rules:
      "The level's US-stocks share split equally among value (VTV), momentum (MTUM), quality (QUAL), low volatility (USMV) and small companies (IJR), rebalanced monthly.",
    param: "none",
    grid: [0],
    tickers: ["VTV", "MTUM", "QUAL", "USMV", "IJR"],
  },
  equal_weight: {
    label: "Equal weight S&P 500",
    family: "factor",
    kind: "equity",
    source: {
      title: "Plyakha, Uppal & Vilkov, Why Does an Equal-Weighted Portfolio Outperform? (2012)",
      url: "https://climateinstitute.edhec.edu/publications/why-does-equal-weighted-portfolio-outperform-value-and-price-weighted-portfolios",
    },
    rules: "The level's US-stocks share held in an equal-weight S&P 500 fund (RSP).",
    param: "none",
    grid: [0],
    tickers: ["RSP"],
  },
  dividend_growth: {
    label: "Dividend growth",
    family: "factor",
    kind: "equity",
    source: {
      title:
        "Vanguard Dividend Appreciation (VIG): companies that have raised their dividends for 10+ years; the fund's own index",
      url: "https://investor.vanguard.com/investment-products/etfs/profile/vig",
    },
    rules: "The level's US-stocks share held in a dividend-growth fund (VIG).",
    param: "none",
    grid: [0],
    tickers: ["VIG"],
  },
  shareholder_yield: {
    label: "Shareholder yield",
    family: "factor",
    kind: "equity",
    source: {
      title:
        "Faber, Shareholder Yield (2013); Cambria's SYLD screens on dividends, buybacks and debt paydown",
      url: "https://www.etftrends.com/2013/05/new-shareholder-yield-etf-co-managed-by-mebane-faber/",
    },
    rules:
      "The level's US-stocks share held in a shareholder-yield fund (SYLD): dividends, buybacks and debt paid down.",
    param: "none",
    grid: [0],
    tickers: ["SYLD"],
  },
  sector_rotation: {
    label: "Sector rotation",
    family: "rotation",
    kind: "equity",
    source: {
      title: "Moskowitz & Grinblatt, Do Industries Explain Momentum? (1999)",
      url: "https://doi.org/10.1111/0022-1082.00146",
    },
    rules:
      "Each month, the level's US-stocks share split equally among the 3 of 9 sector funds with the best return over the last N months.",
    param: "months of look-back",
    grid: [3, 6, 12],
    tickers: [...SECTORS],
  },
  sector_trend: {
    label: "Sector rotation with a trend filter",
    family: "rotation",
    kind: "equity",
    source: {
      title:
        "Faber, Relative Strength Strategies for Investing (2010): top sectors, each above its 10-month average",
      url: "https://papers.ssrn.com/abstract=1585517",
    },
    rules:
      "Each month, a third each in the 3 of 9 sector funds with the best average 1, 3, 6 and 12-month return; any of them below its 10-month average is held as bills (BIL) instead.",
    param: "how many sectors",
    grid: [3],
    tickers: [...SECTORS, "BIL"],
  },
  trend_vol: {
    label: "Trend filter with volatility targeting",
    family: "protection",
    kind: "equity",
    source: {
      title: "Faber (2007) and Moreira & Muir (2017), together",
      url: "https://www.nber.org/papers/w22208",
    },
    rules:
      "Each week, the US-stocks share in bills (BIL) while SPY is below its 200-day average; above it, SPY scaled to a target volatility (its last 20 days', never above 100%), the rest in bills.",
    param: "target volatility, a year",
    grid: [0.12, 0.18],
    tickers: ["SPY", "BIL"],
  },
  trend_200: {
    label: "Trend filter on US stocks",
    family: "trend",
    kind: "equity",
    source: {
      title: "Faber (2007); Siegel, Stocks for the Long Run (the 200-day average)",
      url: "https://papers.ssrn.com/abstract=962461",
    },
    rules:
      "At each month-end, the level's US-stocks share in SPY while it closes above its N-day average, else in bills (BIL).",
    param: "days in the average",
    grid: [100, 150, 200],
    tickers: ["SPY", "BIL"],
  },
  time_series_momentum: {
    label: "Time-series momentum",
    family: "trend",
    kind: "equity",
    source: {
      title: "Moskowitz, Ooi & Pedersen, Time Series Momentum (J. Financial Economics, 2012)",
      url: "https://doi.org/10.1016/j.jfineco.2011.11.003",
    },
    rules:
      "At each month-end, the level's US-stocks share in SPY when its last N months beat bills (BIL), else in bills.",
    param: "months of look-back",
    grid: [6, 9, 12],
    tickers: ["SPY", "BIL"],
  },
  vol_target: {
    label: "Volatility targeting",
    family: "protection",
    kind: "equity",
    source: {
      title: "Moreira & Muir, Volatility-Managed Portfolios (J. Finance, 2017)",
      url: "https://www.nber.org/papers/w22208",
    },
    rules:
      "Each week, the level's US-stocks share is SPY scaled to a target volatility (its last 20 days' volatility, never above 100%), the rest in bills (BIL).",
    param: "target volatility, a year",
    grid: [0.1, 0.15],
    tickers: ["SPY", "BIL"],
  },
  cppi: {
    label: "Portfolio insurance (CPPI)",
    family: "protection",
    kind: "equity",
    source: {
      title: "Perold (1986); Black & Jones, Simplifying Portfolio Insurance (1987)",
      url: "https://en.wikipedia.org/wiki/Constant_proportion_portfolio_insurance",
    },
    rules:
      "Within the US-stocks share: a floor of 80% of its value at each year's start; SPY is M times the cushion above the floor (at most all), the rest in bills (BIL). Weekly.",
    param: "multiplier",
    grid: [3, 5],
    tickers: ["SPY", "BIL"],
  },
  tipp: {
    label: "Portfolio insurance (TIPP)",
    family: "protection",
    kind: "equity",
    source: {
      title: "Estep & Kritzman, TIPP: Insurance without Complexity (J. Portfolio Management, 1988)",
      url: "https://quantpedia.com/time-invariant-portfolio-protection/",
    },
    rules:
      "As CPPI, but the floor is 80% of the highest value so far (it only ratchets up). Weekly.",
    param: "multiplier",
    grid: [3, 5],
    tickers: ["SPY", "BIL"],
  },
  managed_futures: {
    label: "Managed futures (ETF)",
    family: "trend",
    kind: "sleeve",
    source: {
      title:
        "Hurst, Ooi & Pedersen, A Century of Evidence on Trend-Following Investing (2017); DBMF as the ETF proxy",
      url: "https://www.aqr.com/Insights/Research/Journal-Article/A-Century-of-Evidence-on-Trend-Following-Investing",
    },
    rules:
      "10% of the portfolio moved from its bonds into a managed-futures ETF (DBMF), rebalanced monthly. DBMF began in 2019, so there are no earlier years to choose on.",
    param: "none",
    grid: [0],
    tickers: ["DBMF"],
  },
  sell_in_may: {
    label: "Sell in May",
    family: "seasonal",
    kind: "equity",
    source: {
      title: "Bouman & Jacobsen, The Halloween Indicator (American Economic Review, 2002)",
      url: "https://doi.org/10.1257/000282802762024683",
    },
    rules:
      "The level's US-stocks share in SPY from November through April, in bills (BIL) from May through October.",
    param: "none",
    grid: [0],
    tickers: ["SPY", "BIL"],
  },
  turn_of_month: {
    label: "Turn of the month",
    family: "seasonal",
    kind: "equity",
    source: {
      title: "Lakonishok & Smidt, Are Seasonal Anomalies Real? (Review of Financial Studies, 1988)",
      url: "https://doi.org/10.1093/rfs/1.4.403",
    },
    rules:
      "The level's US-stocks share in SPY from the last trading day of each month through the Nth trading day of the next, in bills (BIL) otherwise.",
    param: "trading days into the month",
    grid: [3, 4],
    tickers: ["SPY", "BIL"],
  },
  rsi2: {
    label: "RSI(2) pullbacks",
    family: "reversion",
    kind: "equity",
    source: {
      title: "Connors & Alvarez, Short Term Trading Strategies That Work (2008)",
      url: "https://www.luxalgo.com/library/concept/rsi-2/",
    },
    rules:
      "While SPY is above its 200-day average, buy the US-stocks share into SPY at a close with a 2-day RSI below X; out to bills (BIL) at the first close above the 5-day average.",
    param: "RSI(2) below",
    grid: [5, 10],
    tickers: ["SPY", "BIL"],
  },
  ibs: {
    label: "Internal bar strength",
    family: "reversion",
    kind: "equity",
    source: {
      title:
        "Pagonidis, The IBS Effect: Mean Reversion in Equity ETFs (2013); replication, arXiv 2306.12434",
      url: "https://arxiv.org/abs/2306.12434",
    },
    rules:
      "Hold the US-stocks share in SPY for the next day after a close in the bottom X of the day's range ((close − low) / (high − low)); bills (BIL) otherwise.",
    param: "IBS below",
    grid: [0.15, 0.25],
    tickers: ["SPY", "BIL"],
  },
  bollinger: {
    label: "Bollinger band pullbacks",
    family: "reversion",
    kind: "equity",
    source: {
      title: "Bollinger, Bollinger on Bollinger Bands (2001)",
      url: "https://www.bollingerbands.com/",
    },
    rules:
      "While SPY is above its 200-day average, buy the US-stocks share into SPY at a close below its 20-day average less K standard deviations; out to bills (BIL) at a close above the 20-day average.",
    param: "standard deviations",
    grid: [1.5, 2],
    tickers: ["SPY", "BIL"],
  },
} as const satisfies Record<string, CatalogEntry>;

export type CatalogId = keyof typeof CATALOG;
export const CATALOG_IDS = Object.keys(CATALOG) as CatalogId[];

// Every ticker the catalog reads, with the level mix's own.
export const catalogTickers = (): string[] =>
  [...new Set([...MIX, ...Object.values(CATALOG).flatMap((e) => e.tickers)])].sort();
export const CATALOG_MIX_FUNDS = {
  us_stocks: "VTI",
  intl_stocks: "VXUS",
  bonds: "BND",
  cash: "BIL",
} as const;

// What a trade costs, each way: the research's own (STRATEGY_TRADE_COST_BPS) plus slippage.
export const CATALOG_SLIPPAGE_BPS = 2;
// Walk-forward: each year from this one is scored with the setting the years before chose.
export const CATALOG_WALK_FROM_YEAR = 2020;
// Several start years: the walk-forward must also beat the mix measured from each of these.
export const CATALOG_ALSO_FROM_YEARS: readonly number[] = [2021, 2022];
// The fixed split the founder asked for: chosen on the years to the end of 2021, scored after.
export const CATALOG_TRAIN_END = "2021-12-31";
// Recommendable only with a deflated Sharpe ratio (Bailey & López de Prado) of the excess over
// the level's mix at least this, after the haircut for every trial tested.
export const CATALOG_MIN_DSR = 0.95;
// And never riskier than the level's budget or its own mix, by more than this.
export const CATALOG_RISK_SLACK = 0.01;
// The most of the portfolio one fund may be in the risk-based optimizers.
export const CATALOG_MAX_WEIGHT = 0.4;
// A whole-portfolio strategy's volatility is matched to the level's mix with bills, from the
// years before, never above 100% in the strategy.
export const CATALOG_SLEEVE_SHARE = 0.1;
