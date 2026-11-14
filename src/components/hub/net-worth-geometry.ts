// The net worth chart's drawing maths (./net-worth-chart.tsx), pure so it can be tested: where a
// day's value sits on the chart, and the line through the days.

// Room above the highest point and below the lowest, in pixels.
export const PAD_Y = 14;

export type ChartScale = {
  // The highest and lowest values shown (0 with none), in cents: the scale's labels.
  top: number;
  bottom: number;
  // The values at the chart's bottom and top edges (inside the padding), in cents.
  lo: number;
  hi: number;
  // A day's place across (by its index among those shown) and a value's place down, in pixels.
  x: (i: number) => number;
  y: (cents: number) => number;
};

// The days shown fill the width; the values fill the height. A tiny move stays visible but isn't
// blown up into a cliff: the range is at least 1% of the top value, and at least $1.
export function chartScale(values: readonly number[], width: number, height: number): ChartScale {
  const top = values.length ? Math.max(...values) : 0;
  const bottom = values.length ? Math.min(...values) : 0;
  const span = Math.max(top - bottom, Math.abs(top) * 0.01, 100);
  const mid = (top + bottom) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const n = values.length;
  return {
    top,
    bottom,
    lo,
    hi,
    x: (i) => (n < 2 ? width : (i / (n - 1)) * width),
    y: (v) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (height - PAD_Y * 2),
  };
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
