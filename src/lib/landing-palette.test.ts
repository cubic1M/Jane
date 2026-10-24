import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_ART } from "@/config/landing-art";
import { flatField, renderDiamonds } from "./ascii-diamond";
import { contrast, hex, lifted, paletteFrom, type Rgb255 } from "./landing-palette";

// The landing page's colours come from its art (founder, 2026-10-24), and every text colour reads
// on its background (WCAG AA).

const tokens = () => {
  const css = readFileSync("src/app/landing.css", "utf8");
  const get = (name: string): Rgb255 => {
    const m = css.match(new RegExp(`--landing-${name}: #([0-9a-f]{6});`))!;
    const n = Number.parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  return { bg: get("bg"), dot: get("dot"), mid: get("mid"), hi: get("hi") };
};

describe("contrast", () => {
  it("is the WCAG ratio", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1);
    expect(contrast([50, 50, 50], [50, 50, 50])).toBe(1);
  });

  it("lifts a colour until it reads", () => {
    const out = lifted([60, 58, 57], [27, 25, 24], [255, 255, 255]);
    expect(contrast(out, [27, 25, 24])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the landing palette", () => {
  it("has the art's background as the page, and every text colour at AA or better on it", () => {
    const { bg, dot, mid, hi } = tokens();
    expect(hex(bg)).toBe(hex(LANDING_ART.background));
    // Body text, headings, quiet text (the eyebrow, the dotted leaders, the footer).
    expect(contrast(mid, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hi, bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(dot, bg)).toBeGreaterThanOrEqual(4.5);
    // The main button: background-coloured words on the highlight.
    expect(contrast(bg, hi)).toBeGreaterThanOrEqual(4.5);
  });

  it("samples a render: the dots low, a brighter mid tone, the highlight on top", () => {
    const size = 60;
    const picture = flatField(size, size, [...LANDING_ART.background]);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < size; x++) picture.data.set([235, 235, 235, 255], (y * size + x) * 4);
    }
    const p = paletteFrom(renderDiamonds(picture, 6, LANDING_ART.recipe), LANDING_ART.background);
    const lum = (c: Rgb255) => c[0] + c[1] + c[2];
    expect(lum(p.dot)).toBeLessThanOrEqual(lum(p.mid));
    expect(lum(p.mid)).toBeLessThanOrEqual(lum(p.highlight));
    expect(contrast(p.mid, p.background)).toBeGreaterThanOrEqual(4.5);
  });
});
