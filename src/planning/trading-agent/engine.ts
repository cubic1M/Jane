import { AGENT_MIN_TRADE_SHARE, CASH_TICKER } from "@/config/trading-agent";
import { intervalMs, timelineOf } from "./clock";
import type {
  AgentBar,
  AgentConfig,
  AgentRun,
  AgentSignal,
  AgentState,
  AgentTrade,
  AgentValue,
  Timeline,
  Weights,
} from "./types";

// The 24-hour agent (src/planning/trading-agent/). One loop over bars, the same for a replay of
// years and for a live catch-up of the bars since the last tick:
// 1. what was decided at the last bar's close fills at this bar's open, paying the half spread and
//    slippage in the price and the broker's fee on top (so a night's or weekend's gap in market
//    hours is in the fill, as it would be);
// 2. the account is valued at this bar's close;
// 3. the strategy decides from bars up to and including this one, and the signals in force are
//    laid over its weights; any change waits for the next bar's open.
// Nothing reads a later bar. The state carries everything between bars, exactly (no rounding), so
// replaying the bars since the last tick lands on the same trades and values as running without
// a break. Simulated money only. Pure.

const BPS = 10_000;

export function startState(startCents: number): AgentState {
  return {
    cash: startCents,
    units: {},
    value: 1,
    held: {},
    memo: {},
    base: null,
    activeSignals: [],
    pending: null,
    startValue: startCents,
    lastBarAt: null,
    lastBarN: -1,
  };
}

const copy = (s: AgentState): AgentState => ({
  ...s,
  units: { ...s.units },
  held: { ...s.held },
  memo: { ...s.memo },
  base: s.base ? { ...s.base } : null,
  activeSignals: [...s.activeSignals],
  pending: s.pending
    ? {
        weights: { ...s.pending.weights },
        reasons: { ...s.pending.reasons },
        source: s.pending.source,
        ...(s.pending.signals ? { signals: { ...s.pending.signals } } : {}),
      }
    : null,
  ...(s.stops ? { stops: { ...s.stops } } : {}),
});

const pct = (w: number) => `${Math.round(w * 1000) / 10}%`;

// The signals' weights laid over the strategy's: each signal's ticker at its weight (a tilt: the
// strategy's own weight plus the signal's), the strategy's other weights scaled into what is left.
export function overlay(base: Weights, signals: readonly AgentSignal[]): Record<string, number> {
  const fixed: Record<string, number> = {};
  for (const g of signals) {
    const w = g.tilt ? (fixed[g.ticker] ?? base[g.ticker] ?? 0) + g.weight : g.weight;
    fixed[g.ticker] = Math.max(0, Math.min(1, w));
  }
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
  // Signals asking for more than the whole account share it.
  const shrink = fixedSum > 1 ? 1 / fixedSum : 1;
  const taken = Math.min(1, fixedSum);
  const rest = Object.entries(base).filter(([t, w]) => !(t in fixed) && w > 0);
  const restSum = rest.reduce((a, [, w]) => a + w, 0);
  const room = Math.min(restSum, 1 - taken);
  const out: Record<string, number> = {};
  for (const [t, w] of rest) if (restSum > 0 && room > 0) out[t] = (w / restSum) * room;
  for (const [t, w] of Object.entries(fixed)) if (w > 0) out[t] = w * shrink;
  return out;
}

// A stopped signal's first fill: the price its stop is measured from.
function noteFill(s: AgentState, ticker: string, side: "buy" | "sell", price: number) {
  const id = s.pending?.signals?.[ticker];
  if (!id) return;
  s.stops ??= {};
  if (s.stops[id] === undefined) s.stops[id] = { side, price };
}

function valueAt(s: AgentState, price: (t: string) => number): number {
  let v = s.cash;
  for (const [t, q] of Object.entries(s.units)) v += q * price(t);
  return v;
}

// The pending weights filled at bar i's open.
function fillAt(
  s: AgentState,
  tl: Timeline,
  i: number,
  config: AgentConfig,
  trades: AgentTrade[],
): void {
  const pending = s.pending!;
  const at = tl.times[i];
  const open = (t: string) => tl.open[t]?.[i] ?? 0;
  const v = valueAt(s, (t) => open(t) || (tl.close[t]?.[i] ?? 0));
  const { feeBps, halfSpreadBps, slippageBps } = config.costs;
  const fee = feeBps / BPS;
  const edge = (halfSpreadBps + slippageBps) / BPS;
  const min = (config.minTradeShare ?? AGENT_MIN_TRADE_SHARE) * v;
  const tickers = [...new Set([...Object.keys(s.units), ...Object.keys(pending.weights)])]
    .filter((t) => t !== config.cash && t !== CASH_TICKER)
    .sort();
  const reason = (t: string, w: number) =>
    pending.reasons[t] ??
    `${config.label ?? config.policy.label}: ${t} to ${pct(w)} of the account at the last bar's close.`;
  const buys: { t: string; want: number; p: number }[] = [];
  for (const t of tickers) {
    const p = open(t);
    if (!(p > 0)) continue;
    const w = pending.weights[t] ?? 0;
    const have = (s.units[t] ?? 0) * p;
    const delta = w * v - have;
    if (delta < 0 && (w === 0 || -delta >= min)) {
      const qty = w === 0 ? s.units[t] : Math.min(s.units[t], -delta / p);
      const px = p * (1 - edge);
      const gross = qty * px;
      const brokerFee = gross * fee;
      s.cash += gross - brokerFee;
      s.units[t] -= qty;
      if (w === 0 || s.units[t] <= 1e-12) delete s.units[t];
      noteFill(s, t, "sell", px);
      trades.push({
        at,
        ticker: t,
        side: "sell",
        quantity: qty,
        priceCents: px,
        amountCents: gross,
        feeCents: brokerFee,
        spreadCents: qty * (p - px),
        reason: reason(t, w),
        source: pending.source,
      });
    } else if (delta >= min) buys.push({ t, want: delta, p });
  }
  const wanted = buys.reduce((a, b) => a + b.want, 0);
  const scale = wanted > s.cash ? s.cash / wanted : 1;
  for (const b of buys) {
    const spend = b.want * scale;
    if (spend < min) continue;
    const px = b.p * (1 + edge);
    const gross = spend / (1 + fee);
    const qty = gross / px;
    const brokerFee = gross * fee;
    s.cash -= gross + brokerFee;
    s.units[b.t] = (s.units[b.t] ?? 0) + qty;
    noteFill(s, b.t, "buy", px);
    trades.push({
      at,
      ticker: b.t,
      side: "buy",
      quantity: qty,
      priceCents: px,
      amountCents: gross,
      feeCents: brokerFee,
      spreadCents: qty * (px - b.p),
      reason: reason(b.t, pending.weights[b.t] ?? 0),
      source: pending.source,
    });
  }
  if (s.cash < 0 && s.cash > -1e-6) s.cash = 0;
  s.pending = null;
}

const sameWeights = (a: Weights, b: Weights) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 1e-9) return false;
  return true;
};

// The loop over a timeline from bar `from` (the first bar after the state's last).
export function runOnTimeline(
  state: AgentState,
  tl: Timeline,
  signals: readonly AgentSignal[],
  config: AgentConfig & { minutes: number },
  from = state.lastBarAt ? tl.times.findIndex((t) => t > state.lastBarAt!) : 0,
): AgentRun {
  const s = copy(state);
  const trades: AgentTrade[] = [];
  const values: AgentValue[] = [];
  if (from < 0) return { state: s, trades, values };
  const span = intervalMs(config.minutes);
  for (let i = from; i < tl.times.length; i += 1) {
    if (s.pending) fillAt(s, tl, i, config, trades);
    const close = (t: string) => tl.close[t]?.[i] ?? 0;
    const v = valueAt(s, close);
    values.push({ at: tl.times[i], valueCents: v });
    s.value = v / s.startValue;
    // The strategy, from what it asked to hold (before any signal).
    const ctx = { value: s.value, held: s.held, memo: s.memo };
    const target = config.policy.decide(tl, i, config.param, ctx);
    s.memo = ctx.memo;
    // A signal whose ticker closed past its stop ends here; its trade is undone at the next open.
    const stopped: Record<string, string> = {};
    for (const g of signals) {
      const entry = s.stops?.[g.id];
      if (!g.stopPct || !entry || entry === "hit" || !s.activeSignals.includes(g.id)) continue;
      const c = close(g.ticker);
      const moved = entry.side === "buy" ? 1 - c / entry.price : c / entry.price - 1;
      if (c > 0 && moved >= g.stopPct) {
        s.stops![g.id] = "hit";
        stopped[g.ticker] =
          `Stopped: ${g.ticker} closed ${pct(moved)} ${entry.side === "buy" ? "below" : "above"} the signal's fill (its stop is ${pct(g.stopPct)}).`;
      }
    }
    // The signals in force when this bar closes.
    const closesAt = Date.parse(tl.times[i]) + span;
    const active = signals.filter(
      (g) =>
        Date.parse(g.at) <= closesAt &&
        (!g.until || closesAt < Date.parse(g.until)) &&
        s.stops?.[g.id] !== "hit",
    );
    const ids = active.map((g) => g.id).sort();
    const changed = ids.join("|") !== s.activeSignals.join("|");
    if (target !== null) {
      s.base = { ...target };
      s.held = { ...target };
    }
    if (target !== null || changed) {
      const weights = overlay(s.base ?? {}, active);
      const reasons: Record<string, string> = { ...stopped };
      const bySignal: Record<string, string> = {};
      for (const g of active) {
        reasons[g.ticker] = g.reason;
        if (g.stopPct) bySignal[g.ticker] = g.id;
      }
      const ended = signals.find((g) => g.ticker in stopped);
      const current = s.pending?.weights;
      if (target !== null || !current || !sameWeights(current, weights))
        s.pending = {
          weights,
          reasons,
          source: target !== null ? "rule" : (active[0]?.source ?? ended?.source ?? "signal"),
          ...(Object.keys(bySignal).length > 0 ? { signals: bySignal } : {}),
        };
    }
    s.activeSignals = ids;
    s.lastBarAt = tl.times[i];
    s.lastBarN = tl.numbers[i];
  }
  return { state: s, trades, values };
}

// runAgent(account, bars, signals): the state after every bar newer than its last, the trades
// made and each bar's value. `bars` must reach back far enough for the strategy's look-back
// (AGENT_LOOKBACK_BARS); bars at or before the state's last bar are read as history only.
export function runAgent(
  state: AgentState,
  bars: Readonly<Record<string, readonly AgentBar[]>>,
  signals: readonly AgentSignal[],
  config: AgentConfig & { master: string; session: "24h" | "nyse"; minutes: number },
): AgentRun {
  const tl = timelineOf(
    bars,
    config.master,
    config.session,
    state.lastBarAt ? { at: state.lastBarAt, n: state.lastBarN } : null,
  );
  return runOnTimeline(state, tl, signals, config);
}
