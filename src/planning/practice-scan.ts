import type { RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  classOf,
  classTickers,
  MODEL_PORTFOLIOS,
  OPPORTUNITY_LEVELS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  type PracticeClass,
} from "@/config/portfolios";
import {
  DIP_LOOKBACK_DAYS,
  DIP_MAX_OVER_TARGET,
  DIP_MIN_DROP,
  DRIFT_STOCKS_BAND,
  HARVEST_MIN_LOSS_SHARE,
  NEWS_BAD,
  NEWS_GOOD,
  NEWS_LOOKBACK_DAYS,
  OPPORTUNITY_MAX_SHARE,
  SCAN_CAPS,
  SCAN_CONFIDENCE,
  SCAN_KINDS,
  type ScanKind,
} from "@/config/practice-scan";
import { HARVEST_MIN_LOSS_CENTS } from "@/config/tax";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { WorthKind } from "@/detectors/contract";
import type { Bar, Headline } from "@/lib/market/types";
import { lotsFor, unrealised, washReplacements, type InvTransaction } from "./investment-taxes";
import { portfolioValue, positionValue, type Prices } from "./practice-autopilot";
import type { LedgerState } from "./practice-ledger";

// The daily scan of a practice portfolio (spec step 292, Phase AW, Stage A). Pure: from what the
// ledger holds, the market data and the trades so far, four kinds of flag, each with what Jane
// does about it in the practice ledger, the numbers, the caps it was held to and how sure she is:
// - drift_rebalance: the mix has drifted past the band (the autopilot's rebalance does it);
// - dip_buy: a model holding has dropped, bought only with cash waiting to be invested and never
//   past its target plus a margin;
// - tax_loss_harvest: a model holding below what it cost, swapped into a similar fund of the
//   same kind (step 124's lots), never into a wash sale; watched every day, so a loss that
//   deepens after a swap can be harvested again (the wash-sale checks and the monthly cap hold);
// - news_idea: good news about a watched company, a small capped position, at High and Very
//   high only and not while opportunities are paused.
// Every number comes from src/config. Practice money only: nothing here is a real order.
// The kinds added after step 292 are in ./practice-opportunities.ts, which runs this first.

export type ScanTrade = {
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  reason: string;
  rule: ScanKind;
};

export type ScanFlag = {
  kind: ScanKind;
  // The holding it is about.
  ticker: string;
  // Stops the same event being acted on twice (one per ticker a month, or one headline).
  key: string;
  // What, how much: a few words with one number.
  headline: string;
  // Why, in a sentence with the person's own numbers.
  reason: string;
  amountCents: number;
  // What Jane does in the practice ledger; empty for drift (the autopilot rebalances).
  trades: ScanTrade[];
  figures: { label: string; value: string }[];
  caps: string[];
  confidence: { percent: number; reason: string };
  // The flag as a suggestion asks it (suggest-only mode, or a kind that only suggests), in the
  // detector contract's short forms: a headline that starts with a verb and carries the worth
  // in whole dollars, one line with the person's own number, and the worth that ranks it.
  ask: { headline: string; short: string; worthCents: number; worthKind: WorthKind };
};

// Whole dollars, as a suggestion's headline carries them.
export const wholeDollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// A practice trade, as the scan reads it from the ledger's log.
export type PastTrade = {
  placedAt: string;
  side: string;
  ticker: string | null;
  quantity: number | null;
  amountCents: number;
  gainCents: number | null;
  rule: string;
};

// A headline with step 293's one-sentence summary (Claude's when a key is set, else the rules
// summary), when there is one.
export type ScanHeadline = Headline & { summary?: string; summaryBy?: "claude" | "rules" };

export type ScanInput = {
  level: RiskLevel;
  state: LedgerState;
  // Today's closes, cents per share.
  prices: Prices;
  // Recent daily closes per model ETF, oldest first, ending today.
  history: Readonly<Record<string, readonly Bar[]>>;
  // The standing trades, any order.
  trades: readonly PastTrade[];
  // Headlines about the watched companies from the last few days.
  headlines: readonly ScanHeadline[];
  today: string;
  opportunitiesPaused: boolean;
  // How many of each kind already acted this calendar month.
  usedThisMonth: Readonly<Partial<Record<ScanKind, number>>>;
  // Keys already acted on.
  seen: ReadonlySet<string>;
  // From the person's preferences (src/planning/practice-profile.ts); without them, the level's
  // model and the usual caps. Caps here are already held to the hard caps.
  weights?: Readonly<Record<PracticeClass, number>>;
  caps?: Readonly<Record<ScanKind, { sizeShare: number; positionShare: number; perMonth: number }>>;
  opportunityMaxShare?: number;
  // Tickers never bought.
  avoid?: readonly string[];
  // Cash always kept: dips and ideas only spend the cash above it.
  cashBufferCents?: number;
};

const weightsOf = (input: Pick<ScanInput, "level" | "weights">) =>
  input.weights ?? MODEL_PORTFOLIOS[input.level].weights;
const capsOf = (input: ScanInput, kind: ScanKind) => (input.caps ?? SCAN_CAPS)[kind];

const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toString()}%`;
const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const LABEL: Record<PracticeClass, string> = {
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
  bonds: "bonds",
  cash: "short-term bills",
};

export const classValue = (state: LedgerState, prices: Prices, c: PracticeClass) =>
  classTickers(c).reduce((s, t) => s + positionValue(state, prices, t), 0);

// Each kind's share of the model's value (cash waiting and the model ETFs; opportunity stocks
// sit outside it), and the stocks' share, against the level's targets.
export function drift(
  level: RiskLevel,
  state: LedgerState,
  prices: Prices,
  weights: Readonly<Record<PracticeClass, number>> = MODEL_PORTFOLIOS[level].weights,
) {
  const targetStocks = weights.us_stocks + weights.intl_stocks;
  const values = {} as Record<PracticeClass, number>;
  for (const c of CLASSES) values[c] = classValue(state, prices, c);
  const total = state.cashCents + CLASSES.reduce((s, c) => s + values[c], 0);
  const shares = {} as Record<PracticeClass, number>;
  for (const c of CLASSES) shares[c] = total > 0 ? values[c] / total : 0;
  const off = (c: PracticeClass) => Math.abs(shares[c] - weights[c]);
  const stocks = shares.us_stocks + shares.intl_stocks;
  const worst = CLASSES.reduce((w, c) => (off(c) > off(w) ? c : w));
  const invested = CLASSES.some((c) => values[c] > 0);
  return {
    total,
    shares,
    stocks,
    worst,
    // Off past the band: any one kind past the autopilot's band, or the stocks together past
    // the stocks band. Never before the model is bought.
    past:
      invested &&
      (off(worst) > AUTOPILOT_LIMITS.rebalanceBand ||
        Math.abs(stocks - targetStocks) > DRIFT_STOCKS_BAND),
  };
}

// Tickers sold at a loss within the wash-sale window: buying one back now would be a wash sale.
export function washBlocked(
  trades: readonly Pick<PastTrade, "placedAt" | "side" | "ticker" | "gainCents">[],
  today: string,
): Set<string> {
  const from = daysBefore(today, WASH_SALE_DAYS);
  const blocked = new Set<string>();
  for (const t of trades) {
    const day = t.placedAt.slice(0, 10);
    if (t.side === "sell" && t.ticker && (t.gainCents ?? 0) < 0 && day >= from && day <= today) {
      blocked.add(t.ticker);
    }
  }
  return blocked;
}

// The practice trades as step 124 reads investment transactions (Plaid's signs).
function asTransactions(trades: readonly PastTrade[], ticker: string): InvTransaction[] {
  return trades
    .filter((t) => t.ticker === ticker && (t.side === "buy" || t.side === "sell"))
    .map((t) => ({
      accountId: "practice",
      securityId: ticker,
      date: t.placedAt.slice(0, 10),
      type: t.side,
      subtype: t.side,
      quantity: t.side === "buy" ? (t.quantity ?? 0) : -(t.quantity ?? 0),
      amountCents: t.side === "buy" ? t.amountCents : -t.amountCents,
    }));
}

function driftFlag(input: ScanInput): ScanFlag | null {
  const weights = weightsOf(input);
  const d = drift(input.level, input.state, input.prices, weights);
  if (!d.past) return null;
  const target = weights.us_stocks + weights.intl_stocks;
  const moved = Math.round(
    CLASSES.reduce((s, c) => s + Math.max(0, d.shares[c] - weights[c]), 0) * d.total,
  );
  // Less than a trade's worth: the autopilot moves nothing, so there's nothing to say.
  if (moved < AUTOPILOT_LIMITS.minTradeCents) return null;
  return {
    kind: "drift_rebalance",
    ticker: PRACTICE_ETFS[d.worst].ticker,
    key: `drift_rebalance:${input.today}`,
    headline: `Rebalance about ${dollars(moved)} back to your mix`,
    reason: `Stocks are ${pct(d.stocks)} of the portfolio against ${pct(target)} for your level, and ${LABEL[d.worst]} ${pct(d.shares[d.worst])} against ${pct(weights[d.worst])}, so the autopilot moves it back.`,
    amountCents: moved,
    trades: [],
    figures: [
      { label: "Stocks now", value: pct(d.stocks) },
      { label: "Stocks target", value: pct(target) },
      ...CLASSES.map((c) => ({
        label: `${LABEL[c][0].toUpperCase()}${LABEL[c].slice(1)}`,
        value: `${pct(d.shares[c])} (target ${pct(weights[c])})`,
      })),
    ],
    caps: [
      `Rebalanced past ${pct(AUTOPILOT_LIMITS.rebalanceBand)} off for one kind, or ${pct(DRIFT_STOCKS_BAND)} for stocks together`,
      `No trade over ${pct(AUTOPILOT_LIMITS.perTradeShare)} of the portfolio`,
      `At most ${AUTOPILOT_LIMITS.tradesPerDay} trades a day`,
    ],
    confidence: SCAN_CONFIDENCE.drift_rebalance,
    ask: {
      headline: `Rebalance ${wholeDollars(moved)} back to your mix`,
      short: `Stocks are ${pct(d.stocks)} of your practice portfolio; your level aims for ${pct(target)}.`,
      worthCents: moved,
      worthKind: "risk",
    },
  };
}

type Dip = { c: PracticeClass; ticker: string; high: number; close: number; drop: number };

// The fund of a kind with the most in it, or null when the kind isn't held.
function largestHeld(input: ScanInput, c: PracticeClass): string | null {
  let best: string | null = null;
  let most = 0;
  for (const t of classTickers(c)) {
    const v = positionValue(input.state, input.prices, t);
    if (v > most) [best, most] = [t, v];
  }
  return best;
}

// `blocked`: sold at a loss lately, or swapped out today (a wash sale either way).
function dipFlags(input: ScanInput, total: number, blocked: ReadonlySet<string>): ScanFlag[] {
  const caps = capsOf(input, "dip_buy");
  const weights = weightsOf(input);
  const month = input.today.slice(0, 7);
  let cash = Math.max(0, input.state.cashCents - (input.cashBufferCents ?? 0));
  const found: Dip[] = [];
  for (const c of CLASSES) {
    if (c === "cash" || weights[c] === 0) continue;
    // The fund of this kind held now (the larger one, after a swap).
    const ticker = largestHeld(input, c);
    const bars = ticker ? (input.history[ticker] ?? []) : [];
    const today = bars.at(-1);
    const before = bars.slice(-1 - DIP_LOOKBACK_DAYS, -1);
    if (!ticker || !today || today.date !== input.today || before.length === 0) continue;
    const high = Math.max(...before.map((b) => b.closeCents));
    const drop = 1 - today.closeCents / high;
    if (drop >= DIP_MIN_DROP) found.push({ c, ticker, high, close: today.closeCents, drop });
  }
  found.sort((a, b) => b.drop - a.drop);
  const flags: ScanFlag[] = [];
  for (const x of found) {
    // Into the fund held, or its partner when that one is at a loss or was just sold at one
    // (buying it would make a wash sale of the loss).
    const open = [x.ticker, ...classTickers(x.c)].filter((t) => !blocked.has(t));
    const atLoss = (t: string) => {
      const p = input.state.positions[t];
      return p !== undefined && positionValue(input.state, input.prices, t) < p.costBasisCents;
    };
    const buy = open.find((t) => !atLoss(t)) ?? open[0];
    if (!buy) continue;
    const held = classValue(input.state, input.prices, x.c);
    const room = Math.round((weights[x.c] + DIP_MAX_OVER_TARGET) * total) - held;
    const positionRoom =
      Math.round(caps.positionShare * total) - positionValue(input.state, input.prices, buy);
    const amount = Math.floor(
      Math.min(cash, Math.round(caps.sizeShare * total), room, positionRoom),
    );
    if (amount < AUTOPILOT_LIMITS.minTradeCents) continue;
    cash -= amount;
    const into = buy === x.ticker ? "it" : `${buy}, a similar fund (no wash sale)`;
    const reason = `${x.ticker} is ${pct(x.drop)} below its high of the last ${DIP_LOOKBACK_DAYS} trading days and already in your plan, so ${dollars(amount)} of the cash waiting to be invested went into ${into}.`;
    flags.push({
      kind: "dip_buy",
      ticker: x.ticker,
      key: `dip_buy:${x.ticker}:${month}`,
      headline:
        buy === x.ticker
          ? `Bought ${dollars(amount)} of ${x.ticker} on a ${pct(x.drop)} dip`
          : `Bought ${dollars(amount)} of ${buy} on the ${x.ticker} dip`,
      reason,
      amountCents: amount,
      trades: [{ ticker: buy, side: "buy", amountCents: amount, rule: "dip_buy", reason }],
      figures: [
        { label: `${x.ticker} today`, value: dollars(x.close) },
        { label: `High of the last ${DIP_LOOKBACK_DAYS} trading days`, value: dollars(x.high) },
        { label: "Drop", value: pct(x.drop) },
        { label: "Cash waiting before", value: dollars(cash + amount) },
        { label: `${LABEL[x.c]} target`, value: pct(weights[x.c]) },
      ],
      caps: [
        `A dip counts from ${pct(DIP_MIN_DROP)} down`,
        `Only cash waiting to be invested; never past ${pct(DIP_MAX_OVER_TARGET)} over the target`,
        `At most ${pct(caps.sizeShare)} of the portfolio`,
        `At most ${caps.perMonth} dip buys a month`,
      ],
      confidence: SCAN_CONFIDENCE.dip_buy,
      ask: {
        headline:
          buy === x.ticker
            ? `Buy ${wholeDollars(amount)} of ${x.ticker} on its dip, in practice`
            : `Buy ${wholeDollars(amount)} ${buy} on the ${x.ticker} dip, in practice`,
        short: `${x.ticker} is ${pct(x.drop)} below its recent high, and ${dollars(cash + amount)} is waiting to be invested.`,
        worthCents: amount,
        worthKind: "risk",
      },
    });
  }
  return flags;
}

function harvestFlags(input: ScanInput, total: number, blocked: ReadonlySet<string>): ScanFlag[] {
  const caps = capsOf(input, "tax_loss_harvest");
  const flags: ScanFlag[] = [];
  for (const [ticker, position] of Object.entries(input.state.positions)) {
    const c = classOf(ticker);
    if (!c) continue;
    const swap = classTickers(c).find((t) => t !== ticker && !blocked.has(t));
    if (!swap) continue;
    const valueCents = positionValue(input.state, input.prices, ticker);
    const cost = position.costBasisCents;
    const loss = cost - valueCents;
    if (loss < Math.max(HARVEST_MIN_LOSS_CENTS, HARVEST_MIN_LOSS_SHARE * cost)) continue;
    // A buy of the same fund within the window either side makes the loss a wash sale; and the
    // fund swapped into mustn't have been sold at a loss within it either.
    const txns = asTransactions(input.trades, ticker);
    const recentBuys = washReplacements(
      { securityId: ticker, date: input.today, accountId: "practice" },
      txns,
    );
    if (recentBuys.length > 0 || blocked.has(swap)) continue;
    const amount = Math.min(valueCents, Math.round(caps.sizeShare * total));
    if (amount < AUTOPILOT_LIMITS.minTradeCents) continue;
    const harvested = Math.round((loss * amount) / valueCents);
    // Step 124's lots: how much of the loss is short-term.
    const { left } = lotsFor(position.quantity, txns);
    const split = unrealised(
      {
        accountId: "practice",
        securityId: ticker,
        ticker,
        name: ticker,
        type: null,
        quantity: position.quantity,
        valueCents,
        costBasisCents: position.costBasisCents,
      },
      left,
      input.today,
    );
    const reason = `${ticker} is worth ${dollars(valueCents)} against ${dollars(position.costBasisCents)} paid, so ${dollars(amount)} of it was swapped into ${swap}, a similar fund of the same kind: the mix stays the same and the ${dollars(harvested)} loss counts.`;
    flags.push({
      kind: "tax_loss_harvest",
      ticker,
      key: `tax_loss_harvest:${ticker}:${input.today}`,
      headline: `Harvested a ${dollars(harvested)} loss in ${ticker}`,
      reason,
      amountCents: amount,
      trades: [
        { ticker, side: "sell", amountCents: amount, rule: "tax_loss_harvest", reason },
        { ticker: swap, side: "buy", amountCents: amount, rule: "tax_loss_harvest", reason },
      ],
      figures: [
        { label: "Worth now", value: dollars(valueCents) },
        { label: "Paid", value: dollars(position.costBasisCents) },
        { label: "Loss", value: dollars(loss) },
        { label: "Short-term part", value: dollars(-(split?.shortTermCents ?? -loss)) },
        { label: "Swapped into", value: swap },
      ],
      caps: [
        `A loss of at least ${pct(HARVEST_MIN_LOSS_SHARE)} and ${dollars(HARVEST_MIN_LOSS_CENTS)}`,
        `No buy of ${ticker} in the ${WASH_SALE_DAYS} days before, and ${ticker} isn't bought back for ${WASH_SALE_DAYS} days (no wash sale)`,
        `At most ${pct(caps.sizeShare)} of the portfolio`,
        `At most ${caps.perMonth} swaps a month`,
      ],
      confidence: SCAN_CONFIDENCE.tax_loss_harvest,
      ask: {
        headline: `Harvest a ${wholeDollars(harvested)} loss in ${ticker}, in practice`,
        short: `${ticker} is worth ${dollars(valueCents)} against ${dollars(position.costBasisCents)} paid; ${swap} keeps the same mix.`,
        worthCents: harvested,
        worthKind: "risk",
      },
    });
  }
  return flags;
}

function newsFlags(input: ScanInput, total: number, blocked: ReadonlySet<string>): ScanFlag[] {
  if (!OPPORTUNITY_LEVELS.includes(input.level) || input.opportunitiesPaused) return [];
  const caps = capsOf(input, "news_idea");
  const maxShare = input.opportunityMaxShare ?? OPPORTUNITY_MAX_SHARE;
  const from = daysBefore(input.today, NEWS_LOOKBACK_DAYS);
  const stocks = PRACTICE_STOCKS as readonly string[];
  let held = stocks.reduce((s, t) => s + positionValue(input.state, input.prices, t), 0);
  let cash = Math.max(0, input.state.cashCents - (input.cashBufferCents ?? 0));
  // When cash waiting runs out, a fund pays for an idea: the short-term bills first, then the
  // US stocks fund (an idea is a US company). Never one at a loss: that sale would need its own
  // wash-sale check.
  const funds = [...classTickers("cash"), ...classTickers("us_stocks")]
    .filter((t) => input.state.positions[t] && !blocked.has(t))
    .map((t) => ({ ticker: t, value: positionValue(input.state, input.prices, t) }))
    .filter((f) => f.value >= input.state.positions[f.ticker].costBasisCents);
  const flags: ScanFlag[] = [];
  const done = new Set<string>();
  for (const h of input.headlines) {
    if (!h.ticker || !stocks.includes(h.ticker) || done.has(h.ticker)) continue;
    if (blocked.has(h.ticker)) continue;
    if (h.date < from || h.date > input.today) continue;
    if (!NEWS_GOOD.test(h.title) || NEWS_BAD.test(h.title)) continue;
    // The headline's company and day: a feed's ids can change from one query to the next.
    const key = `news_idea:${h.ticker}:${h.date}`;
    if (input.seen.has(key)) continue;
    const price = input.prices[h.ticker];
    if (!price) continue;
    const own = positionValue(input.state, input.prices, h.ticker);
    const amount = Math.floor(
      Math.min(
        Math.round(caps.sizeShare * total),
        Math.round(caps.positionShare * total) - own,
        Math.round(maxShare * total) - held,
      ),
    );
    if (amount < AUTOPILOT_LIMITS.minTradeCents) continue;
    const fromCash = Math.min(cash, amount);
    const fromFund = amount - fromCash;
    const fund = fromFund > 0 ? funds.find((f) => f.value >= fromFund) : null;
    if (fromFund > 0 && !fund) continue;
    done.add(h.ticker);
    cash -= fromCash;
    if (fund) fund.value -= fromFund;
    held += amount;
    const paid = fund ? ` paid from ${fund.ticker}` : " from cash waiting";
    const reason = `News on ${h.date}: "${h.title}". A small practice position in ${h.ticker}, ${dollars(amount)}${paid}, kept to ${pct(caps.positionShare)} of the portfolio.`;
    const trades: ScanTrade[] = [];
    if (fund) {
      const sale = { ticker: fund.ticker, side: "sell" as const, amountCents: fromFund };
      trades.push({ ...sale, rule: "news_idea", reason });
    }
    trades.push({ ticker: h.ticker, side: "buy", amountCents: amount, rule: "news_idea", reason });
    flags.push({
      kind: "news_idea",
      ticker: h.ticker,
      key,
      headline: `A small ${dollars(amount)} position in ${h.ticker}`,
      reason,
      amountCents: amount,
      trades,
      figures: [
        { label: "Headline", value: h.title },
        ...(h.summary
          ? [{ label: h.summaryBy === "claude" ? "Summary" : "Summary (rules)", value: h.summary }]
          : []),
        { label: "Source", value: `${h.source}, ${h.date}` },
        { label: "Position", value: dollars(own + amount) },
        { label: "All opportunity stocks", value: dollars(held) },
      ],
      caps: [
        `At most ${pct(caps.sizeShare)} of the portfolio at a time`,
        `At most ${pct(caps.positionShare)} in one company`,
        `At most ${pct(maxShare)} in all opportunity stocks`,
        `At most ${caps.perMonth} ideas a month; High and Very high only`,
      ],
      confidence: SCAN_CONFIDENCE.news_idea,
      ask: {
        headline: `Try a small ${wholeDollars(amount)} ${h.ticker} position, in practice`,
        short: `${h.ticker} news on ${h.date}; kept to ${pct(caps.positionShare)} of your practice portfolio.`,
        worthCents: amount,
        worthKind: "risk",
      },
    });
  }
  return flags;
}

export function scanPortfolio(input: ScanInput): ScanFlag[] {
  const total = portfolioValue(input.state, input.prices);
  if (total <= 0) return [];
  // Never bought: sold at a loss lately (a wash sale) or on the person's never-buy list.
  const blocked = new Set([...washBlocked(input.trades, input.today), ...(input.avoid ?? [])]);
  const harvests = harvestFlags(input, total, blocked);
  // What is swapped out today isn't bought back or sold again today.
  const after = new Set([...blocked, ...harvests.map((f) => f.ticker)]);
  const all = [
    driftFlag(input),
    ...harvests,
    ...dipFlags(input, total, after),
    ...newsFlags(input, total, after),
  ].filter((f): f is ScanFlag => f !== null && !input.seen.has(f.key));
  // The monthly count cap for each kind.
  const left = Object.fromEntries(
    SCAN_KINDS.map((k) => [k, capsOf(input, k).perMonth - (input.usedThisMonth[k] ?? 0)]),
  ) as Record<ScanKind, number>;
  return all.filter((f) => (left[f.kind] -= 1) >= 0);
}
