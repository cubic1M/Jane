import { describe, expect, it } from "vitest";
import {
  damageAt,
  draw,
  glyph,
  HEIGHT,
  PAPER,
  panOffset,
  stone,
  toLines,
  weather,
  WHOLE_FROM,
} from "./column-art";

describe("the landing column's shape", () => {
  it("is stone on its axis from capital to plinth, and paper beyond its widest point", () => {
    for (const y of [0.05, 0.5, 2, 4, 6.1, 6.8]) expect(stone(0, y)).toBeLessThanOrEqual(PAPER);
    expect(stone(1.2, 3)).toBe(1);
    expect(stone(0, -0.1)).toBe(1);
    expect(stone(0, HEIGHT + 0.1)).toBe(1);
  });

  it("has volutes wider than the shaft, and a plinth wider than both", () => {
    expect(stone(0.85, 0.47)).toBeLessThanOrEqual(PAPER);
    expect(stone(0.6, 3)).toBe(1);
    expect(stone(0.74, 6.8)).toBeLessThanOrEqual(PAPER);
  });
});

describe("the landing column's weathering", () => {
  const grid = () => draw(200, 700, 100, 100, 100);

  it("is worst at the top, easing to none from WHOLE_FROM down", () => {
    expect(damageAt(0)).toBe(1);
    expect(damageAt(0.3)).toBeGreaterThan(damageAt(0.6));
    expect(damageAt(WHOLE_FROM)).toBe(0);
  });

  it("breaks and cracks the top, and leaves the bottom whole", () => {
    const { top, bottom } = weather(grid(), 7);
    expect(top).toBeGreaterThan(500);
    expect(bottom).toBe(0);
  });

  it("never adds stone outside the column: nothing floats free", () => {
    const g = grid();
    const before = g.lum.slice();
    weather(g, 7);
    for (let i = 0; i < g.lum.length; i++) if (before[i] > PAPER) expect(g.lum[i]).toBe(before[i]);
  });

  it("is the same on every visit", () => {
    const [a, b] = [grid(), grid()];
    weather(a, 7);
    weather(b, 7);
    expect(toLines(a.lum, a.cols, a.rows)).toEqual(toLines(b.lum, b.cols, b.rows));
  });
});

describe("drawing it", () => {
  it("leaves paper empty and draws the darkest ink densest", () => {
    expect(glyph(1)).toBe(" ");
    expect(glyph(0)).toBe("$");
    expect(glyph(0.5)).not.toBe(" ");
  });

  it("pans from the capital at the top of the page to the base at the bottom", () => {
    expect(panOffset(0, 4000, 900)).toBeCloseTo(0);
    expect(panOffset(1, 4000, 900)).toBe(-3100);
    expect(panOffset(2, 4000, 900)).toBe(-3100);
    expect(panOffset(1, 700, 900)).toBeCloseTo(0);
  });
});
