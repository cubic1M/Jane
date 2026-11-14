// The strategy tree's graph maths (./strategy-tree.tsx), pure so it can be tested: where a day
// and a value sit, and the lines through them, broken where a strategy has no value.

// Room for the value labels on the left and the years below.
export const GRAPH_PAD = { left: 38, right: 6, top: 8, bottom: 20 } as const;
const PAD = GRAPH_PAD;

// The lowest and highest values (the axis lines), and where a day and a value sit.
export type GraphScale = {
  lo: number;
  hi: number;
  x: (i: number) => number;
  y: (v: number) => number;
};

// The days fill the width inside the padding; the values fill the height with 5% to spare
// above and below (a range of at least 1, so a flat line still has a scale).
export function graphScale(
  values: readonly number[],
  days: number,
  width: number,
  height: number,
): GraphScale {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1, hi - lo);
  return {
    lo,
    hi,
    x: (i) => PAD.left + (i / Math.max(1, days - 1)) * (width - PAD.left - PAD.right),
    y: (v) =>
      PAD.top + (1 - (v - (lo - span * 0.05)) / (span * 1.1)) * (height - PAD.top - PAD.bottom),
  };
}

// A line's SVG path; a day with no value lifts the pen.
export function gappedPath(values: readonly (number | null)[], { x, y }: GraphScale): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) return void (pen = false);
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}
