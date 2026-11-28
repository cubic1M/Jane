// The net worth chart's drawing maths (./net-worth-chart.tsx), pure so it can be tested. One rule,
// like a stock app's chart: the vertical scale fits exactly the days on screen (the lowest to the
// highest, a little padding each side), so whatever is in view fills the height. Nothing about big
// changes is special: a window with a big drop covers it, and zooming past it tightens the scale.

// Room above the highest point and below the lowest, in pixels (the chart's edge).
export const PAD_Y = 14;
// The padding on each side of the days' own range, as a share of that range (9%).
export const PAD_SHARE = 0.09;
// The least the scale's range spans, in cents ($6): a flat stretch (every day equal) is a line in
// the middle with $3 either side, and a $2 wobble is not blown up into a cliff.
export const MIN_SPAN_CENTS = 600;
// The axis labels: about this many, and the most.
export const TICKS_WANTED = 4;
// How long the scale takes to settle on a new fit, in ms (none with reduced motion).
export const SCALE_EASE_MS = 220;

export type Fit = {
  // The lowest and highest day in view, in cents (0 with no days).
  bottom: number;
  top: number;
  // The values at the chart's bottom and top edges (inside PAD_Y), in cents: the days' range with
  // the padding, never narrower than MIN_SPAN_CENTS.
  lo: number;
  hi: number;
};

export type ChartScale = Fit & {
  // A day's place across (by its index among those shown) and a value's place down, in pixels.
  x: (i: number) => number;
  y: (cents: number) => number;
};

// The scale for the days in view (the two edge days, where the line enters and leaves, included).
export function fitScale(values: readonly number[]): Fit {
  let top = values.length ? values[0] : 0;
  let bottom = top;
  for (const v of values) {
    if (v > top) top = v;
    if (v < bottom) bottom = v;
  }
  const span = Math.max(top - bottom, MIN_SPAN_CENTS);
  const mid = (top + bottom) / 2;
  const half = span * (0.5 + PAD_SHARE);
  return { top, bottom, lo: mid - half, hi: mid + half };
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

export function chartScale(values: readonly number[], width: number, height: number): ChartScale {
  const fit = fitScale(values);
  return { ...fit, ...scaleAt(fit, values.length, width, height) };
}

// The axis labels for a range: whole-dollar steps of 1, 2 or 5 times a power of ten, about
// TICKS_WANTED of them (3 to 5 when the range allows), so the labels differ at every size.
export function niceTicks(lo: number, hi: number): number[] {
  const dollars = (hi - lo) / 100;
  if (!(dollars > 0)) return [];
  let best: { step: number; count: number } | null = null;
  for (let power = 1; power <= 1e12; power *= 10) {
    for (const mult of [1, 2, 5]) {
      const step = mult * power * 100;
      const count = Math.floor(hi / step) - Math.ceil(lo / step) + 1;
      if (count < 1) continue;
      if (!best || Math.abs(count - TICKS_WANTED) < Math.abs(best.count - TICKS_WANTED)) {
        best = { step, count };
      }
    }
    if (power * 100 > dollars * 100) break;
  }
  if (!best) return [];
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / best.step) * best.step; t <= hi; t += best.step) ticks.push(t);
  return ticks;
}

// The line's SVG path: about one vertex per pixel. Where several days share a pixel, the lowest
// and the highest of them are kept (in order), so an isolated drop or spike is never thinned away;
// the first and last day are always kept.
export function linePath(values: readonly number[], scale: ChartScale, width: number): string {
  const { x, y } = scale;
  const n = values.length;
  const step = Math.max(1, Math.floor(n / Math.max(1, width)));
  const keep = new Set<number>(n ? [0, n - 1] : []);
  for (let start = 0; start < n; start += step) {
    let lo = start;
    let hi = start;
    for (let i = start; i < Math.min(n, start + step); i++) {
      if (values[i] < values[lo]) lo = i;
      if (values[i] > values[hi]) hi = i;
    }
    keep.add(lo);
    keep.add(hi);
  }
  return [...keep]
    .sort((a, b) => a - b)
    .map((i, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`)
    .join(" ");
}
