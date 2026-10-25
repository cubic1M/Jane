// Builds the landing page's column (src/components/column-art.tsx) from the founder's eight
// drawings (scripts/pillars/source.webp): one realistic Ionic column, cracked near the top and
// whole at the base, in the drawings' own hand. The upper part is the most cracked complete
// drawing (4, "More Repaired"), aligned to the finished one (8), which forms the lower part. The
// two meet along drawing 4's own lowest crack, so the join is a crack that was already there.
// Below it a few fine hairline cracks fade out, and near the top a few angular chips are broken
// off the edges.
//
//   node scripts/pillars/build.ts
//
// Writes public/landing/column.png (greyscale), which the page turns into ASCII.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "..", "..");
const SOURCE = join(import.meta.dirname, "source.webp");
const OUT = join(ROOT, "public", "landing");

// The source grid: two rows of four drawings, captions under each row.
const BANDS = [
  [8, 470],
  [515, 970],
] as const;
const CELL = 384;
const DARK = 170;
// Every drawing is scaled to this working size before it's combined.
const W = 600;
const H = 960;
// The finished column's sides in the working size (the output is cropped to them).
const SIDES = { left: 95, right: 505 };

// Where (0 top, 1 bottom) to look for drawing 4's lowest crack, the join.
const JOIN = { from: 0.5, to: 0.68 };
// Below the join, fine hairline cracks down to here.
const HAIRLINES_TO = 0.8;

type Grey = Uint8Array;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The eight drawings, each cut around its column (centred on the capital's axis, standing on
// its base) and scaled to the working size.
async function drawings(): Promise<Grey[]> {
  const { data, info } = await sharp(SOURCE)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out: Grey[] = [];
  for (const [y0, y1] of BANDS) {
    for (let col = 0; col < 4; col++) {
      const x0 = col * CELL;
      let top = Infinity;
      let bottom = -1;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x0 + CELL; x++)
          if (data[y * info.width + x] < DARK) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      let sum = 0;
      let n = 0;
      for (let y = top; y < top + (bottom - top) / 8; y++)
        for (let x = x0; x < x0 + CELL; x++)
          if (data[y * info.width + x] < DARK) {
            sum += x;
            n++;
          }
      const height = bottom - top + 8;
      const width = Math.round((height * W) / H);
      const grey = await sharp(SOURCE)
        .extract({ left: Math.round(sum / n - width / 2), top: top - 4, width, height })
        .resize(W, H, { fit: "fill", kernel: "lanczos3" })
        .flatten({ background: "#ffffff" })
        .greyscale()
        .raw()
        .toBuffer();
      out.push(new Uint8Array(grey));
    }
  }
  return out;
}

// Slides a drawing by whole pixels so its ink lines up best with the finished column's.
function align(img: Grey, ref: Grey): Grey {
  let best = { dx: 0, dy: 0, score: -1 };
  for (let dy = -12; dy <= 12; dy += 1)
    for (let dx = -12; dx <= 12; dx += 1) {
      let score = 0;
      for (let y = 0; y < H; y += 3)
        for (let x = 0; x < W; x += 3) {
          const sy = y - dy;
          const sx = x - dx;
          if (sy < 0 || sy >= H || sx < 0 || sx >= W) continue;
          if (img[sy * W + sx] < DARK && ref[y * W + x] < DARK) score++;
        }
      if (score > best.score) best = { dx, dy, score };
    }
  const out = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sy = y - best.dy;
      const sx = x - best.dx;
      if (sy >= 0 && sy < H && sx >= 0 && sx < W) out[y * W + x] = img[sy * W + sx];
    }
  return out;
}

// Breaks an angular chip off the stone at (x, y): a three-to-five-sided piece gone to paper,
// with a dark broken edge where it came away.
function chip(img: Grey, next: () => number, cx: number, cy: number, size: number) {
  const sides = 3 + Math.floor(next() * 3);
  const start = next() * Math.PI * 2;
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = start + (i / sides) * Math.PI * 2 + (next() - 0.5) * 0.6;
    const r = size * (0.55 + next() * 0.6);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.3] as const;
  });
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const reach = Math.ceil(size * 2);
  for (let y = cy - reach; y <= cy + reach; y++)
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (y < 0 || y >= H || x < 0 || x >= W) continue;
      const i = y * W + x;
      if (img[i] >= DARK + 40) continue;
      if (inside(x, y)) img[i] = 255;
      else if (inside(x - 2, y) || inside(x + 2, y) || inside(x, y - 2) || inside(x, y + 2))
        img[i] = Math.min(img[i], 40);
    }
}

async function main() {
  const all = await drawings();
  const finished = all[7];
  const next = rand(11);
  const cracked = align(all[3], finished);
  const isCrack = (i: number) => cracked[i] < 100 && finished[i] - cracked[i] > 70;
  // The join: for each x across the column, drawing 4's lowest crack in the window.
  const found: (number | null)[] = Array.from({ length: W }, (_, x) => {
    for (let y = Math.round(JOIN.to * H); y >= Math.round(JOIN.from * H); y--)
      if (isCrack(y * W + x)) return y;
    return null;
  });
  // Fill the gaps from the nearest crack found, then smooth out single-pixel spikes.
  const known = found.flatMap((y, x) => (y === null ? [] : [[x, y] as const]));
  const fallback = Math.round(((JOIN.from + JOIN.to) / 2) * H);
  const seam = found.map((y, x) => {
    if (y !== null) return y;
    let best: readonly [number, number] | null = null;
    for (const k of known) if (!best || Math.abs(k[0] - x) < Math.abs(best[0] - x)) best = k;
    return best ? best[1] : fallback;
  });
  const smooth = seam.map((_, x) => {
    const near = seam.slice(Math.max(0, x - 3), x + 4).sort((a, b) => a - b);
    return near[Math.floor(near.length / 2)] + 2;
  });
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      out[y * W + x] = y < smooth[x] ? cracked[y * W + x] : finished[y * W + x];

  // Fine hairline cracks below the join, fewer and fainter further down.
  const top = Math.round(JOIN.to * H);
  for (let n = 0; n < 4; n++) {
    let y = top + Math.round(next() * (HAIRLINES_TO * H - top) * 0.7);
    let x = 140 + next() * 320;
    const drift = (next() < 0.5 ? -1 : 1) * (0.6 + next() * 0.9);
    const length = 30 + next() * 70;
    const shade = 60 + Math.round(((y / H - JOIN.to) / (HAIRLINES_TO - JOIN.to)) * 80);
    for (let step = 0; step < length && y < HAIRLINES_TO * H; step++) {
      const i = y * W + Math.round(x);
      if (finished[i] < 225) out[i] = Math.min(out[i], shade);
      x += drift + (next() - 0.5) * 1.4;
      y += 1;
    }
  }

  // Chips off the edges, most near the top, none in the lower third.
  for (let y = 20; y < H * 0.55; y += 6) {
    const damage = Math.pow(1 - y / (H * 0.55), 1.4);
    if (next() > damage * 0.32) continue;
    let left = -1;
    let right = -1;
    for (let x = 0; x < W; x++)
      if (out[y * W + x] < DARK) {
        if (left < 0) left = x;
        right = x;
      }
    if (left < 0) continue;
    const x = next() < 0.5 ? left + 2 : right - 2;
    chip(out, next, x, y, 4 + next() * 14 * damage);
  }

  mkdirSync(OUT, { recursive: true });
  await sharp(Buffer.from(out), { raw: { width: W, height: H, channels: 1 } })
    .extract({ left: SIDES.left, top: 0, width: SIDES.right - SIDES.left, height: H })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, "column.png"));
  console.log(`column.png: ${SIDES.right - SIDES.left}×${H}`);
}

await main();
