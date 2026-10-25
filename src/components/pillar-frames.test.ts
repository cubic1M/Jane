import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The landing page's pillar frames (scripts/pillars/build.ts): eight drawings at each width,
// lined up on the same grid, from broken to whole.
const WIDTHS = [72, 110, 160];
const load = (cols: number) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "public", "landing", `pillar-${cols}.json`), "utf8"),
  ) as { cols: number; rows: number; frames: string[] };

describe("pillar frames", () => {
  it.each(WIDTHS)("has eight frames on one %i-column grid", (cols) => {
    const data = load(cols);
    expect(data.cols).toBe(cols);
    expect(data.frames).toHaveLength(8);
    for (const frame of data.frames) {
      const lines = frame.split("\n");
      expect(lines).toHaveLength(data.rows);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(cols);
    }
  });

  it("rebuilds the column: the first and last frames differ in much of the drawing", () => {
    const data = load(110);
    const [first, last] = [data.frames[0], data.frames[7]].map((f) =>
      f.split("\n").map((line) => line.padEnd(data.cols, " ")),
    );
    let inked = 0;
    let changed = 0;
    for (let r = 0; r < data.rows; r++)
      for (let c = 0; c < data.cols; c++) {
        if (first[r][c] === " " && last[r][c] === " ") continue;
        inked++;
        if (first[r][c] !== last[r][c]) changed++;
      }
    expect(changed / inked).toBeGreaterThan(0.5);
  });
});
