import {
  AUTOPILOT_LIMITS as L,
  classTickers,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  stocksShare,
  type PracticeClass,
} from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";
import { DRIFT_STOCKS_BAND } from "@/config/practice-scan";
import type { LedgerState } from "./practice-ledger";

// Autopilot for the practice portfolio (spec step 291, Phase AW, Stage A). Pure: given the model
// portfolio for the person's level, what the ledger holds and today's prices, the trades that
// bring the practice portfolio to the model: buy the model with cash, rebalance when a class
// drifts past the band, and nothing when paused. Every trade carries a reason in a sentence and
// the rule that allowed it, and every one is held to the hard limits (no leverage, no options, no
// shorting, a per-trade and per-position cap, a daily count). A kind may be held in its main fund
// or, after a tax-loss swap (step 292), its partner; a fund sold at a loss in the last 30 days
// (`blocked`) is never bought back, so no trade makes a wash sale.

export type PlannedTrade = {
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  reason: string;
  rule: "model_buy" | "rebalance";
};

export type Prices = Readonly<Record<string, number>>;

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
// One formatter, made once: the rule replay formats thousands of reasons.
const USD = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (cents: number) => `$${USD.format(cents / 100)}`;
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
  blocked?: ReadonlySet<string>;
}): PlannedTrade[] {
  if (input.paused) return [];
  const { state, prices } = input;
  const blocked = input.blocked ?? new Set<string>();
  const weights = MODEL_PORTFOLIOS[input.level].weights;
  const held = (t: string) => positionValue(state, prices, t);
  const modelValue = (c: PracticeClass) => classTickers(c).reduce((s, t) => s + held(t), 0);
  // The fund a kind is held in (the larger, after a swap), and the one to buy more of.
  const sellTicker = (c: PracticeClass) =>
    classTickers(c).reduce((a, b) => (held(b) > held(a) ? b : a));
  // New money goes into a fund of the kind that isn't at a loss, so buying never turns a loss
  // still to be harvested into a wash sale.
  const atLoss = (t: string) => {
    const p = state.positions[t];
    return p !== undefined && held(t) < p.costBasisCents;
  };
  const buyTicker = (c: PracticeClass) => {
    const open = [sellTicker(c), ...classTickers(c)].filter((t) => !blocked.has(t));
    return open.find((t) => !atLoss(t)) ?? open[0] ?? null;
  };
  // The model's value: cash waiting plus the ETFs (opportunity stocks sit outside it).
  const total = state.cashCents + CLASSES.reduce((s, c) => s + modelValue(c), 0);
  if (total <= 0) return [];
  const gap = (c: PracticeClass) => Math.round(weights[c] * total) - modelValue(c);
  const band = Math.round(L.rebalanceBand * total);
  const first = CLASSES.every((c) => modelValue(c) === 0);
  // Stocks together past their band: every kind over its target goes back, not only those past
  // the band on their own.
  const stocks = (modelValue("us_stocks") + modelValue("intl_stocks")) / total;
  const stocksPast = !first && Math.abs(stocks - stocksShare(input.level)) > DRIFT_STOCKS_BAND;

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
    if ((over > band || stocksPast) && over >= L.minTradeCents) {
      const ticker = sellTicker(c);
      const amount = Math.min(over, held(ticker));
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
    const ticker = buyTicker(c);
    if (amount < L.minTradeCents || !ticker) continue;
    track({
      ticker,
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

// Sales first, so their cash pays for the buys. The live autopilot and the rule replay both
// place a plan in this order.
export function sellsFirst<T extends { side: "buy" | "sell" }>(plan: readonly T[]): T[] {
  return [...plan].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
}

// Whether the monthly practice money goes in today: once a calendar month, on or after the
// chosen day of the month, and never when there is none.
export function monthlyDue(input: {
  monthlyAddCents: number;
  addDay: number;
  // YYYY-MM-DD.
  today: string;
  addedThisMonth: boolean;
}): boolean {
  if (input.monthlyAddCents <= 0 || input.addedThisMonth) return false;
  return Number(input.today.slice(8, 10)) >= input.addDay;
}
