// The 24-hour trading agent (founder, 2026-10-26): the strategy catalog and the crypto rules run
// bar by bar at 15 minutes or 1 hour, first replayed on past bars (src/planning/trading-agent/
// harness.ts, docs/backtests/intraday.md) and then on the paper account around the clock
// (src/lib/trading-agent/). Simulated money only: prices are read, no order is ever sent.
// Demo advice only. FOR REVIEW: every number here.

export type AgentInterval = "15m" | "1h";
export const AGENT_INTERVALS: Readonly<
  Record<AgentInterval, { label: string; minutes: number; alpaca: string; yahoo: string }>
> = {
  "15m": { label: "15 minutes", minutes: 15, alpaca: "15Min", yahoo: "15m" },
  "1h": { label: "1 hour", minutes: 60, alpaca: "1Hour", yahoo: "60m" },
};
export const AGENT_INTERVAL_IDS = Object.keys(AGENT_INTERVALS) as AgentInterval[];

export type AgentMarketId = "crypto" | "stocks";

export type AgentCosts = {
  // The broker's fee, the half spread and slippage, each in basis points of what changes hands.
  feeBps: number;
  halfSpreadBps: number;
  slippageBps: number;
};

export type AgentMarket = AgentCosts & {
  label: string;
  line: string;
  // "24h": bars around the clock; "nyse": New York regular hours, with nights and weekends as
  // gaps (a trade decided at the last bar fills at the next morning's open).
  session: "24h" | "nyse";
  // Held when a strategy holds nothing: "USD" is plain cash (no price, no cost); a ticker is a
  // fund bought and sold like any other (the catalog's bills fund).
  cash: string;
  // What "just holding" means for this market, for the comparison.
  hold: string;
  // The coins or funds a single-asset strategy can be pointed at.
  assets: readonly string[];
};

export const AGENT_MARKETS: Readonly<Record<AgentMarketId, AgentMarket>> = {
  crypto: {
    label: "Bitcoin and ether, around the clock",
    line: "Crypto trades every hour of every day, so the agent does too.",
    session: "24h",
    cash: "USD",
    hold: "BTC/USD",
    assets: ["BTC/USD", "ETH/USD"],
    // Alpaca's crypto taker fee at the lowest volume tier (0.25%), about a basis point of half
    // spread on bitcoin and ether, and a little slippage.
    feeBps: 25,
    halfSpreadBps: 1,
    slippageBps: 2,
  },
  stocks: {
    label: "US funds, in market hours",
    line: "Stock funds trade 9:30 to 4 New York time on weekdays; nights and weekends are gaps.",
    session: "nyse",
    cash: "BIL",
    hold: "SPY",
    assets: ["SPY", "QQQ"],
    // No commission; about a basis point of half spread on SPY and QQQ (more on smaller funds,
    // covered by the slippage), and slippage.
    feeBps: 0,
    halfSpreadBps: 1,
    slippageBps: 2,
  },
};
export const AGENT_MARKET_IDS = Object.keys(AGENT_MARKETS) as AgentMarketId[];

// Plain cash's price, so it can sit in the same arithmetic as a fund (never traded).
export const CASH_TICKER = "USD";
export const CASH_PRICE_CENTS = 100;

// A trade smaller than this share of the account is skipped (no dust trades).
export const AGENT_MIN_TRADE_SHARE = 0.001;

// The replay's walk-forward: the first share of bars only trains; the rest is cut into folds, each
// scored with the setting the bars before it chose (by Sharpe ratio).
export const AGENT_TRAIN_SHARE = 0.4;
export const AGENT_FOLDS = 3;
// The haircut for testing many strategies (the catalog's, src/config/strategy-catalog.ts): a
// strategy beats holding only when the deflated Sharpe ratio of its walk-forward returns over
// holding, against the best of every trial run, is at least this.
export const AGENT_MIN_DSR = 0.95;

// How many bars of history the agent reads before the first new bar (its longest look-back, a
// year of bars, with room).
export const AGENT_LOOKBACK_BARS = 300;
// When the agent starts, it replays this many hours first, so the account shows how it trades.
export const AGENT_WARMUP_HOURS = 24;
// The most bars one catch-up replays (a month of 15-minute bars); older ones are skipped.
export const AGENT_MAX_CATCHUP_BARS = 3_000;

export const AGENT_WARNING =
  "Trading this often usually loses to just holding once fees and spreads are paid. Practice money only, to see how a rule would behave.";
