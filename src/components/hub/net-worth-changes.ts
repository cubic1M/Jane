// The Changes view's maths (./net-worth-chart.tsx), pure so it can be tested: the days on screen
// grouped into bars (a day, a week or a month each), and a power scale that keeps a $9 bar and an
// $18,000 bar both readable. Changes are differences of the same daily points the line uses.
import {
  CHANGE_EXPONENT,
  CHANGE_FLOOR_CENTS,
  DAY_BARS_MAX_DAYS,
  WEEK_BARS_MAX_DAYS,
} from "@/config/net-worth-changes";
import { PAD_Y } from "./net-worth-geometry";

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
export const squash = (cents: number): number =>
  Math.sign(cents) * Math.pow(Math.abs(cents) / 100, CHANGE_EXPONENT);

// The least room between two axis labels, and between one and the zero line, in pixels.
const TICK_GAP_PX = 14;

export type ChangeScale = {
  // The pixel row of a change, and of zero.
  y: (cents: number) => number;
  zero: number;
  // Axis labels, in cents, both sides of zero: $10, $100, $1,000 ... (the real amounts).
  ticks: number[];
};

// The vertical scale for these bars: from the biggest drop to the biggest rise, on the power
// scale, over the height inside the padding, at least CHANGE_FLOOR_CENTS wide so a quiet stretch
// is not stretched into cliffs.
export function changeScale(bars: readonly Bar[], height: number): ChangeScale {
  let up = 0;
  let down = 0;
  for (const b of bars) {
    up = Math.max(up, squash(b.change));
    down = Math.max(down, squash(-b.change));
  }
  const slack = Math.max(0, squash(CHANGE_FLOOR_CENTS) - (up + down)) / 2;
  const top = up + slack;
  const span = up + down + slack * 2;
  const room = height - PAD_Y * 2;
  const y = (cents: number) => PAD_Y + ((top - squash(cents)) / span) * room;
  // Powers of ten that fit on either side, from $10 ($1 only when nothing reaches $10), leaving
  // out any that would sit on the zero line or on the label next to it.
  const ticks: number[] = [];
  let last = 0;
  for (const dollars of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]) {
    const reach = squash(dollars * 100);
    if (dollars === 1 && Math.max(up, down) >= squash(1_000)) continue;
    const row = Math.abs(y(dollars * 100) - y(0));
    if (row - last < TICK_GAP_PX) continue;
    if (up >= reach) ticks.push(dollars * 100);
    if (down >= reach) ticks.push(-dollars * 100);
    last = row;
  }
  return { y, zero: y(0), ticks: ticks.sort((a, b) => b - a) };
}

// The words for a bar: "Nov 3, 2026", "Week of Nov 2, 2026" or "November 2026".
export function barLabel(bar: Bar, day: (d: string) => string, month: (m: string) => string) {
  if (bar.period === "day") return day(bar.from);
  if (bar.period === "month") return month(bar.from.slice(0, 7));
  return `Week of ${day(keyOf(bar.from, "week"))}`;
}
