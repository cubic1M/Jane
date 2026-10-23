import type { RiskLevel } from "@/config/investing";
import {
  AUTOPILOT_LIMITS,
  classTickers,
  MODEL_PORTFOLIOS,
  PRACTICE_ETFS,
  PRACTICE_STOCKS,
  PRACTICE_UNIVERSE,
  type PracticeClass,
} from "@/config/portfolios";
import {
  NEWS_LOOKBACK_DAYS,
  SCAN_HISTORY_DAYS,
  SCAN_KINDS,
  type ScanKind,
} from "@/config/practice-scan";
import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { Bar, Headline } from "@/lib/market/types";
import { worstDropOf, type Drop, type PathPoint } from "./backtest";
import {
  monthlyDue,
  planTrades,
  portfolioValue,
  positionValue,
  sellsFirst,
  violates,
} from "./practice-autopilot";
import { apply, type LedgerState } from "./practice-ledger";
import { scanOpportunities } from "./practice-opportunities";
import { DEFAULT_PREFERENCES, type PracticePreferences } from "./practice-preferences";
import {
  firstRefusal,
  profileFor,
  refusedByPreferences,
  scanPreferencesFor,
} from "./practice-profile";
import {
  daysBefore,
  flagStatus,
  monthUse,
  washBlocked,
  type PastFlag,
  type PastTrade,
} from "./practice-scan";

// The rule replay ("Did the extra rules help?"): the practice autopilot and its daily scan run
// day by day over stored history, with the very functions the live run uses (scanOpportunities,
// which runs scanPortfolio first, flagStatus, monthUse, planTrades, washBlocked, monthlyDue, sellsFirst and the ledger's apply),
// so no rule is copied here. Each day is the live day in order: the monthly money in, the scan
// and each flag it acts on within its caps and the hard limits, then the autopilot's rebalance.
// Every simulated trade is recorded. Pure: the same bars always give the same result. A replay of
// the past, never a forecast; practice money only.

export type Strategy =
  // The autopilot with the scan's opportunity rules (the ones in `rules`).
  | "rules"
  // The autopilot alone: buy the model, rebalance past the band, invest the monthly money.
  | "rebalance"
  // Buy the targets, then never sell: the monthly money buys the targets too.
  | "hold";

export type ReplayInput = {
  level: RiskLevel;
  // Each ticker's daily closes, oldest first. The trading days are the ones every model fund
  // (PRACTICE_ETFS) has; any other ticker is priced at its last close on or before the day.
  bars: Readonly<Record<string, readonly Bar[]>>;
  // The first day to replay; earlier bars are still read (the dip's look-back), as the live
  // scan reads closes from before the portfolio started. Left out: the first shared day.
  from?: string;
  headlines: readonly Headline[];
  startCents: number;
  monthlyAddCents: number;
  addDay: number;
  strategy: Strategy;
  // For "rules": the scan kinds that may flag (drift always does).
  rules?: ReadonlySet<ScanKind>;
  // The person's practice preferences (B1's PracticePreferences): the profile built from them
  // each day (profileFor) sets the mix, caps, never-buy list, cash kept and suggest-only, as it
  // does for the live autopilot and scan. Left out, the defaults.
  preferences?: PracticePreferences;
  // Each trade's cost in basis points of what changes hands, taken off the value as paid.
  tradeCostBps: number;
};

export type ReplayTrade = {
  date: string;
  ticker: string;
  side: "buy" | "sell";
  amountCents: number;
  priceCents: number;
  quantity: number;
  gainCents: number | null;
  rule: string;
  // The sentence the live trade would carry (none for buy and hold).
  reason: string | null;
  // The portfolio's value as the trade was placed, and the holding's value after it: what the
  // per-trade and per-position caps are measured against.
  portfolioCents: number;
  positionAfterCents: number;
};

export type StressDrop = { label: string; fraction: number | null };

export type ReplayResult = {
  strategy: Strategy;
  from: string;
  to: string;
  // The start and every monthly add.
  putInCents: number;
  // What the portfolio is worth on the last day, less every trade's cost.
  endCents: number;
  // Time-weighted: the money put in doesn't count as gain. Starts at the starting amount.
  index: PathPoint[];
  totalReturn: number;
  worstDrop: Drop;
  trades: ReplayTrade[];
  // Trades by rule ("model_buy", "rebalance", "dip_buy", "hold" and so on).
  byRule: Record<string, number>;
  // Scan flags that acted, those a limit held, and those kept as suggestions (no trade).
  acted: Partial<Record<ScanKind, number>>;
  held: Partial<Record<ScanKind, number>>;
  suggested: Partial<Record<ScanKind, number>>;
  costCents: number;
  // Losses taken by tax-loss swaps (before taxes they show only as a cost).
  harvestedLossCents: number;
  // The largest the opportunity stocks were right after a day's buys, as a share of the
  // portfolio's value that morning (the opportunity share the scan caps).
  maxOpportunityShare: number;
  // The most trades on one day.
  maxTradesInADay: number;
};

// The live scan runs at 21:30 UTC (vercel.json); trades are stamped then.
const stamp = (day: string) => `${day}T21:30:00.000Z`;
const CLASSES = Object.keys(PRACTICE_ETFS) as PracticeClass[];
const MAIN = CLASSES.map((c) => PRACTICE_ETFS[c].ticker);
const MODEL_TICKERS = CLASSES.flatMap((c) => classTickers(c));
const STOCKS = PRACTICE_STOCKS as readonly string[];

// The trading days every model fund has a close.
export function replayDays(bars: Readonly<Record<string, readonly Bar[]>>): string[] {
  const sets = MAIN.map((t) => new Set((bars[t] ?? []).map((b) => b.date)));
  return [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
}

// Walks each ticker's bars forward with the days: its last close on or before the day, and the
// window of closes the scan reads.
class Cursor {
  private end = 0;
  private start = 0;
  constructor(private readonly bars: readonly Bar[]) {}
  at(day: string): number | null {
    while (this.end < this.bars.length && this.bars[this.end].date <= day) this.end += 1;
    return this.end > 0 ? this.bars[this.end - 1].closeCents : null;
  }
  window(from: string): readonly Bar[] {
    while (this.start < this.end && this.bars[this.start].date < from) this.start += 1;
    return this.bars.slice(this.start, this.end);
  }
}

export function replayRules(input: ReplayInput): ReplayResult | null {
  const days = replayDays(input.bars).filter((d) => !input.from || d >= input.from);
  if (days.length < 2) return null;
  const { level, strategy } = input;
  const rules = input.rules ?? new Set(SCAN_KINDS);
  const cost = input.tradeCostBps / 10_000;
  const cursors = new Map(
    [...PRACTICE_UNIVERSE].map((t) => [t, new Cursor(input.bars[t] ?? [])] as const),
  );
  const headlines = [...input.headlines]
    .filter((h) => h.ticker === null || STOCKS.includes(h.ticker))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let state: LedgerState = { cashCents: input.startCents, positions: {} };
  let putIn = input.startCents;
  let costCents = 0;
  let harvested = 0;
  let maxOpportunityShare = 0;
  let maxTradesInADay = 0;
  let lastAddMonth = "";
  // The day practice money last went in: the start, then each month's add.
  let lastDepositOn = days[0];
  const pastTrades: PastTrade[] = [];
  const pastFlags: PastFlag[] = [];
  const trades: ReplayTrade[] = [];
  const byRule: Record<string, number> = {};
  const acted: Partial<Record<ScanKind, number>> = {};
  const held: Partial<Record<ScanKind, number>> = {};
  const suggested: Partial<Record<ScanKind, number>> = {};
  const preferences = input.preferences ?? DEFAULT_PREFERENCES;
  const prefs = scanPreferencesFor(preferences);
  // The profile moves only with a goal date's glide path; otherwise it is the same every day.
  const fixed = preferences.goalDate ? null : profileFor(preferences, { level, today: days[0] });
  const index: PathPoint[] = [];
  let indexValue = input.startCents;
  let lastValue = 0;

  for (const [i, today] of days.entries()) {
    const prices: Record<string, number> = {};
    for (const [t, c] of cursors) {
      const close = c.at(today);
      if (close) prices[t] = close;
    }
    let tradesToday = 0;
    let boughtStock = false;
    const place = (
      t: { ticker: string; side: "buy" | "sell"; amountCents: number; reason?: string },
      rule: string,
    ) => {
      const priceCents = prices[t.ticker];
      const portfolioCents = portfolioValue(state, prices);
      const { ticker, side, amountCents } = t;
      const applied = apply(state, { side, ticker, amountCents, priceCents }, PRACTICE_UNIVERSE);
      state = applied.state;
      tradesToday += 1;
      if (t.side === "buy" && STOCKS.includes(t.ticker)) boughtStock = true;
      costCents += t.amountCents * cost;
      byRule[rule] = (byRule[rule] ?? 0) + 1;
      if (rule === "tax_loss_harvest" && t.side === "sell" && (applied.gainCents ?? 0) < 0)
        harvested -= applied.gainCents!;
      const quantity = applied.quantity ?? 0;
      trades.push({
        date: today,
        ticker,
        side,
        amountCents,
        priceCents,
        quantity,
        gainCents: applied.gainCents,
        rule,
        reason: t.reason ?? null,
        portfolioCents,
        positionAfterCents: positionValue(state, prices, ticker),
      });
      pastTrades.push({
        placedAt: stamp(today),
        side: t.side,
        ticker: t.ticker,
        quantity,
        amountCents: t.amountCents,
        gainCents: applied.gainCents,
        rule,
      });
    };

    // The monthly money, before the scan, so a dip can use it first (addMonthlyIfDue).
    const month = today.slice(0, 7);
    const due = monthlyDue({
      monthlyAddCents: input.monthlyAddCents,
      addDay: input.addDay,
      today,
      addedThisMonth: lastAddMonth === month,
    });
    // The first day is the start (startPractice), and the live first run adds the month too.
    let flow = 0;
    if (due) {
      state = apply(
        state,
        { side: "deposit", amountCents: input.monthlyAddCents },
        PRACTICE_UNIVERSE,
      ).state;
      putIn += input.monthlyAddCents;
      flow = input.monthlyAddCents;
      lastAddMonth = month;
      lastDepositOn = today;
    }

    const morning = portfolioValue(state, prices);
    const profile = fixed ?? profileFor(preferences, { level, today });
    if (strategy === "hold") {
      // The targets with whatever cash is waiting, never a sale.
      const weights = profile.weights;
      const cash = state.cashCents;
      for (const c of CLASSES) {
        const amountCents = Math.floor(cash * weights[c]);
        const t = { ticker: PRACTICE_ETFS[c].ticker, side: "buy" as const, amountCents };
        if (amountCents < AUTOPILOT_LIMITS.minTradeCents) continue;
        if (violates(t, state, prices, tradesToday, morning)) continue;
        place(t, "hold");
      }
    } else {
      if (strategy === "rules") {
        const history: Record<string, readonly Bar[]> = {};
        const from = daysBefore(today, SCAN_HISTORY_DAYS);
        for (const t of MODEL_TICKERS) history[t] = cursors.get(t)!.window(from);
        const newsFrom = daysBefore(today, NEWS_LOOKBACK_DAYS);
        const { usedThisMonth, seen } = monthUse(pastFlags, today);
        // Every ticker held beyond the model funds (the opportunity stocks), as the live scan reads.
        const heldHistory: Record<string, readonly Bar[]> = {};
        for (const t of Object.keys(state.positions))
          if (!history[t]) heldHistory[t] = cursors.get(t)?.window(from) ?? [];
        const unpriced = [...PRACTICE_UNIVERSE].filter((t) => !prices[t]);
        const flags = scanOpportunities({
          level: profile.level,
          state,
          weights: profile.weights,
          caps: profile.caps,
          opportunityMaxShare: profile.opportunityMaxShare,
          avoid: profile.avoid,
          cashBufferCents: profile.cashBufferCents,
          prices,
          history,
          trades: pastTrades,
          headlines: headlines.filter((h) => h.date >= newsFrom && h.date <= today),
          today,
          opportunitiesPaused: false,
          usedThisMonth,
          seen,
          rules,
          // A fund the history has no price for yet is one the scan can't buy (live, every
          // fund has one): treated like a ticker the person never buys.
          prefs:
            unpriced.length > 0
              ? { ...prefs, excludedTickers: [...prefs.excludedTickers, ...unpriced] }
              : prefs,
          monthlyAddCents: input.monthlyAddCents,
          addDay: input.addDay,
          // The replay knows no paydays (they come from a person's bank deposits); the payday
          // kind only ever suggests.
          paydayDay: null,
          heldHistory,
          lastDepositOn,
        });
        for (const flag of flags) {
          const { status } = flagStatus(
            flag,
            state,
            prices,
            tradesToday,
            prefs.mode,
            firstRefusal(profile, flag),
          );
          pastFlags.push({
            key: status === "held" ? `${flag.key}:held:${today}` : flag.key,
            kind: flag.kind,
            scannedAt: stamp(today),
            status,
          });
          if (status === "held") held[flag.kind] = (held[flag.kind] ?? 0) + 1;
          if (status === "suggested") suggested[flag.kind] = (suggested[flag.kind] ?? 0) + 1;
          if (status !== "acted") continue;
          acted[flag.kind] = (acted[flag.kind] ?? 0) + 1;
          for (const t of flag.trades) if (!refusedByPreferences(profile, t)) place(t, t.rule);
        }
      }
      // The autopilot: funds sold at a loss lately aren't bought back (no wash sale), and a fund
      // the history has no price for yet can't be bought (live, every fund has one).
      const since = daysBefore(today, WASH_SALE_DAYS + 1);
      const recent = pastTrades.filter((t) => t.side === "sell" && t.placedAt >= since);
      const blocked = washBlocked(recent, today);
      for (const t of MODEL_TICKERS) if (!prices[t]) blocked.add(t);
      const plan = planTrades({
        level: profile.level,
        state,
        prices,
        paused: false,
        tradesToday,
        blocked,
        weights: profile.weights,
        avoid: new Set(profile.avoid),
        cashBufferCents: profile.cashBufferCents,
      });
      // Suggest only: the plan is shown, never placed.
      if (profile.trades)
        for (const t of sellsFirst(plan)) if (!refusedByPreferences(profile, t)) place(t, t.rule);
    }

    maxTradesInADay = Math.max(maxTradesInADay, tradesToday);
    const value = portfolioValue(state, prices) - costCents;
    if (boughtStock) {
      const stocks = STOCKS.reduce((s, t) => s + positionValue(state, prices, t), 0);
      maxOpportunityShare = Math.max(maxOpportunityShare, stocks / morning);
    }
    if (i > 0 && lastValue > 0) indexValue *= (value - flow) / lastValue;
    index.push({ date: today, valueCents: Math.round(indexValue) });
    lastValue = value;
  }

  const endIndex = index[index.length - 1].valueCents;
  return {
    strategy,
    from: days[0],
    to: days[days.length - 1],
    putInCents: putIn,
    endCents: Math.round(lastValue),
    index,
    totalReturn: endIndex / input.startCents - 1,
    worstDrop: worstDropOf(index),
    trades,
    byRule,
    acted,
    held,
    suggested,
    costCents: Math.round(costCents),
    harvestedLossCents: harvested,
    maxOpportunityShare,
    maxTradesInADay,
  };
}

// The worst fall inside a period (from its own highest point), or null when the replay doesn't
// cover the period.
export function stressDrop(
  index: readonly PathPoint[],
  period: { label: string; from: string; to: string },
): StressDrop {
  const inside = index.filter((p) => p.date >= period.from && p.date <= period.to);
  // Covered only when the replay has the period's first weeks.
  const covered = inside.length > 0 && index[0].date <= daysBefore(period.from, -14);
  return { label: period.label, fraction: covered ? worstDropOf(inside).fraction : null };
}

// Whether a rule helped at a level: the replay with it against the same replay without it.
export type RuleEffect = "helped" | "hurt" | "no_difference";

export function ruleEffect(
  withRule: { totalReturn: number; worstDrop: Pick<Drop, "fraction"> },
  without: { totalReturn: number; worstDrop: Pick<Drop, "fraction"> },
  worsePoints: number,
): { effect: RuleEffect; returnPoints: number; dropPoints: number } {
  const returnPoints = (withRule.totalReturn - without.totalReturn) * 100;
  // Positive when the worst drop was shallower with the rule.
  const dropPoints = (withRule.worstDrop.fraction - without.worstDrop.fraction) * 100;
  const effect: RuleEffect =
    returnPoints < -worsePoints || (dropPoints < -worsePoints && returnPoints <= worsePoints)
      ? "hurt"
      : returnPoints > worsePoints || dropPoints > worsePoints
        ? "helped"
        : "no_difference";
  return { effect, returnPoints, dropPoints };
}
