import { FULL_YEAR_SLACK_DAYS, TRADING_DAYS_PER_YEAR } from "@/config/backtest";
import type { PracticeClass } from "@/config/portfolios";
import type { Bar } from "@/lib/market/types";
import { DAY_MS } from "@/lib/dates";

// A backtest of one model portfolio (spec step 295): buy the targets on the first day, take each
// fund's yearly cost out a little every trading day, and go back to the targets on any day a
// class drifts past the band. No taxes, no money in or out. Pure: the same prices always give the
// same path. A replay of the past, never a forecast.

export type BacktestInput = {
  weights: Readonly<Record<PracticeClass, number>>;
  // Daily closes for each class's fund, oldest first. Only days every fund has are used.
  bars: Readonly<Record<PracticeClass, readonly Bar[]>>;
  startCents: number;
  feeBps: Readonly<Record<PracticeClass, number>>;
  // Rebalance when a class is more than this many percentage points from its target.
  bandPoints: number;
  // Each rebalance's trading cost, in basis points of what changes hands.
  tradeCostBps?: number;
};

export type PathPoint = { date: string; valueCents: number };

export type Drop = {
  // As a share, negative: -0.25 is a 25% drop. 0 when it never fell.
  fraction: number;
  peakDate: string;
  peakCents: number;
  troughDate: string;
  troughCents: number;
  // The first day back at the peak, or null if it hasn't got back yet.
  recoveredOn: string | null;
};

export type YearResult = {
  year: number;
  // The value it started the year with (the last close of the year before, or the first day).
  startCents: number;
  endCents: number;
  return: number;
  // The biggest fall inside the year.
  worstDrop: number;
  from: string;
  to: string;
  // False for a part year at either end; part years are shown but never ranked.
  whole: boolean;
};

export type BacktestResult = {
  from: string;
  to: string;
  startCents: number;
  endCents: number;
  totalReturn: number;
  // Every trading day's value.
  path: PathPoint[];
  worstDrop: Drop;
  years: YearResult[];
  bestYear: YearResult | null;
  worstYear: YearResult | null;
  rebalances: number;
  feesCents: number;
};

const CLASSES: readonly PracticeClass[] = ["us_stocks", "intl_stocks", "bonds", "cash"];
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

// The days every fund has a close, with each fund's close that day.
export function alignBars(
  bars: Readonly<Record<PracticeClass, readonly Bar[]>>,
): { date: string; closes: Record<PracticeClass, number> }[] {
  const maps = CLASSES.map((c) => new Map(bars[c].map((b) => [b.date, b.closeCents])));
  return bars.us_stocks
    .map((b) => b.date)
    .filter((d) => maps.every((m) => (m.get(d) ?? 0) > 0))
    .sort()
    .map((date) => ({
      date,
      closes: Object.fromEntries(CLASSES.map((c, i) => [c, maps[i].get(date)!])) as Record<
        PracticeClass,
        number
      >,
    }));
}

// The biggest peak-to-trough fall along a path.
export function worstDropOf(path: readonly PathPoint[]): Drop {
  const first = path[0];
  let peak = first;
  let best: Drop = {
    fraction: 0,
    peakDate: first.date,
    peakCents: first.valueCents,
    troughDate: first.date,
    troughCents: first.valueCents,
    recoveredOn: null,
  };
  for (const p of path) {
    if (p.valueCents > peak.valueCents) peak = p;
    const fraction = p.valueCents / peak.valueCents - 1;
    if (fraction < best.fraction)
      best = {
        fraction,
        peakDate: peak.date,
        peakCents: peak.valueCents,
        troughDate: p.date,
        troughCents: p.valueCents,
        recoveredOn: null,
      };
  }
  if (best.fraction < 0)
    best.recoveredOn =
      path.find((p) => p.date > best.troughDate && p.valueCents >= best.peakCents)?.date ?? null;
  return best;
}

function yearsOf(path: readonly PathPoint[]): YearResult[] {
  const out: YearResult[] = [];
  let before = path[0];
  let i = 0;
  while (i < path.length) {
    const year = Number(path[i].date.slice(0, 4));
    const inYear: PathPoint[] = [];
    while (i < path.length && Number(path[i].date.slice(0, 4)) === year) inYear.push(path[i++]);
    const first = inYear[0];
    const last = inYear[inYear.length - 1];
    const isFirstYear = first === path[0];
    const startsWhole =
      !isFirstYear || dayNumber(first.date) - dayNumber(`${year}-01-01`) <= FULL_YEAR_SLACK_DAYS;
    const endsWhole = dayNumber(`${year}-12-31`) - dayNumber(last.date) <= FULL_YEAR_SLACK_DAYS;
    const start = isFirstYear ? first : before;
    out.push({
      year,
      startCents: start.valueCents,
      endCents: last.valueCents,
      return: last.valueCents / start.valueCents - 1,
      worstDrop: worstDropOf(isFirstYear ? inYear : [before, ...inYear]).fraction,
      from: first.date,
      to: last.date,
      whole: startsWhole && endsWhole,
    });
    before = last;
  }
  return out;
}

export function runBacktest(input: BacktestInput): BacktestResult | null {
  const days = alignBars(input.bars);
  if (days.length < 2) return null;
  const { weights, feeBps, startCents } = input;
  const band = input.bandPoints / 100;
  const tradeCost = (input.tradeCostBps ?? 0) / 10_000;
  const dailyFee = Object.fromEntries(
    CLASSES.map((c) => [c, feeBps[c] / 10_000 / TRADING_DAYS_PER_YEAR]),
  ) as Record<PracticeClass, number>;

  // Fund units held, fractional: a model, not an order book.
  const units = Object.fromEntries(
    CLASSES.map((c) => [c, (startCents * weights[c]) / days[0].closes[c]]),
  ) as Record<PracticeClass, number>;
  const path: PathPoint[] = [{ date: days[0].date, valueCents: startCents }];
  let fees = 0;
  let rebalances = 0;

  for (const { date, closes } of days.slice(1)) {
    let value = 0;
    for (const c of CLASSES) {
      const held = units[c] * closes[c];
      const fee = held * dailyFee[c];
      fees += fee;
      units[c] -= fee / closes[c];
      value += held - fee;
    }
    const drifted = CLASSES.some(
      (c) => Math.abs((units[c] * closes[c]) / value - weights[c]) > band + 1e-12,
    );
    if (drifted) {
      const traded = CLASSES.reduce(
        (s, c) => s + Math.abs(units[c] * closes[c] - value * weights[c]),
        0,
      );
      value -= traded * tradeCost;
      for (const c of CLASSES) units[c] = (value * weights[c]) / closes[c];
      rebalances += 1;
    }
    path.push({ date, valueCents: Math.round(value) });
  }

  const years = yearsOf(path);
  const whole = years.filter((y) => y.whole);
  const pick = (better: (a: YearResult, b: YearResult) => boolean) =>
    whole.length === 0 ? null : whole.reduce((m, y) => (better(y, m) ? y : m));
  const endCents = path[path.length - 1].valueCents;
  return {
    from: path[0].date,
    to: path[path.length - 1].date,
    startCents,
    endCents,
    totalReturn: endCents / startCents - 1,
    path,
    worstDrop: worstDropOf(path),
    years,
    bestYear: pick((a, b) => a.return > b.return),
    worstYear: pick((a, b) => a.return < b.return),
    rebalances,
    feesCents: Math.round(fees),
  };
}

// The path thinned to the last trading day of each month (and the first day), for a chart.
export function monthlyPath(path: readonly PathPoint[]): PathPoint[] {
  return path.filter(
    (p, i) =>
      i === 0 || i === path.length - 1 || path[i + 1].date.slice(0, 7) !== p.date.slice(0, 7),
  );
}
