import { describe, expect, it } from "vitest";
import { gappedPath, graphScale } from "./strategy-graph";

// The strategy tree's graph maths, as the graph drew it before it moved here.

describe("the strategy graph's scale", () => {
  it("fills the width inside its padding", () => {
    const s = graphScale([100, 200], 5, 344, 128);
    expect([0, 2, 4].map(s.x)).toEqual([38, 188, 338]);
  });

  it("leaves 5% above the highest value and below the lowest", () => {
    const s = graphScale([100, 200], 2, 344, 128);
    expect([s.lo, s.hi]).toEqual([100, 200]);
    // 100 rows of chart (128 less 8 above and 20 below): 110 of range over them.
    expect(s.y(200)).toBeCloseTo(8 + 100 * (5 / 110), 10);
    expect(s.y(100)).toBeCloseTo(8 + 100 * (105 / 110), 10);
    expect(s.y(150)).toBeCloseTo(58, 10);
  });

  it("keeps at least 1 of range for a flat line, which then sits near the bottom", () => {
    const s = graphScale([100, 100, 100], 3, 344, 128);
    expect(s.y(100)).toBeCloseTo(8 + 100 * (1 - 0.05 / 1.1), 10);
  });

  it("puts a single day at the left edge", () => {
    expect(graphScale([100], 1, 344, 128).x(0)).toBe(38);
  });
});

describe("a strategy's line", () => {
  const scale = { lo: 0, hi: 0, x: (i: number) => i * 10, y: (v: number) => v };

  it("joins every day with a value", () => {
    expect(gappedPath([1, 2, 3], scale)).toBe("M0.0 1.0L10.0 2.0L20.0 3.0");
  });

  it("lifts the pen over a day with none", () => {
    expect(gappedPath([1, null, 3, 4], scale)).toBe("M0.0 1.0M20.0 3.0L30.0 4.0");
  });

  it("is empty with no values", () => {
    expect(gappedPath([null, null], scale)).toBe("");
  });
});
