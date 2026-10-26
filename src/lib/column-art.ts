// The landing page's column (founder, 2026-10-25): the founder's own drawing of a weathered
// Corinthian column (public/landing/column.webp, prepared by scripts/landing-column/build.ts),
// drawn in very fine ASCII by src/components/column-art.tsx. Pure functions, so they're tested.

// The drawing, as the page reads it (its lightness only, so a small greyscale WebP).
export const COLUMN_IMAGE = "/landing/column.webp";

// Light to dark: paper is a space, the darkest ink the densest glyph.
export const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
// Lighter than this is paper.
export const PAPER = 0.94;

export function glyph(lum: number): string {
  if (lum > PAPER) return " ";
  const ink = Math.pow(Math.min(1, Math.max(0, 1 - lum)), 0.8);
  return RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(ink * (RAMP.length - 1))))];
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

// The glyph for each pixel value 0 to 255 (the drawing is grey, so the red channel says it all),
// with the mid-tones deepened: the drawing is pale marble, and at this size light glyphs vanish.
// Built once, so drawing a few hundred thousand pixels costs a table lookup each, not two
// Math.pow calls.
export const GLYPH_BY_BYTE: readonly string[] = Array.from({ length: 256 }, (_, byte) => {
  const v = byte / 255;
  return glyph(v > 0.95 ? v : Math.pow(v, 2.4));
});

// The same as toLines for canvas pixels (RGBA bytes): a lookup per pixel.
export function linesFromRgba(rgba: ArrayLike<number>, cols: number, rows: number): string[] {
  const lines: string[] = new Array(rows);
  const row: string[] = new Array(cols);
  for (let r = 0; r < rows; r++) {
    const base = r * cols * 4;
    for (let c = 0; c < cols; c++) row[c] = GLYPH_BY_BYTE[rgba[base + c * 4]];
    lines[r] = row.join("").replace(/\s+$/, "");
  }
  return lines;
}

// Which rows of the drawing to keep in the page for a screen that has panned `offset` pixels
// (<= 0, from panOffset): the rows on screen plus a band either side, starting on a band
// boundary so the text only changes once a band has scrolled by. Laying out a drawing of
// hundreds of thousands of characters on a phone blocks it for over a second; a window of a few
// hundred rows doesn't.
export const BAND_ROWS = 48;

export function visibleRows(
  offset: number,
  rowHeight: number,
  screenHeight: number,
  totalRows: number,
): { start: number; end: number } {
  const top = Math.max(0, Math.floor(-offset / rowHeight));
  const start = Math.max(0, Math.floor(top / BAND_ROWS) * BAND_ROWS - BAND_ROWS);
  const bottom = top + Math.ceil(screenHeight / rowHeight);
  const end = Math.min(totalRows, (Math.floor(bottom / BAND_ROWS) + 2) * BAND_ROWS);
  return { start, end };
}

// How far to slide the column up so that, as the page scrolls from top (0) to bottom (1), the
// screen moves from its capital down to its base. A column shorter than the screen stays put.
export function panOffset(progress: number, columnHeight: number, screenHeight: number): number {
  const travel = Math.max(0, columnHeight - screenHeight);
  return -Math.min(1, Math.max(0, progress)) * travel;
}
