// The net worth chart's drawing maths (./net-worth-chart.tsx), pure so it can be tested: the
// vertical scale that fits the days in view, the big steps that can flatten the rest (taken out of
// the scale, both sides kept), where a day's value sits on the chart, and the line through the days.

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

// A day-to-day change is "a big step" when it is at least this share of the range of the days in
// view (once the bigger steps are taken out), with at least FOCUS_MIN_DAYS days in view; and taking
// the steps out must show the rest at least FOCUS_GAIN times taller, or it is not worth it.
export const STEP_SHARE = 0.6;
// ...and at least this many times the typical (middle) day-to-day move of those days, so the
// largest of a short, jumpy stretch is not taken for a step.
export const STEP_VS_TYPICAL = 6;
export const FOCUS_MIN_DAYS = 5;
export const FOCUS_GAIN = 3;
// The most steps taken out of one view (largest first). A fourth big step: fit all.
export const MAX_BREAKS = 3;

// How long the scale takes to settle on a new fit, in ms (none with reduced motion).
export const SCALE_EASE_MS = 220;

export type Break = {
  // The step lands on this day (an index among the days shown): the first day at the new level.
  index: number;
  // The change, in cents: positive up.
  cents: number;
};

export type Fit = {
  // The highest and lowest values the scale shows, in cents, for the days at its left edge (with
  // no step taken out, for all the days): the scale's labels. 0 with no days.
  top: number;
  bottom: number;
  // The values at the chart's bottom and top edges (inside the padding), in cents.
  lo: number;
  hi: number;
  // The big steps in view, largest first (up to MAX_BREAKS), whether or not they are taken out.
  // None when there are more than MAX_BREAKS.
  breaks: Break[];
  // The steps are taken out of the scale: the days after each are drawn shifted by its amount.
  focused: boolean;
  // What each day is shifted by when drawn, in cents (all 0 unless focused): the sum of the steps
  // up to and including it. A day's true value less this is where it sits on the scale.
  offsets: number[];
};

export type ChartScale = Fit & {
  // A day's place across (by its index among those shown) and a value's place down, in pixels.
  x: (i: number) => number;
  y: (cents: number) => number;
};

const middle = (sorted: readonly number[]) => sorted[Math.floor((sorted.length - 1) / 2)];

// The days' non-zero day-to-day changes (their sizes).
function movesIn(values: readonly number[]): number[] {
  const moves: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const move = Math.abs(values[i] - values[i - 1]);
    if (move > 0) moves.push(move);
  }
  return moves;
}

// The middle of the days' non-zero moves; 0 with fewer than TYPICAL_MOVES_NEEDED.
function typicalMove(values: readonly number[]): number {
  const moves = movesIn(values);
  if (moves.length < TYPICAL_MOVES_NEEDED) return 0;
  return middle(moves.sort((a, b) => a - b));
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

const NONE: Break[] = [];

// The big steps among the days, largest first, each at least STEP_SHARE of the range left once the
// bigger ones are taken out (the days after a step shifted by it). Empty when there are none, when
// there are more than MAX_BREAKS, or when taking them out would not make the rest FOCUS_GAIN times
// taller or leaves nothing that moves.
export function bigSteps(values: readonly number[]): Break[] {
  const n = values.length;
  if (n < FOCUS_MIN_DAYS + 1) return NONE;
  const shifted = values.slice();
  const found: Break[] = [];
  for (;;) {
    const range = Math.max(...shifted) - Math.min(...shifted);
    if (range <= 0) break;
    let at = 1;
    for (let i = 2; i < n; i++) {
      if (Math.abs(shifted[i] - shifted[i - 1]) > Math.abs(shifted[at] - shifted[at - 1])) at = i;
    }
    const cents = shifted[at] - shifted[at - 1];
    if (Math.abs(cents) < STEP_SHARE * range) break;
    if (Math.abs(cents) < STEP_VS_TYPICAL * typicalMove(shifted)) break;
    if (found.length === MAX_BREAKS) return NONE;
    found.push({ index: at, cents });
    for (let i = at; i < n; i++) shifted[i] -= cents;
  }
  if (found.length === 0) return NONE;
  // A line with next to no moves of its own once the steps are out has nothing to show up close.
  if (movesIn(shifted).length < TYPICAL_MOVES_NEEDED) return NONE;
  const whole = fitDays(values);
  const only = fitDays(shifted);
  if ((only.hi - only.lo) * FOCUS_GAIN > whole.hi - whole.lo) return NONE;
  return found;
}

// What each day is shifted by when the steps are taken out of the line.
export function offsetsFor(n: number, breaks: readonly Break[]): number[] {
  const offsets = new Array<number>(n).fill(0);
  for (const b of breaks) for (let i = b.index; i < n; i++) offsets[i] += b.cents;
  return offsets;
}

// What the scale fits: exactly the days in view, with the floor. When focused, with the big steps
// taken out first (both sides of each kept); `focus: false` fits the days as they are, steps and all.
export function fitScale(values: readonly number[], { focus }: { focus: boolean }): Fit {
  const breaks = bigSteps(values);
  if (breaks.length === 0 || !focus) {
    return { ...fitDays(values), breaks, focused: false, offsets: offsetsFor(values.length, []) };
  }
  const offsets = offsetsFor(values.length, breaks);
  return {
    ...fitDays(values.map((v, i) => v - offsets[i])),
    breaks,
    focused: true,
    offsets,
  };
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

// The scale's labels on each side: at the left edge true for the days there, at the right edge true
// for the days there (the same heights, less what the steps in between moved the line). Null on
// the right when no step is taken out (one scale, labelled once).
export function sideLabels(fit: Pick<Fit, "top" | "bottom" | "offsets" | "focused">): {
  left: { high: number; low: number };
  right: { high: number; low: number } | null;
} {
  const left = { high: fit.top, low: fit.bottom };
  const shift = fit.offsets.length ? fit.offsets[fit.offsets.length - 1] : 0;
  if (!fit.focused || shift === 0) return { left, right: null };
  return { left, right: { high: fit.top + shift, low: fit.bottom + shift } };
}

// What the label at a break says, in plain words: "+$5,120 on Nov 3". With the figures hidden,
// only the direction ("A big rise on Nov 3").
export function stepWords(step: Pick<Break, "cents">, day: string, figureShown: boolean): string {
  if (!figureShown) return `A big ${step.cents >= 0 ? "rise" : "drop"} on ${day}`;
  const sign = step.cents >= 0 ? "+" : "−";
  return `${sign}${formatWholeDollars(Math.abs(step.cents))} on ${day}`;
}

// The line's SVG path: at most one vertex per pixel, the last point always kept; a break starts a
// new piece (the day before it and the day itself are always vertices), so there is a gap at each.
export function linePath(values: readonly number[], scale: ChartScale, width: number): string {
  const { x, y, offsets, focused, breaks } = scale;
  const step = Math.max(1, Math.floor(values.length / Math.max(1, width)));
  const starts = new Set(focused ? breaks.map((b) => b.index) : []);
  const keep = (i: number) =>
    i % step === 0 || i === values.length - 1 || starts.has(i) || starts.has(i + 1);
  return values
    .map((cents, i) => ({ cents, i }))
    .filter(({ i }) => keep(i))
    .map(
      ({ cents, i }, k) =>
        `${k === 0 || starts.has(i) ? "M" : "L"}${x(i).toFixed(1)},${y(cents - (offsets[i] ?? 0)).toFixed(1)}`,
    )
    .join(" ");
}

// The one small control's words: what pressing it does.
export const fitControlWords = (focused: boolean): string => (focused ? "Fit all" : "Focus");

// ---- Where each break's label goes -------------------------------------------------------------
// A break's label ("+$5,397 on Sep 28") sits near the top of the chart, and the scale's labels sit
// in the corners: a step in the first or last few days would print the label over a corner figure.

// A box on the chart, in pixels from its top-left corner.
export type Box = { left: number; top: number; width: number; height: number };

export type StepLabelPlace = {
  // The label's anchor point across, in pixels: its left edge, its middle or its right edge.
  x: number;
  // Its top edge.
  y: number;
  anchor: "start" | "middle" | "end";
  // The box it fills (the width given), for checks.
  box: Box;
};

// The break label's text size (11px, no line gap) and padding (4px each side, 2px above and below).
export const STEP_LABEL_FONT = 11;
export const STEP_LABEL_H = STEP_LABEL_FONT + 4;
const STEP_LABEL_PAD_X = 8;
// The scale labels' text size (10px, no line gap).
export const SCALE_LABEL_FONT = 10;
// A digit, "$" or "+" is about 0.6 of the font size wide in the chart's tabular figures, the
// letters a little less; the estimate leans wide (it would rather drop a label a line than print
// it over a figure).
const CHAR_EM = 0.62;
// Space kept clear around every label, in pixels.
const LABEL_CLEAR = 2;
// The space between a break and its label, in pixels.
export const STEP_LABEL_GAP = 6;
// How far each row below the first sits, in pixels (the label's height and a little air).
const ROW = STEP_LABEL_H + 1;

// The width a break label's text takes (padding included), a safe estimate from its length.
export const stepLabelWidth = (text: string): number =>
  Math.ceil([...text].length * STEP_LABEL_FONT * CHAR_EM) + STEP_LABEL_PAD_X;

// The width a scale label's text takes.
export const scaleLabelWidth = (text: string): number =>
  Math.ceil([...text].length * SCALE_LABEL_FONT * CHAR_EM);

const apart = (a: Box, b: Box): boolean =>
  a.left + a.width + LABEL_CLEAR <= b.left ||
  b.left + b.width + LABEL_CLEAR <= a.left ||
  a.top + a.height + LABEL_CLEAR <= b.top ||
  b.top + b.height + LABEL_CLEAR <= a.top;

// Where each break's label goes, by rule. `at` is each break's place across (largest step first),
// `widths` its label's width. For each label, rows from the top (label k starts at row k, so labels
// stack in step order), and within a row: beside the break on the side with more room (the look
// when nothing is in the way), then beside it on the other side, then centred on it. Every try is
// clamped inside the chart, and the first one that touches no corner scale label and no label
// already placed wins; none in a row, and the next row down is tried. With no row free (a very
// short chart), the last row on the roomier side.
export function placeStepLabels(input: {
  at: readonly number[];
  widths: readonly number[];
  width: number;
  height: number;
  // The scale labels' boxes (in the corners).
  corners: readonly Box[];
}): StepLabelPlace[] {
  const { at, widths, width, height, corners } = input;
  const placed: StepLabelPlace[] = [];
  const clampLeft = (left: number, w: number) => Math.max(0, Math.min(left, width - w));
  const make = (left: number, top: number, w: number, anchor: StepLabelPlace["anchor"]) => {
    const box = { left, top, width: w, height: STEP_LABEL_H };
    const x = anchor === "start" ? left : anchor === "end" ? left + w : left + w / 2;
    return { x, y: top, anchor, box } satisfies StepLabelPlace;
  };
  for (let k = 0; k < at.length; k++) {
    const a = at[k];
    const w = widths[k];
    const roomier: "start" | "end" = a > width / 2 ? "end" : "start";
    const beside = (side: "start" | "end", top: number) =>
      make(
        clampLeft(side === "end" ? a - STEP_LABEL_GAP - w : a + STEP_LABEL_GAP, w),
        top,
        w,
        side,
      );
    const tries = (top: number) => [
      beside(roomier, top),
      beside(roomier === "end" ? "start" : "end", top),
      make(clampLeft(a - w / 2, w), top, w, "middle"),
    ];
    const free = (p: StepLabelPlace) =>
      corners.every((c) => apart(p.box, c)) && placed.every((q) => apart(p.box, q.box));
    let found: StepLabelPlace | undefined;
    for (let row = k; !found && row * ROW + STEP_LABEL_H <= height; row++) {
      found = tries(row * ROW).find(free);
    }
    placed.push(found ?? beside(roomier, Math.max(0, height - STEP_LABEL_H)));
  }
  return placed;
}

// The scale labels' boxes as `Scale` draws them (the highest and lowest at the left edge, and at
// the right edge when steps are taken out), for placeStepLabels. Only labels that are drawn: none
// while the figures are hidden, and none whose height is off the chart.
export function scaleLabelBoxes(input: {
  width: number;
  height: number;
  y: (cents: number) => number;
  left: { high: number; low: number };
  right: { high: number; low: number } | null;
  amounts: boolean;
  text: (cents: number) => string;
}): Box[] {
  const { width, height, y, left, right, amounts, text } = input;
  if (!amounts) return [];
  const on = (cents: number) => y(cents) >= 0 && y(cents) <= height;
  const boxes: Box[] = [];
  const add = (shown: number, top: number, side: "left" | "right") => {
    const w = scaleLabelWidth(text(shown));
    boxes.push({
      left: side === "left" ? 2 : width - 2 - w,
      top,
      width: w,
      height: SCALE_LABEL_FONT,
    });
  };
  const above = (cents: number) => Math.max(0, y(cents) - 12);
  const below = (cents: number) => y(cents) + 2;
  if (on(left.high)) add(left.high, above(left.high), "left");
  if (left.low !== left.high && on(left.low)) add(left.low, below(left.low), "left");
  if (right && on(left.high) && on(left.low)) {
    add(right.high, above(left.high), "right");
    add(right.low, below(left.low), "right");
  }
  return boxes;
}
