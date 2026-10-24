import {
  AUTOPILOT_LIMITS as HARD,
  classTickers,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  THEME_FUNDS,
  type AutopilotLimits,
  type PracticeClass,
} from "@/config/portfolios";
import type { RiskLevel } from "@/config/investing";
import { DRIFT_STOCKS_BAND, HARVEST_MIN_LOSS_SHARE } from "@/config/practice-scan";
import { HARVEST_MIN_LOSS_CENTS } from "@/config/tax";
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
  // strategy_switch: into the fund of a strategy the person chose. theme_exit: out of a news
  // theme's slice (src/planning/themes.ts).
  rule: "model_buy" | "rebalance" | "cash_buffer" | "strategy_switch" | "theme_exit";
};

export type Prices = Readonly<Record<string, number>>;

const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
// One formatter, made once: the rule replay formats thousands of reasons.
const USD = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (cents: number) => `$${USD.format(cents / 100)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
// One decimal, so a small gap doesn't read as none ("4.8% against 5%", not "5% against 5%").
const pctTenth = (n: number) => `${(Math.round(n * 1000) / 10).toString()}%`;
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

// A person's limits (src/planning/practice-profile.ts) held to the hard ones: a cap can only be
// lowered. The rebalance band is the person's pace.
export function withinHard(limits: AutopilotLimits | undefined): AutopilotLimits {
  if (!limits) return HARD;
  return {
    ...limits,
    minTradeCents: Math.max(HARD.minTradeCents, limits.minTradeCents),
    perTradeShare: Math.min(HARD.perTradeShare, limits.perTradeShare),
    perEtfShare: Math.min(HARD.perEtfShare, limits.perEtfShare),
    perStockShare: Math.min(HARD.perStockShare, limits.perStockShare),
    perThemeShare: Math.min(HARD.perThemeShare, limits.perThemeShare),
    tradesPerDay: Math.min(HARD.tradesPerDay, limits.tradesPerDay),
  };
}

// A loss worth harvesting: at least HARVEST_MIN_LOSS_SHARE of what the holding cost and at least
// HARVEST_MIN_LOSS_CENTS. The scan's harvest and the buys below both ask this.
export function lossToHarvest(state: LedgerState, prices: Prices, ticker: string): boolean {
  const p = state.positions[ticker];
  if (!p) return false;
  const loss = p.costBasisCents - positionValue(state, prices, ticker);
  return loss >= Math.max(HARVEST_MIN_LOSS_CENTS, HARVEST_MIN_LOSS_SHARE * p.costBasisCents);
}

const atLoss = (state: LedgerState, prices: Prices, ticker: string) => {
  const p = state.positions[ticker];
  return p !== undefined && positionValue(state, prices, ticker) < p.costBasisCents;
};

// The fund to buy more of a kind in: the kind's own fund (PRACTICE_ETFS). Its swap partner only
// for the wash-sale window: the own fund was sold at a loss lately (or is on the never-buy
// list), or, when losses are being harvested for the person (`harvesting`), it is held at a
// loss, which a buy now would start the window on (a harvest within 30 days would be a wash
// sale). Never because the partner is the larger holding, and never for someone whose losses
// aren't harvested. A fund the person chose for the kind (a strategy menu tilt, `preferred`)
// comes first when it can be bought. The autopilot and the daily scan both buy with this.
export function buyFundFor(
  c: PracticeClass,
  blocked: ReadonlySet<string>,
  harvesting: { state: LedgerState; prices: Prices } | null = null,
  preferred: string | null = null,
): string | null {
  if (preferred && !blocked.has(preferred)) return preferred;
  const [own, partner] = classTickers(c);
  const keep =
    harvesting !== null &&
    partner !== undefined &&
    !blocked.has(partner) &&
    atLoss(harvesting.state, harvesting.prices, own);
  if (!blocked.has(own) && !keep) return own;
  return [partner, own].find((t) => t !== undefined && !blocked.has(t)) ?? null;
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
  // The person's limits; the hard ones without them.
  limits?: AutopilotLimits,
): string | null {
  const L = withinHard(limits);
  if (tradesToday >= L.tradesPerDay) return `already ${L.tradesPerDay} trades today`;
  const total = totalCents;
  if (trade.side === "buy" && trade.amountCents > state.cashCents) return "would need to borrow";
  if (trade.amountCents > Math.round(total * L.perTradeShare)) return "more than the per-trade cap";
  if (trade.side === "buy") {
    const after = positionValue(state, prices, trade.ticker) + alreadyBought + trade.amountCents;
    const isStock = (PRACTICE_STOCKS as readonly string[]).includes(trade.ticker);
    const isTheme = THEME_FUNDS.includes(trade.ticker);
    const cap = Math.round(
      total * (isStock ? L.perStockShare : isTheme ? L.perThemeShare : L.perEtfShare),
    );
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
  // From the person's preferences (src/planning/practice-profile.ts): the mix (the level's model
  // when absent), tickers never bought, and cash always kept outside the model.
  weights?: Readonly<Record<PracticeClass, number>>;
  avoid?: ReadonlySet<string>;
  cashBufferCents?: number;
  // The person's limits (their rebalance band and cap on one fund); the hard ones without them.
  limits?: AutopilotLimits;
  // Whether losses are being harvested for them (their settings and the level's rules): then a
  // fund holding a loss worth harvesting isn't bought (buyFundFor).
  harvesting?: boolean;
  // The fund the person chose for a kind (a strategy menu tilt, src/config/practice-preferences.ts).
  funds?: Readonly<Partial<Record<PracticeClass, string>>>;
}): PlannedTrade[] {
  if (input.paused) return [];
  const L = withinHard(input.limits);
  const { prices } = input;
  const buffer = Math.max(0, input.cashBufferCents ?? 0);
  // The buffer sits outside the model: the plan sees only the cash above it (less than none
  // when the buffer was raised after the money was invested).
  const state: LedgerState = { ...input.state, cashCents: input.state.cashCents - buffer };
  const avoid = input.avoid ?? new Set<string>();
  // Never bought: sold at a loss lately (a wash sale) or on the person's never-buy list.
  const blocked = new Set([...(input.blocked ?? []), ...avoid]);
  const weights = input.weights ?? MODEL_PORTFOLIOS[input.level].weights;
  const targetStocks = weights.us_stocks + weights.intl_stocks;
  const held = (t: string) => positionValue(state, prices, t);
  const modelValue = (c: PracticeClass) => classTickers(c).reduce((s, t) => s + held(t), 0);
  // The fund a kind is held in (the larger, after a swap), and the one to buy more of.
  const sellTicker = (c: PracticeClass) =>
    classTickers(c).reduce((a, b) => (held(b) > held(a) ? b : a));
  const buyTicker = (c: PracticeClass) =>
    buyFundFor(c, blocked, input.harvesting ? { state, prices } : null, input.funds?.[c] ?? null);
  // The model's value: cash waiting plus the ETFs (opportunity stocks sit outside it).
  const total = state.cashCents + CLASSES.reduce((s, c) => s + modelValue(c), 0);
  if (total <= 0) return [];
  const gap = (c: PracticeClass) => Math.round(weights[c] * total) - modelValue(c);
  const band = Math.round(L.rebalanceBand * total);
  const first = CLASSES.every((c) => modelValue(c) === 0);
  // Stocks together past their band: every kind over its target goes back, not only those past
  // the band on their own.
  const stocks = (modelValue("us_stocks") + modelValue("intl_stocks")) / total;
  const stocksPast = !first && Math.abs(stocks - targetStocks) > DRIFT_STOCKS_BAND;

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
      L,
    );
    if (v) return;
    trades.push(t);
    cash += t.side === "sell" ? t.amountCents : -t.amountCents;
    if (t.side === "buy") bought[t.ticker] = (bought[t.ticker] ?? 0) + t.amountCents;
  };

  // A fund the person chose for a kind (a tilt): what the kind holds in its other funds moves
  // into it, and that kind's other trades wait for the next run.
  const switched = new Set<PracticeClass>();
  for (const c of CLASSES) {
    const to = input.funds?.[c];
    if (!to || blocked.has(to) || first) continue;
    for (const from of classTickers(c)) {
      const amount = held(from);
      if (from === to || amount < L.minTradeCents) continue;
      const reason = `Moved ${dollars(amount)} of ${LABEL[c]} from ${from} to ${to}, the fund of the strategy you chose.`;
      const before = trades.length;
      track({ ticker: from, side: "sell", amountCents: amount, rule: "strategy_switch", reason });
      if (trades.length === before) continue;
      track({ ticker: to, side: "buy", amountCents: amount, rule: "strategy_switch", reason });
      switched.add(c);
    }
  }

  // The cash buffer first: when cash is under it, sell what is most over its target.
  const raised: Partial<Record<PracticeClass, number>> = {};
  if (cash < 0) {
    let short = -cash;
    const order = [...CLASSES].sort((a, b) => gap(a) - gap(b));
    for (const c of order) {
      if (short <= 0) break;
      if (switched.has(c)) continue;
      const ticker = sellTicker(c);
      const amount = Math.min(short, held(ticker));
      if (amount < L.minTradeCents) continue;
      const before = trades.length;
      track({
        ticker,
        side: "sell",
        amountCents: amount,
        rule: "cash_buffer",
        reason: `You asked to keep ${dollars(buffer)} in cash, so ${dollars(amount)} of ${LABEL[c]} was sold to make it up.`,
      });
      if (trades.length > before) {
        short -= amount;
        raised[c] = amount;
      }
    }
  }

  // Rebalance: sell what is over its target by more than the band.
  for (const c of CLASSES) {
    if (switched.has(c)) continue;
    const over = -gap(c) - (raised[c] ?? 0);
    if ((over > band || stocksPast) && over >= L.minTradeCents) {
      const ticker = sellTicker(c);
      const amount = Math.min(over, held(ticker) - (raised[c] ?? 0));
      track({
        ticker,
        side: "sell",
        amountCents: amount,
        rule: "rebalance",
        reason: `${LABEL[c]} had grown to ${pctTenth(modelValue(c) / total)} of the portfolio against a target of ${pctTenth(weights[c])}, so ${dollars(amount)} moved back.`,
      });
    }
  }
  // Buy what is under its target, from cash on hand, in proportion to how far under each is.
  const deficits = CLASSES.filter((c) => !switched.has(c))
    .map((c) => ({ c, d: Math.max(0, gap(c)) }))
    .filter((x) => x.d >= L.minTradeCents);
  const needed = deficits.reduce((s, x) => s + x.d, 0);
  const spend = Math.max(0, Math.min(cash, needed));
  for (const { c, d } of deficits) {
    const ticker = buyTicker(c);
    if (!ticker) continue;
    // Up to the per-position and per-trade caps, not past them (a mix that is mostly one kind,
    // near a goal date).
    const isStock = (PRACTICE_STOCKS as readonly string[]).includes(ticker);
    const room = Math.min(
      Math.round(whole * (isStock ? L.perStockShare : L.perEtfShare)) -
        held(ticker) -
        (bought[ticker] ?? 0),
      Math.round(whole * L.perTradeShare),
    );
    const amount = Math.min(Math.floor((spend * d) / needed), room);
    if (amount < L.minTradeCents) continue;
    track({
      ticker,
      side: "buy",
      amountCents: amount,
      rule: first ? "model_buy" : "rebalance",
      reason: first
        ? `Starting the model for your level: ${pct(weights[c])} in ${LABEL[c]}, ${dollars(amount)} to begin.`
        : `${dollars(amount)} of cash waiting went to ${LABEL[c]}: ${pctTenth(modelValue(c) / total)} of the portfolio against a target of ${pctTenth(weights[c])}.`,
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
