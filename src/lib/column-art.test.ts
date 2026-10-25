import { describe, expect, it } from "vitest";
import { glyph, PAPER, panOffset, toLines } from "./column-art";

describe("the landing column", () => {
  it("leaves paper empty and draws the darkest ink densest", () => {
    expect(glyph(1)).toBe(" ");
    expect(glyph(PAPER + 0.01)).toBe(" ");
    expect(glyph(0)).toBe("$");
    expect(glyph(0.5)).not.toBe(" ");
  });

  it("turns lightness into lines, trimming the paper at the end", () => {
    expect(toLines([1, 0, 1, 1, 1, 1], 3, 2)).toEqual([" $", ""]);
  });

  it("pans from the capital at the top of the page to the base at the bottom", () => {
    expect(panOffset(0, 4000, 900)).toBeCloseTo(0);
    expect(panOffset(0.5, 4000, 900)).toBe(-1550);
    expect(panOffset(1, 4000, 900)).toBe(-3100);
    expect(panOffset(2, 4000, 900)).toBe(-3100);
    expect(panOffset(1, 700, 900)).toBeCloseTo(0);
  });
});
