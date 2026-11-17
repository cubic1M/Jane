import { describe, expect, it } from "vitest";
import { MARK_REACH_PX, nearestMark } from "./nearest-mark";

// Mobile pass (11-16): Home's cash-flow markers are 17–28 px and a day apart. A tap on the strip
// near them opens the nearest, so a finger doesn't have to land on the triangle itself.
describe("the marker a tap on the strip opens", () => {
  const marks = [
    { x: 20, y: 70 }, // a bill, below the line
    { x: 31, y: 40 }, // a payday, above it, a day on
    { x: 200, y: 70 },
  ];

  it("is the nearest, above the line a payday and below it a bill", () => {
    expect(nearestMark({ x: 26, y: 72 }, marks)).toBe(0);
    expect(nearestMark({ x: 26, y: 38 }, marks)).toBe(1);
    expect(nearestMark({ x: 190, y: 90 }, marks)).toBe(2);
  });

  it("is none when nothing is within reach", () => {
    expect(nearestMark({ x: 110, y: 56 }, marks)).toBeNull();
    expect(nearestMark({ x: 20, y: 70 + MARK_REACH_PX + 1 }, marks)).toBeNull();
    expect(nearestMark({ x: 0, y: 0 }, [])).toBeNull();
  });
});
