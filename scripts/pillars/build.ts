// Turns the founder's eight pillar drawings (scripts/pillars/source.webp, a 4×2 grid from
// "Very Broken" to "Almost Perfect") into ASCII frames for the landing page's scroll story
// (src/components/pillar-story.tsx). Every frame is cut with the same box, centred on the
// column's axis and standing on its base, so the frames line up character for character.
//
//   node scripts/pillars/build.ts
//
// Writes public/landing/pillar-<cols>.json for each width the page uses.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = join(import.meta.dirname, "source.webp");
const OUT = join(ROOT, "public", "landing");

// The grid: two rows of four drawings, captions under each row.
const BANDS = [
  [8, 470],
  [515, 970],
] as const;
const CELL = 384;
const DARK = 170;

// Light to dark: paper is a space, the darkest ink the densest glyph.
const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
// Monospace glyphs are about 0.6 of their line height wide; the page sets line-height 1.
const CELL_ASPECT = 0.6;
// One shared size every crop is scaled to before sampling.
const NORM = { width: 600, height: 960 };
export const WIDTHS = [96, 150, 220, 300];

type Box = { left: number; top: number; width: number; height: number };

async function boxes(): Promise<Box[]> {
  const { data, info } = await sharp(SOURCE)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const out: Box[] = [];
  for (const [y0, y1] of BANDS) {
    for (let c = 0; c < 4; c++) {
      const x0 = c * CELL;
      let top = Infinity;
      let bottom = -1;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x0 + CELL; x++)
          if (data[y * W + x] < DARK) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      // The column's axis: the middle of the ink across the capital (its top eighth).
      let sum = 0;
      let n = 0;
      for (let y = top; y < top + (bottom - top) / 8; y++)
        for (let x = x0; x < x0 + CELL; x++)
          if (data[y * W + x] < DARK) {
            sum += x;
            n++;
          }
      const axis = sum / n;
      const height = bottom - top + 8;
      const width = Math.round((height * NORM.width) / NORM.height);
      out.push({ left: Math.round(axis - width / 2), top: top - 4, width, height });
    }
  }
  return out;
}

// A cell's glyph: paper stays empty; a little gamma keeps the light hatching visible.
const PAPER = 0.94;
function glyph(lum: number): string {
  if (lum > PAPER) return " ";
  const ink = Math.pow(1 - lum, 0.8);
  return RAMP[Math.min(RAMP.length - 1, Math.round(ink * (RAMP.length - 1)))];
}

// How much darker a stage's cell must be than the whole column's to count as a crack.
const CRACK = 0.35;

// Each stage drawn over the whole column (the last drawing): wherever the stage has stone and so
// does the finished column, it uses the finished column's very glyph, so the parts already
// repaired stay perfectly still from one stage to the next. Only what differs comes from the
// stage's own drawing: gaps where pieces are missing, fragments and rubble outside the column,
// and cracks (much darker than the finished stone).
// Whether a cell, or any of its eight neighbours, has ink.
function nearInk(grey: Buffer, cols: number, rows: number, r: number, c: number): boolean {
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && grey[rr * cols + cc] / 255 <= PAPER)
        return true;
    }
  return false;
}

// Slides a stage by whole cells so its stone lines up best with the finished column's: the
// drawings sit a pixel or two apart, which would make the edges flicker between stages.
function align(stage: Buffer, whole: Buffer, cols: number, rows: number): Buffer {
  let best = { dr: 0, dc: 0, score: -1 };
  for (let dr = -4; dr <= 4; dr++)
    for (let dc = -4; dc <= 4; dc++) {
      let score = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const sr = r - dr;
          const sc = c - dc;
          if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) continue;
          if (stage[sr * cols + sc] / 255 <= PAPER && whole[r * cols + c] / 255 <= PAPER) score++;
        }
      if (score > best.score) best = { dr, dc, score };
    }
  const out = Buffer.alloc(rows * cols, 255);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const sr = r - best.dr;
      const sc = c - best.dc;
      if (sr >= 0 && sr < rows && sc >= 0 && sc < cols) out[r * cols + c] = stage[sr * cols + sc];
    }
  return out;
}

// Each stage drawn over the whole column (the last drawing). Wherever the stage has stone and so
// does the finished column (allowing a cell either way at the edges), it uses the finished
// column's very glyph, so the parts already repaired stay perfectly still from one stage to the
// next. Only what really differs comes from the stage's own drawing: gaps where pieces are
// missing, fragments and rubble away from the column, and cracks (much darker than the stone).
function toAscii(stage: Buffer, whole: Buffer, cols: number, rows: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const a = stage[i] / 255;
      const b = whole[i] / 255;
      const stageHere = a <= PAPER || nearInk(stage, cols, rows, r, c);
      const wholeHere = b <= PAPER || nearInk(whole, cols, rows, r, c);
      if (a <= PAPER && b <= PAPER && b - a >= CRACK) line += glyph(a);
      else if (stageHere && wholeHere) line += glyph(b);
      else if (a <= PAPER) line += glyph(a);
      else line += " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

async function main() {
  const cuts = await boxes();
  mkdirSync(OUT, { recursive: true });
  for (const cols of WIDTHS) {
    const rows = Math.round(cols * (NORM.height / NORM.width) * CELL_ASPECT);
    const greys: Buffer[] = [];
    for (const box of cuts) {
      greys.push(
        await sharp(SOURCE)
          .extract(box)
          .resize(NORM.width, NORM.height, { fit: "fill" })
          .flatten({ background: "#ffffff" })
          .greyscale()
          .sharpen({ sigma: 1 })
          .resize(cols, rows, { fit: "fill", kernel: "lanczos3" })
          .raw()
          .toBuffer(),
      );
    }
    const whole = greys[greys.length - 1];
    const frames = greys.map((grey) => toAscii(align(grey, whole, cols, rows), whole, cols, rows));
    writeFileSync(join(OUT, `pillar-${cols}.json`), JSON.stringify({ cols, rows, frames }));
    console.log(`pillar-${cols}.json: ${cols}×${rows}, ${frames.length} frames`);
  }
}

await main();
