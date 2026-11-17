import { describe, expect, it } from "vitest";
import { moreBeyond } from "./scroll-edges";

// The area tabs on a phone fade at an edge only where there is more of the row that way.
describe("more of a sideways row beyond its edges", () => {
  it("fades the end at the start, both in the middle, and the start at the end", () => {
    expect(moreBeyond(0, 375, 900)).toEqual({ before: false, after: true });
    expect(moreBeyond(200, 375, 900)).toEqual({ before: true, after: true });
    expect(moreBeyond(525, 375, 900)).toEqual({ before: true, after: false });
  });

  it("doesn't fade a row that fits, nor for a pixel of rounding", () => {
    expect(moreBeyond(0, 1024, 900)).toEqual({ before: false, after: false });
    expect(moreBeyond(0.5, 375, 375.5)).toEqual({ before: false, after: false });
  });
});
