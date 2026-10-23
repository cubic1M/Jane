import type { RiskLevel } from "@/config/investing";
import { RISK_LEVELS } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  classOf,
  classTickers,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_UNIVERSE,
  stocksShare,
  type PracticeClass,
} from "@/config/portfolios";
import {
  CASH_DRAG_MIN_CENTS,
  CASH_DRAG_MIN_DAYS,
  CASH_DRAG_MIN_SHARE,
  CASH_DRAG_RATE,
  CASH_DRAG_RATE_SOURCE,
  CHEAPER_FUND_MIN_BPS,
  DEFAULT_CASH_BUFFER_CENTS,
  DRIFT_WARNING_SHARE,
  GLIDE_PATH,
  MAX_DROP_LOOKBACK_DAYS,
  MAX_DROP_NEAR_SHARE,
  OPPORTUNITY_KINDS,
  PAYDAY_ADD_MAX_DAY,
  PAYDAY_ADD_OFFSET_DAYS,
  PAYDAY_TIMING_MIN_GAP_DAYS,
  PRACTICE_FUND_FEE_BPS,
  PRACTICE_FUND_FEE_SOURCE,
  RISK_MISMATCH_TOLERANCE,
  STRESS_DROP,
  STRESS_DROP_SOURCE,
  type OpportunityKind,
} from "@/config/practice-opportunities";
import { DRIFT_STOCKS_BAND, rulesOnAt, SCAN_CAPS, SCAN_CONFIDENCE } from "@/config/practice-scan";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { PaySchedule } from "@/detection/paydays";
import { portfolioValue, positionValue, type Prices } from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import {
  classValue,
  drift,
  scanPortfolio,
  washBlocked,
  wholeDollars,
  type ScanFlag,
  type ScanInput,
  type ScanTrade,
} from "./practice-scan";

// More kinds of opportunity for the practice portfolio's daily scan (Phase AW, Stage A, after
// step 292). Pure. The step 292 scan runs first; then, from the same ledger, prices and the
// person's preferences:
// - new_money_rebalance: the mix is past (or near) the band and cash is waiting: the cash buys
//   what is short, so the autopilot sells less or nothing;
// - cash_drag: cash waiting above the person's buffer, unbought for days;
// - cheaper_fund: a twin fund of the same kind that costs less a year;
// - payday_timing: the monthly practice money lands well away from the person's payday;
// - drift_warning: the mix is most of the way to the band, before it is hit;
// - glide_path: the goal date is close enough for the next level down;
// - risk_mismatch: the mix could fall further in a crash than the person said they could take;
// - max_drop_near: the portfolio has already fallen most of the way to that limit.
// The last four are safety kinds: they only ever suggest a safer mix or show the numbers, and
// none of them trades. Preferences filter the step 292 kinds too (appetite, exclusions, tax
// sensitivity). Every number comes from src/config. Practice money only: nothing here is a
// real order, and no rule here says where a market goes next.

// What the scan reads from the person's practice settings. Session B1's PracticePreferences
// is the stored form; src/lib/practice/opportunity-prefs.ts maps it to this.
export type ScanPreferences = {
  // The biggest drop they said they could take, as a share (0.25 = 25%); null when not said.
  maxDropShare: number | null;
  // When they need the money (YYYY-MM-DD), or null.
  goalDate: string | null;
  // How many ideas beyond the plan they want: none turns off dips and news, low turns off news.
  appetite: "none" | "low" | "normal" | "high";
  // Tickers never to buy.
  excludedTickers: readonly string[];
  // Whether taxes matter to them: off, no loss harvesting, and a twin fund at a gain is fine.
  taxSensitive: boolean;
  // Cash waiting that is kept, not invested.
  cashBufferCents: number;
  // "suggest": Jane only suggests (no trades); "act": she acts within the caps.
  mode: "suggest" | "act";
};

export const DEFAULT_SCAN_PREFERENCES: ScanPreferences = {
  maxDropShare: null,
  goalDate: null,
  appetite: "normal",
  excludedTickers: [],
  taxSensitive: true,
  cashBufferCents: DEFAULT_CASH_BUFFER_CENTS,
  mode: "act",
};

export type OpportunityInput = ScanInput & {
  prefs: ScanPreferences;
  // The monthly practice money and the day of the month it lands.
  monthlyAddCents: number;
  addDay: number;
  // The day of the month of the person's main payday, or null when Jane doesn't know it.
  paydayDay: number | null;
  // Daily closes for every ticker held (opportunity stocks too), oldest first, ending today;
  // ScanInput.history covers the model funds only.
  heldHistory?: ScanInput["history"];
};

// Kinds that never trade: they suggest, or open the settings.
export const ADVICE_ONLY_KINDS: readonly OpportunityKind[] = [
  "payday_timing",
  "drift_warning",
  "glide_path",
  "risk_mismatch",
  "max_drop_near",
];

const DAY_MS = 86_400_000;
const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const LABEL: Record<PracticeClass, string> = {
  us_stocks: "US stocks",
  intl_stocks: "international stocks",
  bonds: "bonds",
  cash: "short-term bills",
};
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toString()}%`;
const points = (n: number) => (Math.round(n * 1000) / 10).toString();
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const SUFFIX: Readonly<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (SUFFIX[n % 10] ?? "th")}`;
const levelName = (l: RiskLevel) => RISK_LEVELS[l].label;

// How far a mix (shares by kind) could fall in a crash like 2007-09.
export function stressDrop(shares: Readonly<Record<PracticeClass, number>>): number {
  return CLASSES.reduce((s, c) => s + shares[c] * STRESS_DROP[c], 0);
}

// The same for the portfolio as held: every holding by its kind (an opportunity stock counts as
// US stocks), cash waiting at none.
export function heldStressDrop(state: LedgerState, prices: Prices): number {
  const total = portfolioValue(state, prices);
  if (total <= 0) return 0;
  const shares = { us_stocks: 0, intl_stocks: 0, bonds: 0, cash: 0 };
  for (const t of Object.keys(state.positions)) {
    shares[classOf(t) ?? "us_stocks"] += positionValue(state, prices, t) / total;
  }
  return stressDrop(shares);
}

// The highest level whose model could fall no further than `limit`, or 1.
export function levelWithin(limit: number): RiskLevel {
  for (const l of [5, 4, 3, 2] as const) {
    if (stressDrop(MODEL_PORTFOLIOS[l].weights) <= limit) return l;
  }
  return 1;
}

// The highest level for the years left until the goal date.
export function glideMax(yearsLeft: number): RiskLevel {
  return (GLIDE_PATH.find((g) => yearsLeft >= g.minYears) ?? GLIDE_PATH.at(-1)!).maxLevel;
}

// The portfolio as held today, valued on each of the last days every holding has a close, and
// the fall from the highest of them to today.
export function recentDrop(
  state: LedgerState,
  prices: Prices,
  history: ScanInput["history"],
  today: string,
): { peakCents: number; nowCents: number; drop: number; peakDate: string } | null {
  const held = Object.keys(state.positions).filter((t) => state.positions[t].quantity > 0);
  if (held.length === 0) return null;
  const byDay = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const t of held) {
    for (const bar of (history[t] ?? []).slice(-MAX_DROP_LOOKBACK_DAYS - 1)) {
      byDay.set(
        bar.date,
        (byDay.get(bar.date) ?? 0) + state.positions[t].quantity * bar.closeCents,
      );
      counts.set(bar.date, (counts.get(bar.date) ?? 0) + 1);
    }
  }
  const days = [...byDay.keys()].filter((d) => counts.get(d) === held.length && d <= today).sort();
  if (days.length < 2 || days.at(-1) !== today) return null;
  const nowCents = Math.round(state.cashCents + byDay.get(today)!);
  let peakCents = nowCents;
  let peakDate = today;
  for (const d of days) {
    const v = Math.round(state.cashCents + byDay.get(d)!);
    if (v > peakCents) [peakCents, peakDate] = [v, d];
  }
  return { peakCents, nowCents, drop: peakCents > 0 ? 1 - nowCents / peakCents : 0, peakDate };
}

// The fund to buy more of a kind in: the one held (the larger), else the main one; never one
// blocked (a wash sale, or excluded) and, when there's a choice, not one at a loss.
function buyTickerFor(
  c: PracticeClass,
  state: LedgerState,
  prices: Prices,
  blocked: ReadonlySet<string>,
): string | null {
  const held = (t: string) => positionValue(state, prices, t);
  const main = classTickers(c).reduce((a, b) => (held(b) > held(a) ? b : a));
  const open = [main, ...classTickers(c)].filter((t) => !blocked.has(t));
  const atLoss = (t: string) => {
    const p = state.positions[t];
    return p !== undefined && held(t) < p.costBasisCents;
  };
  return open.find((t) => !atLoss(t)) ?? open[0] ?? null;
}

// Cash spread over the kinds that are short of their targets, in proportion to how short,
// held to the size cap and each fund's per-position cap. The caller writes the reason.
function buyShort(
  input: OpportunityInput,
  kind: OpportunityKind,
  available: number,
  blocked: ReadonlySet<string>,
): ScanTrade[] {
  const total = portfolioValue(input.state, input.prices);
  const d = drift(input.level, input.state, input.prices);
  const weights = MODEL_PORTFOLIOS[input.level].weights;
  const short = CLASSES.map((c) => ({
    c,
    gap: Math.round(weights[c] * d.total) - classValue(input.state, input.prices, c),
  })).filter((x) => x.gap >= AUTOPILOT_LIMITS.minTradeCents);
  const needed = short.reduce((s, x) => s + x.gap, 0);
  const caps = SCAN_CAPS[kind];
  const spend = Math.min(available, needed, Math.round(caps.sizeShare * total));
  if (needed <= 0 || spend < AUTOPILOT_LIMITS.minTradeCents) return [];
  const trades: ScanTrade[] = [];
  for (const { c, gap } of short) {
    const ticker = buyTickerFor(c, input.state, input.prices, blocked);
    if (!ticker) continue;
    const room =
      Math.round(caps.positionShare * total) - positionValue(input.state, input.prices, ticker);
    const amount = Math.min(Math.floor((spend * gap) / needed), room);
    if (amount < AUTOPILOT_LIMITS.minTradeCents) continue;
    trades.push({ ticker, side: "buy", amountCents: amount, rule: kind, reason: "" });
  }
  return trades;
}

function sharesFigures(level: RiskLevel, shares: Record<PracticeClass, number>) {
  const weights = MODEL_PORTFOLIOS[level].weights;
  return CLASSES.map((c) => ({
    label: cap(LABEL[c]),
    value: `${pct(shares[c])} (target ${pct(weights[c])})`,
  }));
}

// How near the band the mix is: the furthest-off kind, or stocks together, as a share of the
// way to its band (1 = at the band).
function nearness(input: OpportunityInput) {
  const d = drift(input.level, input.state, input.prices);
  const weights = MODEL_PORTFOLIOS[input.level].weights;
  const kindOff = Math.abs(d.shares[d.worst] - weights[d.worst]);
  const stocksOff = Math.abs(d.stocks - stocksShare(input.level));
  const kindRatio = kindOff / AUTOPILOT_LIMITS.rebalanceBand;
  const stocksRatio = stocksOff / DRIFT_STOCKS_BAND;
  const invested = CLASSES.some((c) => classValue(input.state, input.prices, c) > 0);
  return stocksRatio >= kindRatio
    ? { d, invested, ratio: stocksRatio, what: "stocks", off: stocksOff, band: DRIFT_STOCKS_BAND }
    : {
        d,
        invested,
        ratio: kindRatio,
        what: LABEL[d.worst],
        off: kindOff,
        band: AUTOPILOT_LIMITS.rebalanceBand,
      };
}

function newMoneyFlag(
  input: OpportunityInput,
  available: number,
  blocked: ReadonlySet<string>,
): ScanFlag | null {
  const n = nearness(input);
  if (!n.invested || (!n.d.past && n.ratio < DRIFT_WARNING_SHARE)) return null;
  const weights = MODEL_PORTFOLIOS[input.level].weights;
  // What the autopilot would sell today: every kind over its target past the band (all of
  // them when stocks together are past theirs).
  const stocksPast = Math.abs(n.d.stocks - stocksShare(input.level)) > DRIFT_STOCKS_BAND;
  const wouldSell = CLASSES.reduce((s, c) => {
    const over = n.d.shares[c] - weights[c];
    return over > AUTOPILOT_LIMITS.rebalanceBand || (stocksPast && over > 0)
      ? s + Math.round(over * n.d.total)
      : s;
  }, 0);
  const trades = buyShort(input, "new_money_rebalance", available, blocked);
  const spent = trades.reduce((s, t) => s + t.amountCents, 0);
  if (spent === 0) return null;
  let after = input.state;
  for (const t of trades) {
    after = apply(after, { ...t, priceCents: input.prices[t.ticker] }, PRACTICE_UNIVERSE).state;
  }
  const d2 = drift(input.level, after, input.prices);
  const stillOver = CLASSES.reduce((s, c) => {
    const over = d2.shares[c] - weights[c];
    return d2.past && over > 0 ? s + Math.round(over * d2.total) : s;
  }, 0);
  const sale =
    wouldSell > 0
      ? stillOver > 0
        ? ` The autopilot would have sold about ${dollars(wouldSell)}; now about ${dollars(stillOver)}.`
        : ` The autopilot would have sold about ${dollars(wouldSell)}; now nothing needs selling.`
      : " Nothing needs selling.";
  const reason = `Your mix is ${points(n.off)} points off on ${n.what} (the band is ${points(n.band)}), and ${dollars(available)} of cash was waiting, so ${dollars(spent)} of it went where the mix is short.${sale}`;
  return {
    kind: "new_money_rebalance",
    ticker: trades[0].ticker,
    key: `new_money_rebalance:${input.today}`,
    headline: `Rebalance with ${dollars(spent)} of new money, no sale`,
    reason,
    amountCents: spent,
    trades: trades.map((t) => ({ ...t, reason })),
    figures: [
      ...sharesFigures(input.level, n.d.shares),
      { label: "Cash waiting", value: dollars(available) },
      { label: "Sale avoided", value: dollars(Math.max(0, wouldSell - stillOver)) },
    ],
    caps: [
      `Only cash waiting above your buffer of ${dollars(input.prefs.cashBufferCents)}`,
      `At most ${pct(SCAN_CAPS.new_money_rebalance.sizeShare)} of the portfolio`,
      `No fund over ${pct(SCAN_CAPS.new_money_rebalance.positionShare)} of the portfolio`,
      `At most ${SCAN_CAPS.new_money_rebalance.perMonth} a month`,
    ],
    confidence: SCAN_CONFIDENCE.new_money_rebalance,
    ask: {
      headline: `Rebalance with ${wholeDollars(spent)} of new money, no sale`,
      short: `Your mix is ${points(n.off)} points off on ${n.what}, and ${dollars(available)} of practice cash is waiting.`,
      worthCents: spent,
      worthKind: "risk",
    },
  };
}

function cashDragFlag(
  input: OpportunityInput,
  available: number,
  blocked: ReadonlySet<string>,
): ScanFlag | null {
  const total = portfolioValue(input.state, input.prices);
  if (available < Math.max(CASH_DRAG_MIN_CENTS, Math.round(CASH_DRAG_MIN_SHARE * total))) {
    return null;
  }
  // Only once the cash has sat: no buy in the last few days, and the model already bought.
  const buys = input.trades.filter((t) => t.side === "buy").map((t) => t.placedAt.slice(0, 10));
  const lastBuy = buys.sort().at(-1);
  if (!lastBuy || daysBetween(lastBuy, input.today) < CASH_DRAG_MIN_DAYS) return null;
  const trades = buyShort(input, "cash_drag", available, blocked);
  const spent = trades.reduce((s, t) => s + t.amountCents, 0);
  if (spent === 0) return null;
  const yearly = Math.round(available * CASH_DRAG_RATE);
  const reason = `${dollars(available)} of cash has waited ${daysBetween(lastBuy, input.today)} days above your buffer; it earns nothing in the ledger. ${dollars(spent)} of it buys your level's own mix where it's short.`;
  const week = Math.ceil(Number(input.today.slice(8, 10)) / 7);
  return {
    kind: "cash_drag",
    ticker: trades[0].ticker,
    key: `cash_drag:${input.today.slice(0, 7)}:w${week}`,
    headline: `Invest ${dollars(spent)} of idle cash`,
    reason,
    amountCents: spent,
    trades: trades.map((t) => ({ ...t, reason })),
    figures: [
      { label: "Cash waiting", value: dollars(input.state.cashCents) },
      { label: "Your buffer", value: dollars(input.prefs.cashBufferCents) },
      { label: "Days since the last buy", value: String(daysBetween(lastBuy, input.today)) },
      {
        label: `What it would earn a year at the bill yield (${pct(CASH_DRAG_RATE)})`,
        value: dollars(yearly),
      },
      { label: "Yield from", value: CASH_DRAG_RATE_SOURCE },
    ],
    caps: [
      `Cash above your buffer only, at least ${dollars(CASH_DRAG_MIN_CENTS)} and ${pct(CASH_DRAG_MIN_SHARE)} of the portfolio`,
      `Waiting at least ${CASH_DRAG_MIN_DAYS} days`,
      `At most ${pct(SCAN_CAPS.cash_drag.sizeShare)} of the portfolio, into your level's mix only`,
      `At most ${SCAN_CAPS.cash_drag.perMonth} a month`,
    ],
    confidence: SCAN_CONFIDENCE.cash_drag,
    ask: {
      headline: `Invest idle practice cash, about ${wholeDollars(yearly)} a year more`,
      short: `${dollars(available)} has waited ${daysBetween(lastBuy, input.today)} days above your buffer, earning nothing.`,
      worthCents: yearly,
      worthKind: "earns",
    },
  };
}

function cheaperFundFlags(
  input: OpportunityInput,
  blocked: ReadonlySet<string>,
  touched: ReadonlySet<string>,
): ScanFlag[] {
  const total = portfolioValue(input.state, input.prices);
  const caps = SCAN_CAPS.cheaper_fund;
  const flags: ScanFlag[] = [];
  for (const [ticker, position] of Object.entries(input.state.positions)) {
    const c = classOf(ticker);
    const fee = PRACTICE_FUND_FEE_BPS[ticker];
    if (!c || fee === undefined || touched.has(ticker)) continue;
    const twin = classTickers(c)
      .filter((t) => t !== ticker && !blocked.has(t) && PRACTICE_FUND_FEE_BPS[t] !== undefined)
      .sort((a, b) => PRACTICE_FUND_FEE_BPS[a] - PRACTICE_FUND_FEE_BPS[b])[0];
    if (!twin || fee - PRACTICE_FUND_FEE_BPS[twin] < CHEAPER_FUND_MIN_BPS) continue;
    const valueCents = positionValue(input.state, input.prices, ticker);
    const gain = valueCents - position.costBasisCents;
    // A sale at a gain is taxed (when taxes matter to them); one at a loss right after a buy of
    // the same fund is a wash sale.
    if (gain > 0 && input.prefs.taxSensitive) continue;
    const from = new Date(Date.parse(`${input.today}T00:00:00Z`) - WASH_SALE_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const boughtLately = input.trades.some(
      (t) => t.ticker === ticker && t.side === "buy" && t.placedAt.slice(0, 10) >= from,
    );
    if (gain < 0 && boughtLately) continue;
    const room =
      Math.round(caps.positionShare * total) - positionValue(input.state, input.prices, twin);
    const amount = Math.min(valueCents, Math.round(caps.sizeShare * total), room);
    if (amount < AUTOPILOT_LIMITS.minTradeCents) continue;
    const savedBps = fee - PRACTICE_FUND_FEE_BPS[twin];
    const yearly = Math.round((amount * savedBps) / 10_000);
    const reason = `${ticker} costs ${pct(fee / 10_000)} a year and ${twin}, a fund of the same kind, ${pct(PRACTICE_FUND_FEE_BPS[twin] / 10_000)}, so ${dollars(amount)} moves across: the mix stays the same and the yearly cost falls by about ${dollars(yearly)}.`;
    flags.push({
      kind: "cheaper_fund",
      ticker,
      key: `cheaper_fund:${ticker}:${input.today.slice(0, 7)}`,
      headline: `Switch ${dollars(amount)} to ${twin}, a cheaper twin`,
      reason,
      amountCents: amount,
      trades: [
        { ticker, side: "sell", amountCents: amount, rule: "cheaper_fund", reason },
        { ticker: twin, side: "buy", amountCents: amount, rule: "cheaper_fund", reason },
      ],
      figures: [
        { label: `${ticker} a year`, value: pct(fee / 10_000) },
        { label: `${twin} a year`, value: pct(PRACTICE_FUND_FEE_BPS[twin] / 10_000) },
        { label: "Saved a year", value: dollars(yearly) },
        { label: "Gain or loss on the sale", value: dollars(gain) },
        { label: "Costs from", value: PRACTICE_FUND_FEE_SOURCE },
      ],
      caps: [
        `Only a fund of the same kind at least ${pct(CHEAPER_FUND_MIN_BPS / 10_000)} a year cheaper`,
        input.prefs.taxSensitive
          ? "Never a sale at a gain (taxes matter to you)"
          : "A sale at a gain is allowed (you said taxes don't matter here)",
        `No sale at a loss within ${WASH_SALE_DAYS} days of a buy (no wash sale)`,
        `At most ${pct(caps.sizeShare)} of the portfolio, ${caps.perMonth} switches a month`,
      ],
      confidence: SCAN_CONFIDENCE.cheaper_fund,
      ask: {
        headline:
          yearly >= 50
            ? `Switch ${ticker} to ${twin}, save ${wholeDollars(yearly)} a year`
            : `Switch ${ticker} to ${twin}, a cheaper twin fund`,
        short: `${ticker} costs ${pct(fee / 10_000)} a year and ${twin} ${pct(PRACTICE_FUND_FEE_BPS[twin] / 10_000)}, on ${dollars(amount)} of practice money.`,
        worthCents: yearly,
        worthKind: "saves",
      },
    });
  }
  return flags;
}

// The day of the month the person's main pay comes (the biggest active paycheck that comes on
// set days of the month: monthly, or the first of twice a month), or null. Paid every week or
// two, any day is close to a payday, so there's nothing to move.
export function mainPaydayDay(
  schedules: readonly Pick<PaySchedule, "active" | "frequency" | "days" | "amountCents">[],
): number | null {
  const main = schedules
    .filter((s) => s.active && s.days.length > 0)
    .filter((s) => s.frequency === "MONTHLY" || s.frequency === "SEMI_MONTHLY")
    .sort((a, b) => b.amountCents - a.amountCents)[0];
  return main ? Math.min(...main.days) : null;
}

// The day of the month the practice money should land, after payday.
export function addDayAfter(paydayDay: number): number {
  const day = paydayDay + PAYDAY_ADD_OFFSET_DAYS;
  return day > PAYDAY_ADD_MAX_DAY ? 1 : day;
}

function paydayFlag(input: OpportunityInput): ScanFlag | null {
  if (input.monthlyAddCents <= 0 || input.paydayDay === null) return null;
  const target = addDayAfter(input.paydayDay);
  const apart = Math.abs(target - input.addDay);
  const gap = Math.min(apart, 30 - apart);
  if (gap < PAYDAY_TIMING_MIN_GAP_DAYS) return null;
  const reason = `You're paid around the ${ordinal(input.paydayDay)}, and your ${dollars(input.monthlyAddCents)} of monthly practice money lands on the ${ordinal(input.addDay)}. Moving it to the ${ordinal(target)} practises investing as the pay comes in, before it's spent.`;
  return {
    kind: "payday_timing",
    ticker: PRACTICE_ETFS.us_stocks.ticker,
    key: `payday_timing:${input.addDay}:${target}`,
    headline: `Move practice money to the ${ordinal(target)}, after payday`,
    reason,
    amountCents: input.monthlyAddCents,
    trades: [],
    figures: [
      { label: "Your payday", value: `around the ${ordinal(input.paydayDay)}` },
      { label: "Practice money lands", value: `the ${ordinal(input.addDay)}` },
      { label: "Suggested day", value: `the ${ordinal(target)}` },
      { label: "Monthly practice money", value: dollars(input.monthlyAddCents) },
    ],
    caps: [
      `Only when the days are at least ${PAYDAY_TIMING_MIN_GAP_DAYS} apart`,
      `Never later than the ${ordinal(PAYDAY_ADD_MAX_DAY)}, so every month has the day`,
      "A setting you change; nothing is bought or sold",
    ],
    confidence: SCAN_CONFIDENCE.payday_timing,
    ask: {
      headline: `Move your ${wholeDollars(input.monthlyAddCents)} practice money to the ${ordinal(target)}`,
      short: `You're paid around the ${ordinal(input.paydayDay)}; your practice money lands on the ${ordinal(input.addDay)}.`,
      worthCents: input.monthlyAddCents,
      worthKind: "risk",
    },
  };
}

function driftWarningFlag(input: OpportunityInput): ScanFlag | null {
  const n = nearness(input);
  if (!n.invested || n.d.past || n.ratio < DRIFT_WARNING_SHARE) return null;
  const reason = `${cap(n.what)} ${n.what === "stocks" ? "are" : "is"} ${points(n.off)} points off your level's target and the band is ${points(n.band)}. Nothing needs doing yet; the next practice money goes where the mix is short, and the autopilot rebalances only past the band.`;
  return {
    kind: "drift_warning",
    ticker: PRACTICE_ETFS[n.d.worst].ticker,
    key: `drift_warning:${n.what}:${input.today.slice(0, 7)}`,
    headline: `${cap(n.what)} ${points(n.off)} points off; band is ${points(n.band)}`,
    reason,
    amountCents: Math.round(n.off * n.d.total),
    trades: [],
    figures: [
      ...sharesFigures(input.level, n.d.shares),
      {
        label: "Stocks together",
        value: `${pct(n.d.stocks)} (target ${pct(stocksShare(input.level))})`,
      },
      { label: "Of the way to the band", value: pct(Math.min(1, n.ratio)) },
    ],
    caps: [
      `Warned from ${pct(DRIFT_WARNING_SHARE)} of the way to the band`,
      `At most ${SCAN_CAPS.drift_warning.perMonth} warnings a month`,
      "Nothing is bought or sold",
    ],
    confidence: SCAN_CONFIDENCE.drift_warning,
    ask: {
      headline: `Check your mix: ${wholeDollars(Math.round(n.off * n.d.total))} off, near the band`,
      short: `${cap(n.what)} ${n.what === "stocks" ? "are" : "is"} ${points(n.off)} points off target; the band is ${points(n.band)}.`,
      worthCents: Math.round(n.off * n.d.total),
      worthKind: "risk",
    },
  };
}

function glideFlag(input: OpportunityInput): ScanFlag | null {
  const goal = input.prefs.goalDate;
  if (!goal || input.level <= 1) return null;
  const yearsLeft = daysBetween(input.today, goal) / 365.25;
  const max = glideMax(yearsLeft);
  if (input.level <= max) return null;
  const next = (input.level - 1) as RiskLevel;
  const years = Math.max(0, Math.round(yearsLeft * 10) / 10);
  const shift = Math.round(
    (stocksShare(input.level) - stocksShare(next)) * portfolioValue(input.state, input.prices),
  );
  const reason = `Your goal date is ${goal}, about ${years} years away. With that long left the usual path holds ${levelName(max)} or safer, and you're at ${levelName(input.level)}, so the next step is ${levelName(next)}: ${pct(stocksShare(next))} in stocks instead of ${pct(stocksShare(input.level))}.`;
  return {
    kind: "glide_path",
    ticker: PRACTICE_ETFS.bonds.ticker,
    key: `glide_path:${input.level}:${next}`,
    headline: `Step down to ${levelName(next)}: goal in ${years} years`,
    reason,
    amountCents: 0,
    trades: [],
    figures: [
      { label: "Goal date", value: goal },
      { label: "Years left", value: String(years) },
      { label: "Your level", value: levelName(input.level) },
      { label: "Highest level for the years left", value: levelName(max) },
      { label: "Stocks at the next level", value: pct(stocksShare(next)) },
    ],
    caps: [
      ...GLIDE_PATH.map((g) => `${g.minYears}+ years: up to ${levelName(g.maxLevel)}`),
      "One level at a time; you change it in your settings",
    ],
    confidence: SCAN_CONFIDENCE.glide_path,
    ask: {
      headline: `Step down to ${levelName(next)}: ${wholeDollars(shift)} less in stocks`,
      short: `Your goal is about ${years} years away; that allows ${levelName(max)} or safer.`,
      worthCents: shift,
      worthKind: "risk",
    },
  };
}

function mismatchFlag(input: OpportunityInput): ScanFlag | null {
  const limit = input.prefs.maxDropShare;
  if (limit === null || input.level <= 1) return null;
  const could = heldStressDrop(input.state, input.prices);
  if (could <= limit + RISK_MISMATCH_TOLERANCE) return null;
  const safer = levelWithin(limit);
  const loss = Math.round(could * portfolioValue(input.state, input.prices));
  // A safer level fits: otherwise the mix itself has drifted, and the rebalance handles it.
  if (safer >= input.level) return null;
  const reason = `You said you could take a drop of about ${pct(limit)}. In a crash like 2007-09 your mix as held could fall about ${pct(could)}. ${levelName(safer)} could fall about ${pct(stressDrop(MODEL_PORTFOLIOS[safer].weights))}, within what you said.`;
  return {
    kind: "risk_mismatch",
    ticker: PRACTICE_ETFS.us_stocks.ticker,
    key: `risk_mismatch:${input.level}:${safer}:${input.today.slice(0, 7)}`,
    headline: `Your mix could fall ${pct(could)}; you said ${pct(limit)}`,
    reason,
    amountCents: loss,
    trades: [],
    figures: [
      { label: "Drop you said you could take", value: pct(limit) },
      { label: "Your mix in a 2007-09 crash", value: pct(could) },
      { label: "Your level", value: levelName(input.level) },
      { label: "A level within your limit", value: levelName(safer) },
      { label: "Crash figures from", value: STRESS_DROP_SOURCE },
    ],
    caps: [
      `Only when the mix is more than ${pct(RISK_MISMATCH_TOLERANCE)} past your limit`,
      `At most ${SCAN_CAPS.risk_mismatch.perMonth} a month; you change the level in your settings`,
      "A past crash, not a forecast",
    ],
    confidence: SCAN_CONFIDENCE.risk_mismatch,
    ask: {
      headline: `Lower your risk: your mix could lose ${wholeDollars(loss)}`,
      short: `In a 2007-09 crash your mix could fall ${pct(could)}; you said about ${pct(limit)}.`,
      worthCents: loss,
      worthKind: "risk",
    },
  };
}

function maxDropFlag(input: OpportunityInput): ScanFlag | null {
  const limit = input.prefs.maxDropShare;
  if (limit === null || input.level <= 1) return null;
  const r = recentDrop(
    input.state,
    input.prices,
    { ...input.history, ...input.heldHistory },
    input.today,
  );
  if (!r || r.drop < MAX_DROP_NEAR_SHARE * limit) return null;
  const next = (input.level - 1) as RiskLevel;
  const reason = `Your practice portfolio is down ${pct(r.drop)} from its high of ${dollars(r.peakCents)} on ${r.peakDate}, and you said you could take about ${pct(limit)}. Moving to ${levelName(next)} (${pct(stocksShare(next))} in stocks) keeps you inside your own limit. This isn't a call on where markets go next.`;
  return {
    kind: "max_drop_near",
    ticker: PRACTICE_ETFS.bonds.ticker,
    key: `max_drop_near:${input.today.slice(0, 7)}`,
    headline: `Down ${pct(r.drop)} of your ${pct(limit)} limit: go safer?`,
    reason,
    amountCents: r.peakCents - r.nowCents,
    trades: [],
    figures: [
      { label: "High", value: `${dollars(r.peakCents)} on ${r.peakDate}` },
      { label: "Now", value: dollars(r.nowCents) },
      { label: "Down", value: pct(r.drop) },
      { label: "Drop you said you could take", value: pct(limit) },
      { label: "Next level down", value: levelName(next) },
    ],
    caps: [
      `Only from ${pct(MAX_DROP_NEAR_SHARE)} of the way to your limit, over the last ${MAX_DROP_LOOKBACK_DAYS} trading days`,
      `One level safer, at most ${SCAN_CAPS.max_drop_near.perMonth} a month; you change it in your settings`,
      "Nothing is bought or sold until you change the level",
    ],
    confidence: SCAN_CONFIDENCE.max_drop_near,
    ask: {
      headline: `Step down a level: down ${wholeDollars(r.peakCents - r.nowCents)}, near your limit`,
      short: `Down ${pct(r.drop)} from the high; you said you could take about ${pct(limit)}.`,
      worthCents: r.peakCents - r.nowCents,
      worthKind: "risk",
    },
  };
}

// Whether a step 292 flag is one the person's preferences allow.
function allowedByPrefs(f: ScanFlag, prefs: ScanPreferences): boolean {
  if (prefs.appetite === "none" && (f.kind === "dip_buy" || f.kind === "news_idea")) return false;
  if (prefs.appetite === "low" && f.kind === "news_idea") return false;
  if (!prefs.taxSensitive && f.kind === "tax_loss_harvest") return false;
  const excluded = new Set(prefs.excludedTickers.map((t) => t.toUpperCase()));
  return !f.trades.some((t) => t.side === "buy" && excluded.has(t.ticker));
}

export function scanOpportunities(input: OpportunityInput): ScanFlag[] {
  const total = portfolioValue(input.state, input.prices);
  if (total <= 0) return [];
  const prefs = input.prefs;
  // The kinds on (rulesOnAt, or the rule replay's own set), as for the step 292 kinds.
  const on = input.rules ?? rulesOnAt(input.level);
  let base = scanPortfolio(input).filter((f) => allowedByPrefs(f, prefs));

  // Cash the step 292 flags leave, above the buffer.
  const net = base
    .flatMap((f) => f.trades)
    .reduce((s, t) => s + (t.side === "sell" ? t.amountCents : -t.amountCents), 0);
  let available = Math.max(0, input.state.cashCents + net - prefs.cashBufferCents);
  // What a step 292 flag trades isn't switched again today, and what it sells isn't bought back.
  const touched = new Set(base.flatMap((f) => f.trades.map((t) => t.ticker)));
  const sold = base.flatMap((f) => f.trades.filter((t) => t.side === "sell").map((t) => t.ticker));
  const blocked = new Set([
    ...washBlocked(input.trades, input.today),
    ...sold,
    ...prefs.excludedTickers.map((t) => t.toUpperCase()),
  ]);
  // Dip buys and news ideas spend the same cash; new money only takes what is left.
  const newMoney = on.has("new_money_rebalance") ? newMoneyFlag(input, available, blocked) : null;
  if (newMoney) {
    available -= newMoney.amountCents;
    // The rebalance flag stays only when the new money doesn't bring the mix back.
    let after = input.state;
    for (const t of newMoney.trades) {
      after = apply(after, { ...t, priceCents: input.prices[t.ticker] }, PRACTICE_UNIVERSE).state;
    }
    if (!drift(input.level, after, input.prices).past) {
      base = base.filter((f) => f.kind !== "drift_rebalance");
    }
  }
  const found = [
    newMoney,
    newMoney ? null : cashDragFlag(input, available, blocked),
    ...cheaperFundFlags(input, blocked, touched),
    paydayFlag(input),
    newMoney ? null : driftWarningFlag(input),
    glideFlag(input),
    mismatchFlag(input),
    maxDropFlag(input),
  ].filter((f): f is ScanFlag => f !== null && on.has(f.kind) && !input.seen.has(f.key));
  const left = Object.fromEntries(
    OPPORTUNITY_KINDS.map((k) => [k, SCAN_CAPS[k].perMonth - (input.usedThisMonth[k] ?? 0)]),
  ) as Record<OpportunityKind, number>;
  return [...base, ...found.filter((f) => (left[f.kind as OpportunityKind] -= 1) >= 0)];
}
