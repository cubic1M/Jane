import { describe, expect, it } from "vitest";
import { chartScale, linePath, PAD_Y } from "./net-worth-geometry";

// The net worth chart's maths, as the chart drew it before it moved here.

describe("the chart's scale", () => {
  it("fits the values shown into the height, inside the padding", () => {
    const s = chartScale([100_000, 300_000, 200_000], 300, 200);
    expect([s.bottom, s.top]).toEqual([100_000, 300_000]);
    expect(s.lo).toBe(100_000);
    expect(s.hi).toBe(300_000);
    expect(s.y(300_000)).toBe(PAD_Y);
    expect(s.y(100_000)).toBe(200 - PAD_Y);
    expect(s.y(200_000)).toBe(100);
  });

  it("spreads the days across the width", () => {
    const s = chartScale([1, 2, 3, 4, 5], 400, 200);
    expect([0, 1, 4].map(s.x)).toEqual([0, 100, 400]);
  });

  it("puts a single day at the right edge", () => {
    expect(chartScale([500_000], 320, 190).x(0)).toBe(320);
  });

  it("keeps a tiny move from looking like a cliff: at least 1% of the top", () => {
    const s = chartScale([1_000_000, 1_000_500], 300, 200);
    expect(s.hi - s.lo).toBe(10_005);
    expect(s.lo + s.hi).toBe(2_000_500);
  });

  it("and at least $1 when the values are flat or small", () => {
    const flat = chartScale([2_000, 2_000], 300, 200);
    expect([flat.lo, flat.hi]).toEqual([1_950, 2_050]);
    expect(flat.y(2_000)).toBe(100);
    const none = chartScale([], 300, 200);
    expect([none.bottom, none.top]).toEqual([0, 0]);
    expect([none.lo, none.hi]).toEqual([-50, 50]);
  });

  it("works below zero", () => {
    const s = chartScale([-50_000, 50_000], 100, 128);
    expect([s.lo, s.hi]).toEqual([-50_000, 50_000]);
    expect(s.y(0)).toBe(64);
  });
});

describe("the line", () => {
  it("joins every day when there's a pixel for each", () => {
    const values = [100, 300, 200];
    expect(linePath(values, chartScale(values, 200, 128), 200)).toBe(
      "M0.0,114.0 L100.0,14.0 L200.0,64.0",
    );
  });

  it("keeps one vertex per pixel, and always the last day", () => {
    const values = Array.from({ length: 10 }, (_, i) => i * 100);
    const path = linePath(values, chartScale(values, 3, 128), 3);
    // 10 days over 3 pixels: every 3rd day, then the last.
    expect(path.split(" ").map((p) => p.split(",")[0].slice(1))).toEqual([
      "0.0",
      "1.0",
      "2.0",
      "3.0",
    ]);
    expect(path.split(" ")).toHaveLength(4);
  });

  it("is empty with no days", () => {
    expect(linePath([], chartScale([], 300, 200), 300)).toBe("");
  });
});
