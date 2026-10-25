// The landing page's column (founder, 2026-10-25), built from scratch: an Ionic column modelled
// in code and lit like stone (a fluted shaft, a scrolled capital with an egg-and-dart band, a
// moulded base on a plinth), then weathered: badly cracked with pieces broken away at the top,
// less and less further down, and perfect at the base. Drawn as very fine ASCII by
// src/components/column-art.tsx. Pure functions, so they're tested.

// Light to dark: paper is a space, the darkest ink the densest glyph.
export const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
// Lighter than this is paper.
export const PAPER = 0.97;

export function glyph(lum: number): string {
  if (lum > PAPER) return " ";
  const ink = Math.pow(Math.min(1, Math.max(0, 1 - lum)), 0.85);
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

// How far to slide the column up so that, as the page scrolls from top (0) to bottom (1), the
// screen moves from its capital down to its base. A column shorter than the screen stays put.
export function panOffset(progress: number, columnHeight: number, screenHeight: number): number {
  const travel = Math.max(0, columnHeight - screenHeight);
  return -Math.min(1, Math.max(0, progress)) * travel;
}

// --- The column's shape --------------------------------------------------------------------
// Measured in the shaft's lower diameter (D): x across from the axis, y down from the top.

// The column's height in diameters: an Ionic column, a little stocky so it reads as stone.
export const HEIGHT = 7;
// Its widest point, the volutes, from the axis.
export const HALF_WIDTH = 0.92;

const SHAFT = { top: 0.74, bottom: 5.95 };
const FLUTES = 24;

// Light from the upper left, a little in front.
const LIGHT = (() => {
  const v = [-0.55, -0.42, 0.72];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

function lit(nx: number, ny: number, nz: number): number {
  const n = Math.hypot(nx, ny, nz) || 1;
  const d = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / n;
  return 0.2 + 0.78 * Math.max(0, d);
}

// A round part (ring, fillet): lit as a cylinder, with a drawn outline at the silhouette.
function round(x: number, radius: number, slope: number): number | null {
  const u = x / radius;
  if (Math.abs(u) >= 1) return null;
  const nz = Math.sqrt(1 - u * u);
  let lum = lit(u, -slope * 3, nz);
  if (Math.abs(u) > 0.965) lum *= 0.35;
  return lum;
}

// A torus: a bulging ring between y0 and y1.
function torus(x: number, y: number, y0: number, y1: number, base: number, bulge: number) {
  const h = (y1 - y0) / 2;
  const t = (y - (y0 + h)) / h;
  const r = base + bulge * Math.sqrt(Math.max(0, 1 - t * t));
  const slope = (-bulge * t) / (h * Math.sqrt(Math.max(0.02, 1 - t * t)));
  const lum = round(x, r, slope);
  if (lum === null) return null;
  // A dark line where rings meet.
  return Math.abs(t) > 0.93 ? lum * 0.45 : lum;
}

// A square block (abacus, plinth): a flat front with a lit top edge and dark outlines.
function block(x: number, y: number, y0: number, y1: number, half: number) {
  if (Math.abs(x) > half) return null;
  const v = (y - y0) / (y1 - y0);
  if (v < 0.06) return 0.94;
  if (v > 0.95 || half - Math.abs(x) < 0.012) return 0.22;
  return 0.66 + 0.1 * (-x / half);
}

// The fluted shaft: 24 concave flutes between narrow flat fillets, the flutes ending in rounded
// tops and bottoms a little short of the shaft's ends.
function shaft(x: number, y: number) {
  const t = (y - SHAFT.top) / (SHAFT.bottom - SHAFT.top);
  // Entasis: the shaft narrows a touch towards the top.
  const r = 0.5 - 0.075 * Math.pow(1 - t, 1.6);
  const u = x / r;
  if (Math.abs(u) >= 1) return null;
  const angle = Math.asin(u);
  const span = (2 * Math.PI) / FLUTES;
  const local = ((((angle + Math.PI) / span) % 1) + 1) % 1;
  const ends = Math.min(y - SHAFT.top, SHAFT.bottom - y);
  // How far into a flute's rounded end, near the shaft's ends.
  const cap = Math.max(0, 1 - ends / 0.14);
  const width = 0.82 * Math.sqrt(Math.max(0, 1 - cap * cap));
  let tilt = 0;
  let occlusion = 1;
  if (local > (1 - width) / 2 && local < (1 + width) / 2) {
    const g = (local - 0.5) / (width / 2);
    tilt = -g * 0.9;
    occlusion = 0.82 + 0.18 * Math.abs(g);
  }
  const a = angle + tilt;
  let lum = lit(Math.sin(a), 0.02, Math.cos(a)) * occlusion;
  if (Math.abs(u) > 0.97) lum *= 0.35;
  return lum;
}

// A volute: a scroll seen face on, its groove winding three times into the eye.
function volute(x: number, y: number, cx: number, cy: number, radius: number, side: number) {
  const dx = (x - cx) * side;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d > radius) return null;
  if (d < radius * 0.12) return d > radius * 0.09 ? 0.15 : 0.7;
  const k = Math.log(1 / 0.12) / (3 * 2 * Math.PI);
  const theta = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
  let phase = -1;
  for (let n = 0; n < 4; n++) {
    const outer = radius * Math.exp(-k * (theta + 2 * Math.PI * n));
    const inner = radius * Math.exp(-k * (theta + 2 * Math.PI * (n + 1)));
    if (d <= outer && d > inner) {
      phase = (outer - d) / (outer - inner);
      break;
    }
  }
  if (phase < 0) return 0.6;
  // The groove, then the rolled band: lit on its upper left, shadowed below.
  if (phase < 0.14) return 0.12;
  const roll = Math.sin(Math.PI * ((phase - 0.14) / 0.86));
  const facing = -(dx * side * LIGHT[0] + dy * LIGHT[1]) / d;
  return 0.35 + 0.5 * roll * (0.6 + 0.4 * facing);
}

// The echinus: a band of eggs between darts, round the top of the shaft.
function echinus(x: number, y: number, y0: number, y1: number) {
  const u = x / 0.57;
  if (Math.abs(u) >= 1) return null;
  const angle = Math.asin(u);
  const span = (2 * Math.PI) / 16;
  const local = ((((angle + Math.PI) / span) % 1) + 1) % 1;
  const v = (y - y0) / (y1 - y0);
  const base = lit(u, 0, Math.sqrt(1 - u * u));
  const ex = (local - 0.5) / 0.34;
  const ey = (v - 0.45) / 0.42;
  const e = ex * ex + ey * ey;
  if (e < 1) return Math.min(1, base * (0.45 + 0.6 * lit(ex * 0.8, ey * 0.8, Math.sqrt(1 - e))));
  if (e < 1.25) return base * 0.25;
  if ((local < 0.04 || local > 0.96) && v < 0.85) return base * 0.15;
  return base * 0.55;
}

// The stone's lightness at a point, before weathering: 1 is paper (outside the column).
export function stone(x: number, y: number): number {
  if (y < 0 || y > HEIGHT) return 1;
  // Capital: abacus, the volutes, the channel between them, the echinus, a bead.
  if (y < 0.15) return block(x, y, 0, 0.15, 0.8) ?? 1;
  for (const side of [-1, 1]) {
    const v = volute(x, y, side * 0.6, 0.47, 0.3, side);
    if (v !== null) return v;
  }
  if (y < 0.4) {
    if (Math.abs(x) > 0.62) return 1;
    const v = (y - 0.15) / 0.25;
    return v > 0.92 ? 0.25 : 0.62 - 0.18 * v;
  }
  if (y < 0.66) return echinus(x, y, 0.4, 0.66) ?? 1;
  if (y < SHAFT.top) return torus(x, y, 0.66, SHAFT.top, 0.47, 0.05) ?? 1;
  if (y < SHAFT.bottom) return shaft(x, y) ?? 1;
  // Base: a fillet, upper torus, the hollow scotia, lower torus, then the plinth.
  if (y < 6.02) return round(x, 0.53, 0) ?? 1;
  if (y < 6.18) return torus(x, y, 6.02, 6.18, 0.52, 0.07) ?? 1;
  if (y < 6.33) {
    const t = (y - 6.18) / 0.15;
    const r = 0.53 - 0.05 * Math.sin(Math.PI * t);
    const lum = round(x, r, 0.1 * Math.PI * Math.cos(Math.PI * t));
    return lum === null ? 1 : lum * 0.7;
  }
  if (y < 6.56) return torus(x, y, 6.33, 6.56, 0.6, 0.1) ?? 1;
  return block(x, y, 6.56, HEIGHT, 0.76) ?? 1;
}

// --- Weathering ----------------------------------------------------------------------------

// From this far down (as a share of the column's height) the column is whole.
export const WHOLE_FROM = 0.78;

// How damaged the column is at a height (0 top, 1 bottom): 1 at the top, none from WHOLE_FROM.
export function damageAt(t: number): number {
  return Math.pow(Math.max(0, 1 - t / WHOLE_FROM), 1.15);
}

// A small seeded random generator (mulberry32), so the column is the same on every visit.
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A grid of cells for the column: lightness per cell, and how many cells make one diameter
// across (dc) and down (dr): cells are taller than they're wide.
export type Grid = { cols: number; rows: number; lum: Float32Array; dc: number; dr: number };

// Fills a grid with the column, its axis at cell column `axis`. Stone gets a faint grain.
export function draw(cols: number, rows: number, axis: number, dc: number, dr: number): Grid {
  const lum = new Float32Array(cols * rows);
  const rand = random(3);
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) / dr;
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5 - axis) / dc;
      let v = Math.abs(x) > HALF_WIDTH ? 1 : stone(x, y);
      // Stretch the light: lit faces near white, shadows near black, like an engraving.
      if (v <= PAPER) v = Math.min(PAPER, Math.max(0, (v - 0.3) / 0.55 + (rand() - 0.5) * 0.06));
      lum[r * cols + c] = v;
    }
  }
  return { cols, rows, lum, dc, dr };
}

const isStone = (g: Grid, r: number, c: number) =>
  r >= 0 && r < g.rows && c >= 0 && c < g.cols && g.lum[r * g.cols + c] <= PAPER;

function edges(g: Grid, r: number): [number, number] | null {
  let left = -1;
  let right = -1;
  for (let c = 0; c < g.cols; c++)
    if (g.lum[r * g.cols + c] <= PAPER) {
      if (left < 0) left = c;
      right = c;
    }
  return left < 0 ? null : [left, right];
}

// Whether a point is inside a polygon (cells).
function inside(pts: [number, number][], c: number, r: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ci, ri] = pts[i];
    const [cj, rj] = pts[j];
    if (ri > r !== rj > r && c < ((cj - ci) * (r - ri)) / (rj - ri) + ci) hit = !hit;
  }
  return hit;
}

// A crack: straight runs with sharp kinks, heading down and across the stone, forking now and
// then. A dark split with a shadowed lower lip and a lit upper lip, and stone flaking off along
// it where the damage is heavy.
function crack(
  g: Grid,
  rand: () => number,
  r0: number,
  c0: number,
  length: number,
  width: number,
  d: number,
  depth = 0,
) {
  let r = r0;
  let c = c0;
  const aspect = g.dc / g.dr;
  const side = rand() < 0.5 ? -1 : 1;
  let angle = Math.PI / 2 + side * (0.55 + rand() * 0.5);
  let travelled = 0;
  while (travelled < length) {
    const run = Math.max(6, (0.06 + rand() * 0.22) * g.dr);
    angle += (rand() - 0.5) * 1.0;
    angle = Math.min(Math.PI - 0.3, Math.max(0.3, angle));
    for (let s = 0; s < run; s++) {
      r += Math.sin(angle);
      c += Math.cos(angle) * aspect + (rand() - 0.5) * 0.5;
      const rr = Math.round(r);
      const cc = Math.round(c);
      if (!isStone(g, rr, cc)) return;
      for (let k = 0; k < width; k++)
        if (isStone(g, rr, cc + k)) g.lum[rr * g.cols + cc + k] = 0.02;
      for (const [dr, dc] of [
        [1, 0],
        [1, 1],
        [2, 0],
      ])
        if (isStone(g, rr + dr, cc + dc)) g.lum[(rr + dr) * g.cols + cc + dc] *= 0.45;
      if (isStone(g, rr - 1, cc - 1)) {
        const i = (rr - 1) * g.cols + cc - 1;
        g.lum[i] = Math.min(PAPER, g.lum[i] + 0.18);
      }
      // Flakes along the crack.
      if (rand() < 0.09 * d) {
        const size = 1 + Math.floor(rand() * 3 * d + 1);
        for (let a = 0; a < size; a++)
          for (let b = -size; b <= size; b++)
            if (isStone(g, rr + a, cc + b) && rand() < 0.7) g.lum[(rr + a) * g.cols + cc + b] = 0.3;
      }
    }
    travelled += run;
    if (depth < 3 && rand() < 0.4)
      crack(
        g,
        rand,
        Math.round(r),
        Math.round(c),
        (length - travelled) * 0.55,
        Math.max(1, width - 1),
        d,
        depth + 1,
      );
  }
}

// A piece broken off the edge: an angular bite into the stone, gone to paper, its broken face a
// band of rough dark stone just inside.
function breakOff(
  g: Grid,
  rand: () => number,
  r0: number,
  edge: number,
  inward: number,
  height: number,
) {
  const pts: [number, number][] = [
    [edge - inward * 0.2, r0],
    [edge + inward * (0.5 + rand() * 0.5), r0 + height * (0.15 + rand() * 0.25)],
    [edge + inward * (0.7 + rand() * 0.6), r0 + height * (0.45 + rand() * 0.2)],
    [edge + inward * (0.3 + rand() * 0.4), r0 + height * (0.75 + rand() * 0.15)],
    [edge - inward * 0.2, r0 + height],
  ];
  const span = Math.abs(inward) * 1.6 + 4;
  for (let r = Math.floor(r0) - 2; r <= Math.ceil(r0 + height) + 2; r++)
    for (let c = Math.floor(edge - span); c <= Math.ceil(edge + span); c++) {
      if (!isStone(g, r, c)) continue;
      const i = r * g.cols + c;
      if (inside(pts, c, r)) g.lum[i] = 1;
      else if (
        inside(pts, c - 2, r) ||
        inside(pts, c + 2, r) ||
        inside(pts, c, r - 1) ||
        inside(pts, c, r + 1)
      )
        g.lum[i] = 0.05 + rand() * 0.25;
    }
}

// A shallow spall in the face of the stone: rough and dark inside, a shadowed rim above.
function spall(g: Grid, rand: () => number, r0: number, c0: number, w: number, h: number) {
  const pts: [number, number][] = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + (rand() - 0.5) * 0.7;
    return [
      c0 + Math.cos(a) * w * (0.6 + rand() * 0.5),
      r0 + Math.sin(a) * h * (0.6 + rand() * 0.5),
    ];
  });
  for (let r = Math.floor(r0 - h * 1.2); r <= Math.ceil(r0 + h * 1.2); r++)
    for (let c = Math.floor(c0 - w * 1.2); c <= Math.ceil(c0 + w * 1.2); c++) {
      if (!isStone(g, r, c)) continue;
      const i = r * g.cols + c;
      if (inside(pts, c, r)) g.lum[i] = 0.28 + rand() * 0.3;
      else if (inside(pts, c, r + 1)) g.lum[i] = 0.05;
    }
}

// Weathers the column: cracks, broken edges, spalls and pits, heaviest at the top and none from
// WHOLE_FROM down. Returns how many cells changed in the top and bottom tenth.
export function weather(g: Grid, seed: number): { top: number; bottom: number } {
  const before = g.lum.slice();
  const rand = random(seed);
  const at = (r: number) => damageAt(r / g.rows);

  // Pieces broken off the edges.
  for (let r = 4; r < g.rows * WHOLE_FROM; r += Math.max(3, Math.round(g.dr * 0.12))) {
    const d = at(r);
    if (rand() > d * 0.38) continue;
    const sides = edges(g, r);
    if (!sides) continue;
    const left = rand() < 0.5;
    const edge = left ? sides[0] : sides[1];
    const inward = (left ? 1 : -1) * g.dc * (0.03 + rand() * 0.16 * d);
    breakOff(g, rand, r, edge, inward, g.dr * (0.05 + rand() * 0.3 * d));
  }
  // Spalls in the face.
  for (let r = 4; r < g.rows * WHOLE_FROM; r += Math.max(3, Math.round(g.dr * 0.15))) {
    const d = at(r);
    if (rand() > d * 0.6) continue;
    const sides = edges(g, r);
    if (!sides) continue;
    const c = sides[0] + (sides[1] - sides[0]) * (0.15 + rand() * 0.7);
    spall(g, rand, r, c, g.dc * (0.02 + rand() * 0.12 * d), g.dr * (0.02 + rand() * 0.09 * d));
  }
  // Cracks.
  for (let r = 2; r < g.rows * WHOLE_FROM; r += Math.max(2, Math.round(g.dr * 0.05))) {
    const d = at(r);
    if (rand() > d * 0.9) continue;
    const sides = edges(g, r);
    if (!sides) continue;
    const c = sides[0] + (sides[1] - sides[0]) * rand();
    const length = Math.min(g.rows * WHOLE_FROM - r, g.dr * (0.25 + rand() * 2.6 * d));
    crack(g, rand, r, Math.round(c), length, 2 + Math.round(3 * d * rand()), d);
  }
  // Pits.
  for (let i = 0; i < g.lum.length; i++) {
    const d = at(Math.floor(i / g.cols));
    if (d > 0 && g.lum[i] <= PAPER && rand() < 0.012 * d) g.lum[i] *= 0.35;
  }

  let top = 0;
  let bottom = 0;
  const tenth = Math.floor(g.rows / 10);
  for (let i = 0; i < g.lum.length; i++) {
    if (g.lum[i] === before[i]) continue;
    const r = Math.floor(i / g.cols);
    if (r < tenth) top++;
    else if (r >= g.rows - tenth) bottom++;
  }
  return { top, bottom };
}
