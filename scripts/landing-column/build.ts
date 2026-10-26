// Prepares the founder's column drawing (scripts/landing-column/source.jpg, 2026-10-25) for the
// landing page, which draws it in very fine ASCII (src/components/column-art.tsx): cuts it to
// the column (dropping the empty paper around it), makes it greyscale, and lifts the faintest
// paper tones to pure white so they become spaces.
//
//   node scripts/landing-column/build.ts
//
// Writes public/landing/column.webp: the page only reads its lightness, so a lossy greyscale WebP
// (about 56 kB, against 324 kB as a colour PNG) draws the same ASCII and is quick on a phone.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = join(import.meta.dirname, "source.jpg");
const OUT = join(ROOT, "public", "landing");
// Darker than this is ink.
const INK = 200;
const MARGIN = 6;

async function main() {
  const { data, info } = await sharp(SOURCE)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[y * info.width + x] < INK) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  const box = {
    left: Math.max(0, left - MARGIN),
    top: Math.max(0, top - MARGIN),
    width: Math.min(info.width, right + MARGIN) - Math.max(0, left - MARGIN),
    height: Math.min(info.height, bottom + MARGIN) - Math.max(0, top - MARGIN),
  };
  mkdirSync(OUT, { recursive: true });
  await sharp(SOURCE)
    .extract(box)
    .greyscale()
    // Paper to pure white: anything this light is background.
    .linear(1.08, -4)
    .webp({ quality: 80, effort: 6, smartSubsample: false })
    .toFile(join(OUT, "column.webp"));
  console.log(`column.webp: ${box.width}×${box.height} (from ${box.left},${box.top})`);
}

await main();
