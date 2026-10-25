import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_ART, LANDING_RECIPE } from "@/config/landing-art";
import {
  adjust,
  cellOf,
  flatField,
  luminance,
  renderDiamonds,
  softLight,
  tinted,
  toneCurve,
  type DiamondRecipe,
  type Raster,
} from "./ascii-diamond";

// The landing page's ASCII diamonds (founder, 2026-10-24): the recipe's steps in order, the
// diamonds themselves, and the background tile that has to match the art.

const plain: DiamondRecipe = {
  ...LANDING_RECIPE,
  brightness: 0,
  contrast: 0,
  saturation: 100,
  grayscale: 0,
  tint: { color: "#ffffff", opacity: 0, blend: "soft-light" },
  toneCurve: [
    [0, 0],
    [1, 1],
  ],
  bloom: { on: false, intensity: 0 },
};

const alphaAt = (r: Raster, x: number, y: number) => r.data[(y * r.width + x) * 4 + 3];

describe("the recipe", () => {
  it("is the one the founder chose", () => {
    expect(LANDING_RECIPE).toMatchObject({
      cellSize: 3,
      coverage: 100,
      brightness: 43,
      contrast: -4,
      density: 65,
      edgeEmphasis: 0,
      invert: false,
      saturation: 100,
      grayscale: 28,
      tint: { color: "#ffffff", opacity: 0.2, blend: "soft-light" },
      bloom: { on: true, intensity: 45 },
    });
    expect(LANDING_RECIPE.toneCurve).toEqual([
      [0, 0],
      [0.7078, 0.0709],
      [1, 1],
    ]);
  });

  it("has its pre-rendered poster and tile, and a crop inside the picture", () => {
    for (const file of [LANDING_ART.source, LANDING_ART.poster, LANDING_ART.tile]) {
      expect(existsSync(`public${file}`), file).toBe(true);
    }
    const { x, y, width, height } = LANDING_ART.crop;
    expect(x + width).toBeLessThanOrEqual(1);
    expect(y + height).toBeLessThanOrEqual(1);
  });
});

describe("the steps", () => {
  it("maps luminance through the tone curve, points sorted by x", () => {
    const curve = toneCurve([
      [1, 1],
      [0, 0],
      [0.5, 0.1],
    ]);
    expect(curve(0)).toBe(0);
    expect(curve(0.25)).toBeCloseTo(0.05);
    expect(curve(0.5)).toBeCloseTo(0.1);
    expect(curve(0.75)).toBeCloseTo(0.55);
    expect(curve(1)).toBe(1);
    expect(curve(2)).toBe(1);
  });

  it("brightens, then takes colour away for grayscale", () => {
    const red: [number, number, number] = [0.6, 0.2, 0.2];
    const brighter = adjust(red, { ...plain, brightness: 20 });
    expect(luminance(brighter)).toBeGreaterThan(luminance(red));
    const grey = adjust(red, { ...plain, grayscale: 100 });
    expect(grey[0]).toBeCloseTo(grey[1]);
    expect(grey[1]).toBeCloseTo(grey[2]);
    const less = adjust(red, { ...plain, contrast: -50 });
    expect(Math.abs(less[0] - 0.5)).toBeLessThan(Math.abs(red[0] - 0.5));
  });

  it("blends the tint with soft light at its opacity", () => {
    expect(softLight(0.5, 0.5)).toBeCloseTo(0.5);
    expect(softLight(0.4, 1)).toBeGreaterThan(0.4);
    expect(softLight(0.4, 0)).toBeLessThan(0.4);
    const none = tinted([0.3, 0.3, 0.3], { ...plain, tint: { ...plain.tint, opacity: 0 } });
    expect(none).toEqual([0.3, 0.3, 0.3]);
    const white = tinted([0.3, 0.3, 0.3], { ...plain, tint: { ...plain.tint, opacity: 0.2 } });
    expect(white[0]).toBeGreaterThan(0.3);
  });

  it("keeps a dot on a dark cell and grows the diamond on a light one", () => {
    const dark = cellOf([0.05, 0.05, 0.05], LANDING_RECIPE);
    const light = cellOf([0.95, 0.95, 0.95], LANDING_RECIPE);
    expect(dark.size).toBeGreaterThan(0);
    expect(light.size).toBeGreaterThan(dark.size);
    expect(light.size).toBeLessThanOrEqual(LANDING_RECIPE.density / 100);
  });
});

describe("renderDiamonds", () => {
  it("draws one diamond per cell, centred, on a transparent background", () => {
    const art = renderDiamonds(flatField(30, 30, [255, 255, 255]), 10, {
      ...plain,
      density: 100,
    });
    // The centre of a cell is drawn, its corners aren't.
    expect(alphaAt(art, 5, 5)).toBe(255);
    expect(alphaAt(art, 0, 0)).toBe(0);
    expect(alphaAt(art, 15, 15)).toBe(255);
    expect(alphaAt(art, 10, 10)).toBe(0);
  });

  it("draws the same cells every time when coverage is under 100", () => {
    const source = flatField(60, 60, [200, 200, 200]);
    const a = renderDiamonds(source, 6, { ...plain, coverage: 50 });
    const b = renderDiamonds(source, 6, { ...plain, coverage: 50 });
    expect(a.data).toEqual(b.data);
    const drawn = Array.from({ length: 10 }, (_, i) => alphaAt(a, i * 6 + 3, 3) > 0);
    expect(drawn.some(Boolean)).toBe(true);
    expect(drawn.every(Boolean)).toBe(false);
  });

  it("makes a tile that repeats seamlessly, bloom and all, for the page background", () => {
    const cell = LANDING_RECIPE.cellSize * 2;
    const size = cell * 8;
    const tile = renderDiamonds(
      flatField(size, size, [...LANDING_ART.background]),
      cell,
      LANDING_RECIPE,
      {
        wrap: true,
      },
    );
    // Every cell of a flat field is the same, and the glow wraps round the edges.
    const pixel = (x: number, y: number) =>
      Array.from(tile.data.slice((y * size + x) * 4, (y * size + x) * 4 + 4));
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        expect(pixel(x, y)).toEqual(pixel(x + cell * 7, y + cell * 3));
      }
    }
  });

  it("draws a picture's background cells exactly as the tile does", () => {
    const cell = LANDING_RECIPE.cellSize;
    const noBloom = { ...LANDING_RECIPE, bloom: { on: false, intensity: 0 } };
    const size = cell * 4;
    const tile = renderDiamonds(flatField(size, size, [...LANDING_ART.background]), cell, noBloom);
    // A picture on that background with one bright cell.
    const picture = flatField(size, size, [...LANDING_ART.background]);
    for (let y = cell; y < cell * 2; y++) {
      for (let x = cell; x < cell * 2; x++)
        picture.data.set([240, 240, 240, 255], (y * size + x) * 4);
    }
    const art = renderDiamonds(picture, cell, noBloom);
    const cellPixels = (r: Raster, cx: number, cy: number) =>
      Array.from({ length: cell * cell }, (_, k) => {
        const i = ((cy * cell + Math.floor(k / cell)) * size + cx * cell + (k % cell)) * 4;
        return Array.from(r.data.slice(i, i + 4));
      });
    expect(cellPixels(art, 3, 3)).toEqual(cellPixels(tile, 3, 3));
    expect(cellPixels(art, 1, 1)).not.toEqual(cellPixels(tile, 1, 1));
  });
});
