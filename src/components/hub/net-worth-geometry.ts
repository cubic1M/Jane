// The net worth chart's drawing maths (./net-worth-chart.tsx), pure so it can be tested: the
// vertical scale that fits the days in view, the one big step that can flatten the rest, where a
// day's value sits on the chart, and the line through the days.

import { formatWholeDollars } from "@/lib/money";

// Room above the highest point and below the lowest, in pixels.
export const PAD_Y = 14;

// The least the vertical scale spans, in cents ($5): a flat stretch looks flat, and a $2 move on
// $300 is not blown up into a cliff.
export const MIN_SPAN_CENTS = 500;
// And at least this share of the top value (0.1%, a hundredth of the old 1%), so a few days with
// next to no change on a large balance are not a cliff either.
export const MIN_SPAN_SHARE = 0.001;
// The scale spans at least this many typical day-to-day moves (the middle of the days' own
// non-zero changes, in view), so a week of $50 moves on $160,000 is a line with shape, not a
// stretch of an invisible 1% of the balance ($1,600).
export const TYPICAL_MOVES_SPAN = 3;
// Fewer non-zero changes than this and there is no "typical": only MIN_SPAN_CENTS applies.
export const TYPICAL_MOVES_NEEDED = 3;

// One step is "the big step" when one day's change is at least this share of the days' whole
// range, with at least FOCUS_MIN_DAYS days on one side of it; and focusing on that side must
// show the rest at least FOCUS_GAIN times taller, or it is not worth it.
export const STEP_SHARE = 0.6;
export const FOCUS_MIN_DAYS = 5;
export const FOCUS_GAIN = 3;

// How long the scale takes to settle on a new fit, in ms (none with reduced motion).
export const SCALE_EASE_MS = 220;

export type Step = {
  // The step lands on this day (an index among the days shown): the first day at the new level.
  index: number;
  // The change, in cents: positive up.
  cents: number;
  // The side the scale fits when focused: the days before the step or from it on.
  side: "before" | "after";
  // Where the line leaves the chart on the other side: above the top edge or below the bottom.
  edge: "top" | "bottom";
};

export type Fit = {
  // The highest and lowest values the scale shows (0 with none), in cents: the scale's labels.
  top: number;
  bottom: number;
  // The values at the chart's bottom and top edges (inside the padding), in cents.
  lo: number;
  hi: number;
  // The big step among the days, whether or not the scale is focused on a side of it.
  step: Step | null;
  // The scale fits one side of the step (the rest runs off the edge).
  focused: boolean;
};

export type ChartScale = Fit & {
  // A day's place across (by its index among those shown) and a value's place down, in pixels.
  x: (i: number) => number;
  y: (cents: number) => number;
};

const middle = (sorted: readonly number[]) => sorted[Math.floor((sorted.length - 1) / 2)];

// The days' non-zero day-to-day changes, by size.
function movesIn(values: readonly number[]): number[] {
  const moves: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const move = Math.abs(values[i] - values[i - 1]);
    if (move > 0) moves.push(move);
  }
  return moves;
}

// The span the days need at least: their own typical move, a few times over, never under $5 or
// 0.1% of the top value.
function floorSpan(values: readonly number[], top: number): number {
  const least = Math.max(MIN_SPAN_CENTS, Math.abs(top) * MIN_SPAN_SHARE);
  const moves = movesIn(values);
  if (moves.length < TYPICAL_MOVES_NEEDED) return least;
  moves.sort((a, b) => a - b);
  return Math.max(least, TYPICAL_MOVES_SPAN * middle(moves));
}

// The range that holds these days, centred, never narrower than the days' own floor.
function fitDays(values: readonly number[]): Pick<Fit, "top" | "bottom" | "lo" | "hi"> {
  const top = values.length ? Math.max(...values) : 0;
  const bottom = values.length ? Math.min(...values) : 0;
  const span = Math.max(top - bottom, floorSpan(values, top));
  const mid = (top + bottom) / 2;
  return { top, bottom, lo: mid - span / 2, hi: mid + span / 2 };
}

// The one day-to-day change that takes most of the height (at least STEP_SHARE of the range of
// the days in view), when there are at least FOCUS_MIN_DAYS days on one side of it; null when
// there is none, or when focusing would not make the rest any taller (FOCUS_GAIN).
export function dominantStep(values: readonly number[]): Step | null {
  const n = values.length;
  if (n < FOCUS_MIN_DAYS + 1) return null;
  const range = Math.max(...values) - Math.min(...values);
  if (range <= 0) return null;
  let at = 1;
  for (let i = 2; i < n; i++) {
    if (Math.abs(values[i] - values[i - 1]) > Math.abs(values[at] - values[at - 1])) at = i;
  }
  const cents = values[at] - values[at - 1];
  if (Math.abs(cents) < STEP_SHARE * range) return null;
  // The side with more days; the latest wins a tie.
  const before = at;
  const after = n - at;
  if (Math.max(before, after) < FOCUS_MIN_DAYS) return null;
  const side = after >= before ? "after" : "before";
  const rest = side === "after" ? values.slice(at) : values.slice(0, at);
  // A side with next to no moves of its own (a flat stretch) has nothing to show up close.
  if (movesIn(rest).length < TYPICAL_MOVES_NEEDED) return null;
  const whole = fitDays(values);
  const only = fitDays(rest);
  if ((only.hi - only.lo) * FOCUS_GAIN > whole.hi - whole.lo) return null;
  // The other side lies below the scale when it is lower than this one, above it otherwise.
  const otherIsLower = side === "after" ? cents > 0 : cents < 0;
  return { index: at, cents, side, edge: otherIsLower ? "bottom" : "top" };
}

// What the scale fits: exactly the days in view (or, when focused, the larger side of the one big
// step among them), with the floor. `focus: false` fits all of them, step and all.
export function fitScale(values: readonly number[], { focus }: { focus: boolean }): Fit {
  const step = dominantStep(values);
  if (!step || !focus) return { ...fitDays(values), step, focused: false };
  const rest = step.side === "after" ? values.slice(step.index) : values.slice(0, step.index);
  return { ...fitDays(rest), step, focused: true };
}

// The days shown fill the width; the values fill the height.
export function scaleAt(
  range: { lo: number; hi: number },
  n: number,
  width: number,
  height: number,
): Pick<ChartScale, "x" | "y"> {
  const span = range.hi - range.lo;
  return {
    x: (i) => (n < 2 ? width : (i / (n - 1)) * width),
    y: (v) => PAD_Y + (1 - (v - range.lo) / span) * (height - PAD_Y * 2),
  };
}

export function chartScale(
  values: readonly number[],
  width: number,
  height: number,
  { focus = true }: { focus?: boolean } = {},
): ChartScale {
  const fit = fitScale(values, { focus });
  return { ...fit, ...scaleAt(fit, values.length, width, height) };
}

// What the marker at the chart's edge says, in plain words: "+$5,120 on Nov 3". With the figures
// hidden, only the direction ("A big rise on Nov 3").
export function stepWords(step: Pick<Step, "cents">, day: string, figureShown: boolean): string {
  if (!figureShown) return `A big ${step.cents >= 0 ? "rise" : "drop"} on ${day}`;
  const sign = step.cents >= 0 ? "+" : "−";
  return `${sign}${formatWholeDollars(Math.abs(step.cents))} on ${day}`;
}

// The line's SVG path: at most one vertex per pixel, and the last point is always kept.
export function linePath(values: readonly number[], { x, y }: ChartScale, width: number): string {
  const step = Math.max(1, Math.floor(values.length / Math.max(1, width)));
  return values
    .map((cents, i) => ({ cents, i }))
    .filter(({ i }) => i % step === 0 || i === values.length - 1)
    .map(({ cents, i }, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(cents).toFixed(1)}`)
    .join(" ");
}

// The one small control's words: what pressing it does.
export const fitControlWords = (focused: boolean): string => (focused ? "Fit all" : "Focus");
