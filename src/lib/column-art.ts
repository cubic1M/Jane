// The landing page's column (founder, 2026-10-25): a realistic Ionic column in fine ASCII,
// cracked near the top and whole at the base (made from the founder's drawings by
// scripts/pillars/build.ts). Pure functions, so they're tested; the drawing is
// src/components/column-art.tsx.

// Light to dark: paper is a space, the darkest ink the densest glyph.
export const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
// Lighter than this is paper.
export const PAPER = 0.93;

export function glyph(lum: number): string {
  if (lum > PAPER) return " ";
  const ink = Math.pow(1 - lum, 0.8);
  return RAMP[Math.min(RAMP.length - 1, Math.round(ink * (RAMP.length - 1)))];
}

// Pixel lightness (0 dark to 1 paper), row by row, as lines of glyphs, trailing paper trimmed.
export function toLines(lum: ArrayLike<number>, cols: number, rows: number): string[] {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) line += glyph(lum[r * cols + c]);
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines;
}

// How far to slide the column up so that, as the page scrolls from top (0) to bottom (1), the
// screen moves from its capital down to its base. A column shorter than the screen stays put.
export function panOffset(progress: number, columnHeight: number, screenHeight: number): number {
  const travel = Math.max(0, columnHeight - screenHeight);
  return -Math.min(1, Math.max(0, progress)) * travel;
}
