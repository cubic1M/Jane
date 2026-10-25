// The landing page's pillar, from the founder's drawing of eight Ionic columns (public/landing/
// pillars/pillars-8-stages.webp: 4 x 2, "1. Very Broken" to "8. Almost Perfect"): each column is
// cropped without its caption, scaled to one height, centred on its capital and stood on one base
// line, so a character in one frame is the same place in every other. The crops are saved next
// to the drawing, and each becomes ASCII art in src/content/pillar-frames.ts.
//
//   npm run render:pillars
//
// Uses sharp (installed with Next).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { rowsFor, toAscii } from "../src/lib/ascii-art.ts";

const SOURCE = "public/landing/pillars/pillars-8-stages.webp";
const CELL = 384;
// The drawing's two rows, captions left out.
const ROWS = [
  [0, 470],
  [505, 972],
];
// The frame every column is placed in, and how tall a column is in it.
const WIDTH = 260;
const HEIGHT = 470;
const COLUMN = 452;
const COLS = 90;

async function main() {
  const { data, info } = await sharp(SOURCE)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const ink = (x: number, y: number) => data[y * W + x] < 200;
  const frames: string[] = [];
  for (let i = 0; i < 8; i++) {
    const [top, bottom] = ROWS[Math.floor(i / 4)];
    const left = (i % 4) * CELL;
    // The column's box, and its capital's middle (the top rows), which every stage has.
    let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < left + CELL; x++) {
        if (!ink(x, y)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    let [c0, c1] = [Infinity, -1];
    for (let y = y0; y < y0 + 14; y++) {
      for (let x = left; x < left + CELL; x++) {
        if (!ink(x, y)) continue;
        c0 = Math.min(c0, x);
        c1 = Math.max(c1, x);
      }
    }
    const scale = COLUMN / (y1 - y0 + 1);
    const centre = ((c0 + c1) / 2 - left) * scale;
    const scaledWidth = Math.round(CELL * scale);
    const scaled = await sharp(SOURCE)
      .extract({ left, top: y0, width: CELL, height: y1 - y0 + 1 })
      .resize(scaledWidth, COLUMN)
      .greyscale()
      .png()
      .toBuffer();
    // Into the frame: a window of WIDTH around the capital's middle, standing on the bottom.
    const from = Math.round(centre - WIDTH / 2);
    const cutLeft = Math.max(0, from);
    const cutWidth = Math.min(scaledWidth, from + WIDTH) - cutLeft;
    const window = await sharp(scaled)
      .extract({ left: cutLeft, top: 0, width: cutWidth, height: COLUMN })
      .png()
      .toBuffer();
    const crop = await sharp({
      create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#ffffff" },
    })
      .composite([{ input: window, left: cutLeft - from, top: HEIGHT - COLUMN - 4 }])
      .greyscale()
      .png()
      .toBuffer();
    await sharp(crop).toFile(`public/landing/pillars/stage-${i + 1}.png`);
    const raw = await sharp(crop)
      .flatten({ background: "#ffffff" })
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const lines = toAscii(
      { width: raw.info.width, height: raw.info.height, data: raw.data },
      { cols: COLS },
    );
    frames.push(lines.join("\n"));
    console.log(`stage ${i + 1}: ${lines.length} rows`);
  }
  const rows = rowsFor(WIDTH, HEIGHT, COLS);
  const file = `// The landing page's pillar, from broken to whole: eight frames of ASCII art made by
// scripts/pillar-frames.ts (npm run render:pillars) from the founder's drawing. Generated.

export const PILLAR_COLS = ${COLS};
export const PILLAR_ROWS = ${rows};

export const PILLAR_FRAMES: readonly string[] = ${JSON.stringify(frames, null, 2)};
`;
  writeFileSync("src/content/pillar-frames.ts", file);
  execFileSync("npx", ["prettier", "--write", "src/content/pillar-frames.ts"], { stdio: "ignore" });
}

await main();
