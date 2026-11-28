import { describe, expect, it } from "vitest";
import {
  MIN_SPAN_CENTS,
  PAD_SHARE,
  PAD_Y,
  chartScale,
  fitScale,
  linePath,
  niceTicks,
} from "./net-worth-geometry";
import { formatWholeDollars } from "@/lib/money";

// The net worth chart's vertical scale (founder, Nov 28: when I zoom into a stretch where I spend
// $45 and $128, the line is flat because a bigger drop elsewhere sets the scale; the axis must
// follow what is on screen).

const HEIGHT = 260;
const WIDTH = 600;
const PLOT = HEIGHT - PAD_Y * 2;
// How much of the plot's height the line takes, 0 to 1.
const share = (values: readonly number[]) => {
  const s = chartScale(values, WIDTH, HEIGHT);
  const ys = values.map((v) => s.y(v));
  return (Math.max(...ys) - Math.min(...ys)) / PLOT;
};

// Ordinary days of -$45, -$128, +$60, -$12 around $30,000, a -$18,000 day, more ordinary days,
// and a +$9,000 day.
const DROP = -1_800_000;
const ordinary = (from: number, n: number) => {
  const moves = [-4_500, -12_800, 6_000, -1_200];
  const out: number[] = [];
  let v = from;
  for (let i = 0; i < n; i++) out.push((v += moves[i % moves.length]));
  return out;
};
const before = ordinary(3_000_000, 10);
const afterDrop = before[before.length - 1] + DROP;
const small = ordinary(afterDrop, 12);
const rise = small[small.length - 1] + 900_000;
const history = [...before, afterDrop, ...small, rise, ...ordinary(rise, 5)];

describe("the range for the visible window", () => {
  it("covers the lowest to the highest day, with padding each side", () => {
    const s = fitScale([100_000, 300_000, 200_000]);
    expect([s.bottom, s.top]).toEqual([100_000, 300_000]);
    expect(s.lo).toBeCloseTo(100_000 - 200_000 * PAD_SHARE);
    expect(s.hi).toBeCloseTo(300_000 + 200_000 * PAD_SHARE);
  });

  it("a window with the big drop covers the drop (honest)", () => {
    const s = fitScale(history.slice(5, 14));
    expect(s.hi - s.lo).toBeGreaterThan(Math.abs(DROP));
    expect(s.bottom).toBeLessThanOrEqual(afterDrop);
  });

  it("the window after the drop, with only small moves, fills the height", () => {
    const window = history.slice(11, 23);
    const spread = Math.max(...window) - Math.min(...window);
    expect(spread).toBeLessThan(40_000);
    expect(share(window)).toBeGreaterThan(0.75);
    const s = fitScale(window);
    expect(s.hi - s.lo).toBeLessThan(spread * 1.25);
  });

  it("zooming past the drop tightens the scale again", () => {
    const wide = fitScale(history.slice(0, 20));
    const tight = fitScale(history.slice(11, 20));
    expect(tight.hi - tight.lo).toBeLessThan((wide.hi - wide.lo) / 10);
  });

  it("a flat window is a line in the middle with a few dollars either side", () => {
    const s = chartScale(Array(8).fill(1_234_500), WIDTH, HEIGHT);
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(MIN_SPAN_CENTS);
    expect((s.hi + s.lo) / 2).toBe(1_234_500);
    expect(s.y(1_234_500)).toBe(HEIGHT / 2);
  });

  it("a single day is flat too, and no days is finite", () => {
    const one = chartScale([500_000], 320, 190);
    expect(one.x(0)).toBe(320);
    expect(one.y(500_000)).toBe(95);
    const none = chartScale([], 300, 200);
    expect([none.bottom, none.top]).toEqual([0, 0]);
    expect(Number.isFinite(none.y(0))).toBe(true);
  });

  it("window edges between two points: both edge days are inside the plot and fill it", () => {
    const edge = history.slice(10, 12);
    const s = chartScale(edge, WIDTH, HEIGHT);
    for (const v of edge) {
      expect(s.y(v)).toBeGreaterThanOrEqual(PAD_Y);
      expect(s.y(v)).toBeLessThanOrEqual(HEIGHT - PAD_Y);
    }
    expect(share(edge)).toBeGreaterThan(0.75);
  });

  it("works below zero", () => {
    const s = chartScale([-50_000, 50_000], 100, 128);
    expect(s.y(0)).toBe(64);
  });

  it("spreads the days across the width", () => {
    const s = chartScale([1, 2, 3, 4, 5], 400, 200);
    expect([0, 1, 4].map(s.x)).toEqual([0, 100, 400]);
  });
});

describe("the axis labels", () => {
  it("are 3 to 5 whole-dollar ticks, all different, inside the range, at any zoom", () => {
    for (const w of [history, history.slice(11, 23), history.slice(11, 14), Array(5).fill(900)]) {
      const s = fitScale(w);
      const ticks = niceTicks(s.lo, s.hi);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(5);
      const text = ticks.map(formatWholeDollars);
      expect(new Set(text).size).toBe(text.length);
      for (const t of ticks) expect(t >= s.lo && t <= s.hi).toBe(true);
    }
  });

  it("a small range shows enough digits to tell the ticks apart", () => {
    const ticks = niceTicks(1_232_000, 1_243_000);
    const text = ticks.map(formatWholeDollars);
    expect(new Set(text).size).toBe(text.length);
    expect(text.every((t) => /^\$12,\d{3}$/.test(t))).toBe(true);
  });

  it("none for an empty range", () => {
    expect(niceTicks(5, 5)).toEqual([]);
  });
});

describe("the line", () => {
  it("joins every day when there's a pixel for each, in one piece", () => {
    const values = [10_000, 30_000, 20_000];
    const path = linePath(values, chartScale(values, 200, 128), 200);
    expect(path.split(" ")).toHaveLength(3);
    expect(path.startsWith("M0.0,")).toBe(true);
    expect(path.match(/M/g)).toHaveLength(1);
  });

  it("keeps the first and last day, and thins a long history to about two vertices a pixel", () => {
    const values = Array.from({ length: 1_000 }, (_, i) => i * 10_000);
    const path = linePath(values, chartScale(values, 100, 128), 100);
    expect(path.split(" ").length).toBeLessThanOrEqual(2 * 100 + 2);
    expect(path.startsWith("M0.0,")).toBe(true);
    expect(path.split(" ").at(-1)).toMatch(/^L100\.0,/);
  });

  it("never thins away an isolated drop", () => {
    const values = Array(1_200).fill(3_000_000);
    values[601] = 1_200_000;
    const scale = chartScale(values, 600, 260);
    const ys = linePath(values, scale, 600)
      .split(" ")
      .map((p) => Number(p.split(",")[1]));
    expect(Math.max(...ys)).toBeCloseTo(scale.y(1_200_000), 1);
  });

  it("is empty with no days", () => {
    expect(linePath([], chartScale([], 300, 200), 300)).toBe("");
  });
});
