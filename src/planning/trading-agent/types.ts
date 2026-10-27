import type { AgentCosts } from "@/config/trading-agent";
import type { IntradayBar } from "@/lib/market/types";

// The 24-hour trading agent's shapes (src/planning/trading-agent/). Pure data: the same shapes
// run a replay over years of bars and a live catch-up over the bars since the last tick, and
// the events layer adds its own signals through AgentSignal. Simulated money only.

export type Weights = Readonly<Record<string, number>>;

// One bar of one ticker, prices in cents (Alpaca's and Yahoo's bars as the market data gives
// them). `t` is the bar's start, ISO in UTC.
export type AgentBar = IntradayBar;

// Every ticker's bars on one time axis: the master ticker's bar times, each other ticker's last
// close carried into a bar it has none for (0 before its first). `dates` is the made-up calendar
// the catalog's rules read (./clock.ts): one business day per bar.
export type Timeline = {
  times: string[];
  // Each bar's count on the agent's axis, and its made-up date.
  numbers: number[];
  dates: string[];
  // The made-up date of the bar after the last one, by the clock (it may not exist yet), so the
  // last bar knows whether a month ends there without waiting for the next.
  nextDate: string;
  open: Record<string, number[]>;
  high: Record<string, number[]>;
  low: Record<string, number[]>;
  close: Record<string, number[]>;
};

// What a strategy knows between bars: its value as an index from 1 at the start, what it last
// asked to hold, and its own memory (a floor, a peak).
export type PolicyContext = { value: number; held: Weights; memo: Record<string, number> };

export type Policy = {
  // "catalog:trend_200@BTC/USD", "crypto:crypto_trend", "catalog:haa".
  key: string;
  label: string;
  // The tickers it holds or reads, as this market names them.
  tickers: readonly string[];
  // The settings it is tried with.
  grid: readonly number[];
  // What just holding means for this rule: the asset it is pointed at (QQQ, ether), else the
  // market's own (SPY, bitcoin).
  hold?: string;
  // The weights to hold after bar t's close, from bars up to and including t, or null to keep
  // what it holds. Must never read bar t+1 or later.
  decide(tl: Timeline, t: number, param: number, ctx: PolicyContext): Weights | null;
};

// A signal from outside the strategy (the events layer: news, filings, a planned move): from
// `at` until `until` (or for good), `ticker` is held at `weight` of the account, and the
// strategy's other weights share the rest. It acts at the first bar closing at or after `at`, and
// fills at the next bar's open, like the strategy's own decisions.
export type AgentSignal = {
  id: string;
  at: string;
  until?: string | null;
  ticker: string;
  weight: number;
  reason: string;
  source: string;
  // A stop: once the signal's trade has filled, if the ticker closes this share against the fill
  // (down for a buy, up for a sell), the signal ends early and its trade is undone at the next
  // bar's open. Absent: only `until` ends it.
  stopPct?: number | null;
  // A tilt: `weight` is a change to the strategy's own weight of the ticker (+ adds that share of
  // the account, − takes it to cash), not a level to hold. The events layer's slices are tilts:
  // a 3% slice in bitcoin on a strategy already holding all bitcoin changes nothing, instead of
  // cutting bitcoin to 3%. The result stays between 0 and the whole account.
  tilt?: boolean;
};

// The agent's state between ticks. Cash and units are kept exact (not rounded to cents) so a
// catch-up in pieces lands on the same numbers as one run.
export type AgentState = {
  cash: number;
  units: Record<string, number>;
  // The strategy's own context.
  value: number;
  held: Record<string, number>;
  memo: Record<string, number>;
  // The strategy's last weights (before signals), and the signals in force at the last bar.
  base: Record<string, number> | null;
  activeSignals: string[];
  // Decided at the last bar's close, to fill at the next bar's open.
  pending: {
    weights: Record<string, number>;
    reasons: Record<string, string>;
    source: string;
    // The signal behind each ticker's trade, for its stop (signals with a stop only).
    signals?: Record<string, string>;
  } | null;
  // Each stopped signal's fill (its side and price), or "hit" once its stop has ended it.
  stops?: Record<string, { side: "buy" | "sell"; price: number } | "hit">;
  // The value it started with (cents), for the index.
  startValue: number;
  // The last bar it has acted on, and its count on the agent's axis (./clock.ts).
  lastBarAt: string | null;
  lastBarN: number;
};

export type AgentTrade = {
  at: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  // The fill price after the half spread and slippage, and what changed hands at it.
  priceCents: number;
  amountCents: number;
  // The broker's fee, on top of the amount; and what the spread and slippage cost against the
  // bar's open (already in the price).
  feeCents: number;
  spreadCents: number;
  reason: string;
  source: string;
};

export type AgentValue = { at: string; valueCents: number };

export type AgentConfig = {
  policy: Policy;
  param: number;
  costs: AgentCosts;
  // Plain cash ("USD") is held, never traded.
  cash: string;
  // A strategy's label in its reasons ("HAA at 1 hour").
  label?: string;
  minTradeShare?: number;
};

export type AgentRun = { state: AgentState; trades: AgentTrade[]; values: AgentValue[] };
