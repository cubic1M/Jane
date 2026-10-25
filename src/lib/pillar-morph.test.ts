import { describe, expect, it } from "vitest";
import { PILLAR_COLS, PILLAR_FRAMES, PILLAR_ROWS } from "@/content/pillar-frames";
import { frameNumber, morph, segment, stepped, thresholds, toGrid } from "./pillar-morph";

// The landing page's pillar (founder, 2026-10-25): broken at the top of the page, whole at the
// bottom, rebuilt a character at a time in between, and the same going back up.

const grids = PILLAR_FRAMES.map((f) => toGrid(f, PILLAR_COLS, PILLAR_ROWS));
const limits = thresholds(PILLAR_COLS, PILLAR_ROWS);
const frame = (i: number) => grids[i].join("\n");

describe("the frames", () => {
  it("are eight, all the same size, each clearly different from the next", () => {
    expect(PILLAR_FRAMES).toHaveLength(8);
    for (const g of grids) {
      expect(g).toHaveLength(PILLAR_ROWS);
      for (const line of g) expect(line).toHaveLength(PILLAR_COLS);
    }
    for (let i = 0; i < 7; i++) {
      let differ = 0;
      for (let r = 0; r < PILLAR_ROWS; r++) {
        for (let c = 0; c < PILLAR_COLS; c++) if (grids[i][r][c] !== grids[i + 1][r][c]) differ++;
      }
      expect(differ, `stage ${i + 1} to ${i + 2}`).toBeGreaterThan(500);
    }
  });

  it("are a column 60–90 characters wide at its widest", () => {
    const widths = PILLAR_FRAMES.map((f) =>
      Math.max(...f.split("\n").map((l) => l.trimEnd().length - (l.length - l.trimStart().length))),
    );
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...widths)).toBeLessThanOrEqual(90);
  });
});

describe("morph", () => {
  it("is the first frame at the top and the last at the bottom", () => {
    expect(morph(grids, 0, limits)).toBe(frame(0));
    expect(morph(grids, 1, limits)).toBe(frame(7));
    expect(morph(grids, -0.5, limits)).toBe(frame(0));
    expect(morph(grids, 2, limits)).toBe(frame(7));
  });

  it("lands exactly on each frame at its step", () => {
    for (let i = 0; i < 8; i++) expect(morph(grids, i / 7, limits)).toBe(frame(i));
  });

  it("mixes two frames in between, more of the next the further down", () => {
    const share = (p: number) => {
      const out = morph(grids, p, limits).split("\n");
      let next = 0;
      let changed = 0;
      for (let r = 0; r < PILLAR_ROWS; r++) {
        for (let c = 0; c < PILLAR_COLS; c++) {
          if (grids[0][r][c] === grids[1][r][c]) continue;
          changed++;
          if (out[r][c] === grids[1][r][c]) next++;
        }
      }
      return next / changed;
    };
    const quarter = share(0.25 / 7);
    const three = share(0.75 / 7);
    expect(quarter).toBeGreaterThan(0.1);
    expect(quarter).toBeLessThan(three);
    expect(three).toBeLessThan(0.95);
  });

  it("builds from the bottom up", () => {
    const rows = (from: number, to: number) => {
      let sum = 0;
      for (let r = from; r < to; r++) {
        for (let c = 0; c < PILLAR_COLS; c++) sum += limits[r * PILLAR_COLS + c];
      }
      return sum / ((to - from) * PILLAR_COLS);
    };
    expect(rows(PILLAR_ROWS - 20, PILLAR_ROWS)).toBeLessThan(rows(0, 20));
  });

  it("goes back the same way: one progress is always one picture", () => {
    expect(morph(grids, 0.4, limits)).toBe(morph(grids, 0.4, thresholds(PILLAR_COLS, PILLAR_ROWS)));
  });
});

describe("reduced motion and labels", () => {
  it("shows whole frames only", () => {
    expect(stepped(grids, 0.02)).toBe(frame(0));
    expect(stepped(grids, 0.5)).toBe(frame(frameNumber(0.5, 8) - 1));
    expect(stepped(grids, 1)).toBe(frame(7));
  });

  it("splits progress into seven steps", () => {
    expect(segment(0, 8)).toEqual({ from: 0, t: 0 });
    expect(segment(1, 8)).toEqual({ from: 6, t: 1 });
    expect(segment(0.5, 8).from).toBe(3);
    expect(frameNumber(1, 8)).toBe(8);
    expect(frameNumber(0, 8)).toBe(1);
  });
});
