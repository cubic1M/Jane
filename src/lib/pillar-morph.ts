// The landing page's pillar rebuilding as the page scrolls (founder, 2026-10-25): scroll progress
// 0 → 1 runs through the frames (src/content/pillar-frames.ts), broken to whole. Between two
// frames each character changes on its own, at a threshold of its own (seeded, so the same every
// time, and lower toward the bottom, so the column builds up from its base). Going back up runs
// the same thresholds backwards. Pure: src/components/pillar-story.tsx draws it.

export type Grid = readonly string[];

// Every frame as rows of exactly `cols` characters.
export function toGrid(frame: string, cols: number, rows: number): Grid {
  const lines = frame.split("\n");
  return Array.from({ length: rows }, (_, r) => (lines[r] ?? "").padEnd(cols).slice(0, cols));
}

// A small seeded generator (mulberry32), so the thresholds are the same on every visit.
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How much the bottom-to-top order weighs against chance.
export const BOTTOM_UP = 0.3;

// Each character's threshold, 0–1: mostly chance, a little lower toward the bottom.
export function thresholds(cols: number, rows: number, seed = 1729): Float32Array {
  const next = random(seed);
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const fromBottom = rows > 1 ? (rows - 1 - r) / (rows - 1) : 0;
    for (let c = 0; c < cols; c++) {
      out[r * cols + c] = (1 - BOTTOM_UP) * next() + BOTTOM_UP * fromBottom;
    }
  }
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Which two frames a progress falls between, and how far from the first (0–1).
export function segment(progress: number, frames: number): { from: number; t: number } {
  const steps = frames - 1;
  const at = clamp01(progress) * steps;
  const from = Math.min(Math.floor(at), steps - 1);
  return { from, t: at - from };
}

// The nearest whole frame (1-based), for labels and reduced motion.
export const frameNumber = (progress: number, frames: number) =>
  Math.round(clamp01(progress) * (frames - 1)) + 1;

// The pillar at a progress: every character from the frame before or after its threshold.
export function morph(grids: readonly Grid[], progress: number, limits: Float32Array): string {
  const { from, t } = segment(progress, grids.length);
  const a = grids[from];
  const b = grids[from + 1];
  if (t <= 0) return a.join("\n");
  if (t >= 1) return b.join("\n");
  const cols = a[0]?.length ?? 0;
  const out: string[] = [];
  for (let r = 0; r < a.length; r++) {
    let line = "";
    const ar = a[r];
    const br = b[r];
    for (let c = 0; c < cols; c++) line += t >= limits[r * cols + c] ? br[c] : ar[c];
    out.push(line);
  }
  return out.join("\n");
}

// Reduced motion: whole frames only, no characters in between.
export const stepped = (grids: readonly Grid[], progress: number) =>
  grids[frameNumber(progress, grids.length) - 1].join("\n");
