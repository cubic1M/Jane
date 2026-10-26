import { describe, expect, it } from "vitest";
import {
  BAND_ROWS,
  GLYPH_BY_BYTE,
  glyph,
  linesFromRgba,
  PAPER,
  panOffset,
  toLines,
  visibleRows,
} from "./column-art";

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

  it("draws pixel bytes with a table that agrees with the glyph function", () => {
    expect(GLYPH_BY_BYTE).toHaveLength(256);
    for (const byte of [0, 40, 128, 200, 240, 255]) {
      const v = byte / 255;
      expect(GLYPH_BY_BYTE[byte]).toBe(glyph(v > 0.95 ? v : Math.pow(v, 2.4)));
    }
    // RGBA: one dark pixel then two paper, on a one-row drawing.
    const rgba = [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255];
    expect(linesFromRgba(rgba, 3, 1)).toEqual(["$"]);
  });

  it("keeps only the rows near the screen, changing once a band has scrolled by", () => {
    const rows = 1500;
    // At the top: the screen's rows plus a band below.
    expect(visibleRows(0, 3, 900, rows)).toEqual({
      start: 0,
      end: 2 * BAND_ROWS + 288 - (288 % BAND_ROWS),
    });
    // Scrolling a little changes nothing; a whole band does.
    const a = visibleRows(-3 * 10, 3, 900, rows);
    const b = visibleRows(-3 * (BAND_ROWS - 1), 3, 900, rows);
    expect(b.start).toBe(a.start);
    expect(visibleRows(-3 * (BAND_ROWS * 2), 3, 900, rows).start).toBeGreaterThan(a.start);
    // The window always covers the screen and never leaves the drawing.
    for (const offset of [0, -500, -2000, -4400]) {
      const { start, end } = visibleRows(offset, 3, 900, rows);
      const top = Math.floor(-offset / 3);
      expect(start).toBeLessThanOrEqual(top);
      expect(end).toBeGreaterThanOrEqual(Math.min(rows, top + 300));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(rows);
    }
  });
});
