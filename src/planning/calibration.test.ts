import { describe, expect, it } from "vitest";
import { bandsOf, offDetectors, type Answered } from "./calibration";

const many = (n: number, rightCount: number, percent: number, detector: string): Answered[] =>
  Array.from({ length: n }, (_, i) => ({ detector, percent, right: i < rightCount }));

describe("is the confidence honest?", () => {
  it("compares what Jane said with how often it was right, by band", () => {
    const bands = bandsOf([...many(10, 8, 82, "a:x"), ...many(10, 5, 55, "b:y")]);
    expect(bands).toEqual([
      { from: 50, to: 60, count: 10, stated: 55, actual: 50 },
      { from: 80, to: 90, count: 10, stated: 82, actual: 80 },
    ]);
    // 100% falls in the top band.
    expect(bandsOf(many(2, 2, 100, "z"))[0]).toMatchObject({ from: 90, to: 100, count: 2 });
  });

  it("lists detectors that run high or low, once there are enough answers", () => {
    const rows = [
      ...many(12, 5, 85, "over:x"),
      ...many(12, 11, 60, "under:x"),
      ...many(12, 10, 85, "fine:x"),
      ...many(4, 0, 90, "few:x"),
    ];
    expect(offDetectors(rows)).toEqual([
      { detector: "over:x", count: 12, stated: 85, actual: 42, direction: "high" },
      { detector: "under:x", count: 12, stated: 60, actual: 92, direction: "low" },
    ]);
  });
});
