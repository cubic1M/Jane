import { describe, expect, it } from "vitest";
import { goalOnTrack, goalsOnTrack } from "./goals";

// Gate B: one rule for "N of M goals on track" on Home, the Money page, the money hub and the tree.
describe("goals on track", () => {
  it("is a goal on the way and in time with the others counted", () => {
    expect(goalOnTrack({ status: "on_the_way" })).toBe(true);
    expect(goalOnTrack({ status: "on_the_way", lateMonths: 0 })).toBe(true);
    expect(goalOnTrack({ status: "on_the_way", lateMonths: 3 })).toBe(false);
    expect(goalOnTrack({ status: "date_passed" })).toBe(false);
    expect(goalOnTrack({ status: "reached" })).toBe(false);
  });

  it("counts of the goals not reached yet, and says how many are", () => {
    expect(
      goalsOnTrack([
        { status: "reached" },
        { status: "on_the_way" },
        { status: "on_the_way", lateMonths: 2 },
        { status: "date_passed" },
      ]),
    ).toEqual({ onTrack: 1, total: 3, reached: 1 });
  });
});
