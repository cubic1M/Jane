import { describe, expect, it } from "vitest";
import { signColor, waveGrid, waveHeight } from "./money-wave";

describe("the landing page's money wave", () => {
  it("uses fewer signs on a phone", () => {
    expect(waveGrid(375)).toEqual({ across: 24, deep: 36 });
    expect(waveGrid(1280)).toEqual({ across: 40, deep: 60 });
  });

  it("rolls between -100 and 100 and moves over time", () => {
    for (const [ix, iy, t] of [
      [0, 0, 0],
      [3, 7, 1.5],
      [39, 59, 100],
    ]) {
      expect(Math.abs(waveHeight(ix, iy, t))).toBeLessThanOrEqual(100);
    }
    expect(waveHeight(5, 5, 0)).not.toBe(waveHeight(5, 5, 1));
  });

  it("keeps every sign a shade of green, in light and dark mode", () => {
    for (const dark of [false, true]) {
      for (const [ix, iy] of [
        [0, 0],
        [10, 20],
        [39, 59],
      ]) {
        const [r, g, b] = signColor(ix, iy, dark);
        expect(g).toBeGreaterThan(r);
        expect(g).toBeGreaterThan(b);
        expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
      }
    }
  });
});
