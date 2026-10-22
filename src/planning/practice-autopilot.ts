import {
  AUTOPILOT_LIMITS as L,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  type PracticeClass,
} from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";
import type { LedgerState } from "./practice-ledger";

// Autopilot for the practice portfolio (spec step 291, Phase AW, Stage A). Pure: given the model
// portfolio for the person's level, what the ledger holds and today's prices, the trades that
// bring the practice portfolio to the model: buy the model with cash, rebalance when a class
// drifts past the band, and nothing when paused. Every trade carries a reason in a sentence and
// the rule that allowed it, and every one is held to the hard limits (no leverage, no options, no
// shorting, a per-trade and per-position cap, a daily count).

export type PlannedTrade = {
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  reason: string;
  rule: "model_buy" | "rebalance";
};

export type Prices = Readonly<Record<string, number>>;

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const LABEL: Record<PracticeClass, string> = {
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
  bonds: "bonds",
  cash: "short-term bills",
};

export function positionValue(state: LedgerState, prices: Prices, ticker: string): number {
  const p = state.positions[ticker];
  return p ? Math.round(p.quantity * (prices[ticker] ?? 0)) : 0;
}

export function portfolioValue(state: LedgerState, prices: Prices): number {
  return (
    state.cashCents +
    Object.keys(state.positions).reduce((s, t) => s + positionValue(state, prices, t), 0)
  );
}

// Why a trade can't be made, or null. The same checks the runner applies before it places one.
export function violates(
  trade: Pick<PlannedTrade, "ticker" | "side" | "amountCents">,
  state: LedgerState,
  prices: Prices,
  tradesToday: number,
  // The portfolio's value before today's trades, when several are checked together (trading
  // moves value between cash and positions without changing it).
  totalCents = portfolioValue(state, prices),
  // Bought earlier in the same plan, not yet in the state.
  alreadyBought = 0,
): string | null {
  if (tradesToday >= L.tradesPerDay) return `already ${L.tradesPerDay} trades today`;
  const total = totalCents;
  if (trade.side === "buy" && trade.amountCents > state.cashCents) return "would need to borrow";
  if (trade.amountCents > Math.round(total * L.perTradeShare)) return "more than the per-trade cap";
  if (trade.side === "buy") {
    const after = positionValue(state, prices, trade.ticker) + alreadyBought + trade.amountCents;
    const isStock = (PRACTICE_STOCKS as readonly string[]).includes(trade.ticker);
    const cap = Math.round(total * (isStock ? L.perStockShare : L.perEtfShare));
    if (after > cap) return "more than the per-position cap";
  }
  return null;
}

export function planTrades(input: {
  level: RiskLevel;
  state: LedgerState;
  prices: Prices;
  paused: boolean;
  tradesToday: number;
}): PlannedTrade[] {
  if (input.paused) return [];
  const { state, prices } = input;
  const weights = MODEL_PORTFOLIOS[input.level].weights;
  const modelValue = (c: PracticeClass) => positionValue(state, prices, PRACTICE_ETFS[c].ticker);
  // The model's value: cash waiting plus the ETFs (opportunity stocks sit outside it).
  const total = state.cashCents + CLASSES.reduce((s, c) => s + modelValue(c), 0);
  if (total <= 0) return [];
  const gap = (c: PracticeClass) => Math.round(weights[c] * total) - modelValue(c);
  const band = Math.round(L.rebalanceBand * total);
  const first = CLASSES.every((c) => modelValue(c) === 0);

  const trades: PlannedTrade[] = [];
  let cash = state.cashCents;
  const whole = portfolioValue(state, prices);
  const bought: Record<string, number> = {};
  const track = (t: PlannedTrade) => {
    const v = violates(
      t,
      { cashCents: cash, positions: state.positions },
      prices,
      input.tradesToday + trades.length,
      whole,
      bought[t.ticker] ?? 0,
    );
    if (v) return;
    trades.push(t);
    cash += t.side === "sell" ? t.amountCents : -t.amountCents;
    if (t.side === "buy") bought[t.ticker] = (bought[t.ticker] ?? 0) + t.amountCents;
  };

  // Rebalance: sell what is over its target by more than the band.
  for (const c of CLASSES) {
    const over = -gap(c);
    if (over > band && over >= L.minTradeCents) {
      const ticker = PRACTICE_ETFS[c].ticker;
      const amount = Math.min(over, modelValue(c));
      track({
        ticker,
        side: "sell",
        amountCents: amount,
        rule: "rebalance",
        reason: `${LABEL[c]} had grown to ${pct(modelValue(c) / total)} of the portfolio against a target of ${pct(weights[c])}, so ${dollars(amount)} moved back.`,
      });
    }
  }
  // Buy what is under its target, from cash on hand, in proportion to how far under each is.
  const deficits = CLASSES.map((c) => ({ c, d: Math.max(0, gap(c)) })).filter(
    (x) => x.d >= L.minTradeCents,
  );
  const needed = deficits.reduce((s, x) => s + x.d, 0);
  const spend = Math.min(cash, needed);
  for (const { c, d } of deficits) {
    const amount = Math.floor((spend * d) / needed);
    if (amount < L.minTradeCents) continue;
    track({
      ticker: PRACTICE_ETFS[c].ticker,
      side: "buy",
      amountCents: amount,
      rule: first ? "model_buy" : "rebalance",
      reason: first
        ? `Starting the model for your level: ${pct(weights[c])} in ${LABEL[c]}, ${dollars(amount)} to begin.`
        : `${LABEL[c]} was ${pct(modelValue(c) / total)} of the portfolio against a target of ${pct(weights[c])}, so ${dollars(amount)} was added.`,
    });
  }
  return trades;
}
