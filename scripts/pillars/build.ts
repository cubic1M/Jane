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
export const WIDTHS = [72, 110, 160];

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

function toAscii(grey: Buffer, cols: number, rows: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const lum = grey[r * cols + c] / 255;
      // Paper stays empty; a little gamma keeps the light hatching visible.
      const ink = lum > 0.94 ? 0 : Math.pow(1 - lum, 0.8);
      line += RAMP[Math.min(RAMP.length - 1, Math.round(ink * (RAMP.length - 1)))];
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
    const frames: string[] = [];
    for (const box of cuts) {
      const grey = await sharp(SOURCE)
        .extract(box)
        .resize(NORM.width, NORM.height, { fit: "fill" })
        .flatten({ background: "#ffffff" })
        .greyscale()
        .sharpen({ sigma: 1 })
        .resize(cols, rows, { fit: "fill", kernel: "lanczos3" })
        .raw()
        .toBuffer();
      frames.push(toAscii(grey, cols, rows));
    }
    writeFileSync(join(OUT, `pillar-${cols}.json`), JSON.stringify({ cols, rows, frames }));
    console.log(`pillar-${cols}.json: ${cols}×${rows}, ${frames.length} frames`);
  }
}

await main();
