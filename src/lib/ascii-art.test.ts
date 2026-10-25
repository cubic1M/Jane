import { describe, expect, it } from "vitest";
import { RAMP, rowsFor, toAscii, type Gray } from "./ascii-art";

// A drawing as ASCII art: paper is blank, ink is dense, and the edges of shapes are line
// characters.

const paper = (width: number, height: number): Gray => ({
  width,
  height,
  data: new Uint8Array(width * height).fill(255),
});

describe("toAscii", () => {
  it("keeps the picture's shape: monospace rows for its height", () => {
    expect(rowsFor(60, 100, 30)).toBe(Math.round(100 / (2 / 0.6)));
    expect(toAscii(paper(60, 100), { cols: 30 })).toHaveLength(rowsFor(60, 100, 30));
  });

  it("leaves paper blank and fills solid ink with the densest character", () => {
    const g = paper(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 20; x < 40; x++) g.data[y * 40 + x] = 0;
    const lines = toAscii(g, { cols: 20 });
    const middle = lines[Math.floor(lines.length / 2)];
    expect(middle.slice(0, 8).trim()).toBe("");
    expect(middle.at(-1)).toBe(RAMP.at(-1));
  });

  it("draws the upright edge of ink as |, and a thin line in light ink", () => {
    const g = paper(60, 60);
    for (let y = 0; y < 60; y++) {
      g.data[y * 60 + 30] = 0;
      for (let x = 50; x < 60; x++) g.data[y * 60 + x] = 0;
    }
    const lines = toAscii(g, { cols: 15 });
    const middle = lines[Math.floor(lines.length / 2)];
    // The block's edge.
    expect(middle[12]).toBe("|");
    // The one-pixel line: ink, lighter than the solid block.
    expect(middle[7]).not.toBe(" ");
    expect(RAMP.indexOf(middle[7])).toBeLessThan(RAMP.indexOf("@"));
  });
});
