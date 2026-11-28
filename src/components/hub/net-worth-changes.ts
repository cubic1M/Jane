// The Changes view's maths (./net-worth-chart.tsx), pure so it can be tested: the days on screen
// grouped into bars (a day, a week or a month each), and a power scale that keeps a $9 bar and an
// $18,000 bar both readable. Changes are differences of the same daily points the line uses.
import {
  CHANGE_EXPONENT,
  CHANGE_EXPONENT_MAX,
  CHANGE_FLOOR_CENTS,
  MEDIAN_BAR_SHARE,
  DAY_BARS_MAX_DAYS,
  WEEK_BARS_MAX_DAYS,
} from "@/config/net-worth-changes";
import { PAD_Y, niceTicks } from "./net-worth-geometry";

export type Period = "day" | "week" | "month";
type Point = { date: string; cents: number };

export type Bar = {
  period: Period;
  // The period's first and last day on screen ("YYYY-MM-DD"), and the index of that last day in
  // the points given.
  from: string;
  to: string;
  endIndex: number;
  // How much net worth moved over the period, in cents, and where it stood at the period's end.
  change: number;
  endCents: number;
};

export function periodFor(days: number): Period {
  return days <= DAY_BARS_MAX_DAYS ? "day" : days <= WEEK_BARS_MAX_DAYS ? "week" : "month";
}

// The key a day's period shares: itself, its week's Monday, or its month ("YYYY-MM").
function keyOf(date: string, period: Period): string {
  if (period === "day") return date;
  if (period === "month") return date.slice(0, 7);
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

// The bars for the days from..to (indexes into points, both included). A day's change is its
// point less the one before it, so the first point of all has none and gets no bar; a period's
// change is the sum of its days'.
export function bucketChanges(
  points: readonly Point[],
  from: number,
  to: number,
  period: Period = periodFor(to - from + 1),
): Bar[] {
  const bars: Bar[] = [];
  let key = "";
  for (let i = Math.max(1, from); i <= Math.min(to, points.length - 1); i++) {
    const k = keyOf(points[i].date, period);
    const day = points[i].cents - points[i - 1].cents;
    const last = bars[bars.length - 1];
    if (last && k === key) {
      last.change += day;
      last.to = points[i].date;
      last.endIndex = i;
      last.endCents = points[i].cents;
    } else {
      key = k;
      bars.push({
        period,
        from: points[i].date,
        to: points[i].date,
        endIndex: i,
        change: day,
        endCents: points[i].cents,
      });
    }
  }
  return bars;
}

// A change as a signed distance from zero on the power scale: the same each side, 0 at 0.
export const squash = (cents: number, exponent: number = CHANGE_EXPONENT): number =>
  Math.sign(cents) * Math.pow(Math.abs(cents) / 100, exponent);

// The least room between two axis labels, and between one and the zero line, in pixels.
const TICK_GAP_PX = 18;

export type ChangeScale = {
  // The power the amounts are raised to: 1 is a plain linear scale.
  exponent: number;
  // The pixel row of a change, and of zero.
  y: (cents: number) => number;
  zero: number;
  // Axis labels, in cents, both sides of zero, the real amounts: even steps when linear, powers of
  // ten ($10, $100, $1,000 ...) when compressed.
  ticks: number[];
};

// The two extents (the biggest rise and the biggest drop, on the scale) and the span, with the
// floor so a quiet stretch is not stretched into cliffs.
function extents(bars: readonly Bar[], exponent: number) {
  let up = 0;
  let down = 0;
  for (const b of bars) {
    up = Math.max(up, squash(b.change, exponent));
    down = Math.max(down, squash(-b.change, exponent));
  }
  const slack = Math.max(0, squash(CHANGE_FLOOR_CENTS, exponent) - (up + down)) / 2;
  return { up, down, top: up + slack, span: up + down + slack * 2 };
}

// How strongly to compress: as little as possible. Linear (1) whenever the typical bar (the median
// of the bars that moved) still gets MEDIAN_BAR_SHARE of the plot's half-height; otherwise the
// highest power, down to CHANGE_EXPONENT, that gets it there.
export function changeExponent(bars: readonly Bar[], height: number): number {
  const sizes = bars
    .map((b) => Math.abs(b.change))
    .filter((c) => c > 0)
    .sort((p, q) => p - q);
  if (sizes.length === 0) return CHANGE_EXPONENT_MAX;
  const median = sizes[Math.floor(sizes.length / 2)];
  const half = (height - PAD_Y * 2) / 2;
  for (
    let e = CHANGE_EXPONENT_MAX;
    e > CHANGE_EXPONENT + 1e-9;
    e = Math.round((e - 0.01) * 100) / 100
  ) {
    const bar = (squash(median, e) / extents(bars, e).span) * half * 2;
    if (bar >= MEDIAN_BAR_SHARE * half) return e;
  }
  return CHANGE_EXPONENT;
}

// The vertical scale for these bars, from the biggest drop to the biggest rise, over the height
// inside the padding. The power is chosen from the bars (changeExponent) unless one is given (the
// chart passes an eased one while it slides to a new fit).
export function changeScale(
  bars: readonly Bar[],
  height: number,
  exponent: number = changeExponent(bars, height),
): ChangeScale {
  const { up, down, top, span } = extents(bars, exponent);
  const room = height - PAD_Y * 2;
  const y = (cents: number) => PAD_Y + ((top - squash(cents, exponent)) / span) * room;
  const ticks: number[] = [];
  if (exponent >= CHANGE_EXPONENT_MAX - 1e-9) {
    // Linear: ordinary even steps across the range on screen.
    for (const t of niceTicks(-(span - top) * 100, top * 100)) {
      if (t !== 0 && Math.abs(y(t) - y(0)) >= TICK_GAP_PX) ticks.push(t);
    }
  } else {
    // Powers of ten that fit on either side, from $10 ($1 only when nothing reaches $10), leaving
    // out any that would sit on the zero line or on the label next to it.
    let last = 0;
    for (const dollars of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]) {
      const reach = squash(dollars * 100, exponent);
      if (dollars === 1 && Math.max(up, down) >= squash(1_000, exponent)) continue;
      const row = Math.abs(y(dollars * 100) - y(0));
      if (row - last < TICK_GAP_PX) continue;
      if (up >= reach) ticks.push(dollars * 100);
      if (down >= reach) ticks.push(-dollars * 100);
      last = row;
    }
  }
  return { exponent, y, zero: y(0), ticks: ticks.sort((p, q) => q - p) };
}

// The words for a bar: "Nov 3, 2026", "Week of Nov 2, 2026" or "November 2026".
export function barLabel(bar: Bar, day: (d: string) => string, month: (m: string) => string) {
  if (bar.period === "day") return day(bar.from);
  if (bar.period === "month") return month(bar.from.slice(0, 7));
  return `Week of ${day(keyOf(bar.from, "week"))}`;
}
