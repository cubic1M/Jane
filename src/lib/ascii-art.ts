// A picture as ASCII art (the landing page's pillars, founder 2026-10-25): ink becomes characters
// by a luminance ramp, and strong edges become line characters (| - / \) along the edge, so a
// drawing's outlines, flutes and cracks stay crisp. Pure: scripts/pillar-frames.ts runs it at build
// time on the founder's drawing.

export type Gray = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

// Light to dense. A space is paper.
export const RAMP = " .:-=+*#%@";

// A monospace character is about 0.6 of its line height wide.
export const CHAR_ASPECT = 0.6;

export type AsciiOptions = {
  cols: number;
  // Ink below this (0–1) is paper.
  paper?: number;
  // Edge strength (0–1) above which a line character is drawn instead of the ramp's.
  edge?: number;
};

// How many rows a picture of this size takes at `cols` columns.
export const rowsFor = (width: number, height: number, cols: number) =>
  Math.round(height / (width / cols / CHAR_ASPECT));

// A cell's ink: mostly its average, partly its darkest pixel, so a thin line (a crack) through a
// light cell still shows.
function cellInk(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let darkest = 0;
  let n = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      const ink = 1 - g.data[y * g.width + x] / 255;
      sum += ink;
      darkest = Math.max(darkest, ink);
      n++;
    }
  }
  return n === 0 ? 0 : 0.7 * (sum / n) + 0.3 * darkest;
}

// The line character for an edge whose gradient points at `angle` (radians): the edge runs across
// the gradient.
function lineFor(angle: number): string {
  const a = ((angle * 180) / Math.PI + 180) % 180;
  if (a < 22.5 || a >= 157.5) return "|";
  if (a < 67.5) return "\\";
  if (a < 112.5) return "-";
  return "/";
}

export function toAscii(g: Gray, { cols, paper = 0.06, edge = 0.35 }: AsciiOptions): string[] {
  const rows = rowsFor(g.width, g.height, cols);
  const cw = g.width / cols;
  const ch = g.height / rows;
  // Ink per cell, then a Sobel gradient over the cells for the edges.
  const ink: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: number[] = [];
    for (let c = 0; c < cols; c++) {
      line.push(cellInk(g, c * cw, r * ch, (c + 1) * cw, (r + 1) * ch));
    }
    ink.push(line);
  }
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : ink[r][c]);
  const max = Math.max(1e-6, ...ink.flat());
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v = ink[r][c] / max;
      if (v < paper) {
        line += " ";
        continue;
      }
      const gx =
        at(r - 1, c + 1) +
        2 * at(r, c + 1) +
        at(r + 1, c + 1) -
        (at(r - 1, c - 1) + 2 * at(r, c - 1) + at(r + 1, c - 1));
      const gy =
        at(r + 1, c - 1) +
        2 * at(r + 1, c) +
        at(r + 1, c + 1) -
        (at(r - 1, c - 1) + 2 * at(r - 1, c) + at(r - 1, c + 1));
      const strength = Math.hypot(gx, gy) / (4 * max);
      if (strength > edge && v < 0.75) {
        line += lineFor(Math.atan2(gy, gx));
        continue;
      }
      line += RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(v * (RAMP.length - 1)))];
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines;
}
