import type { Raster } from "./ascii-diamond";

// The landing page's colours, taken from its rendered art (founder, 2026-10-24: "The rest of the
// landing page should also match the color"). The landing page is the one place exempt from the
// site's black-and-white rule (docs/design/area-pages.md). Pure: scripts/render-landing-art.ts
// samples the render with it and writes src/app/landing.css.

export type Rgb255 = readonly [number, number, number];

export type LandingPalette = {
  // The art's background tone: the page.
  background: Rgb255;
  // The background's own diamonds: borders and quiet lines.
  dot: Rgb255;
  // The art's dominant mid tone, lifted until it reads on the background (AA): body text.
  mid: Rgb255;
  // The art's highlight: headings, the main button.
  highlight: Rgb255;
};

// WCAG 2 relative luminance and contrast ratio.
const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const relativeLuminance = ([r, g, b]: Rgb255) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrast(a: Rgb255, b: Rgb255): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb255, b: Rgb255, t: number): Rgb255 =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)) as unknown as Rgb255;

// Moves `fg` toward `toward` in small steps until it has `min` contrast on `bg`.
export function lifted(fg: Rgb255, bg: Rgb255, toward: Rgb255, min = 4.5): Rgb255 {
  let out = fg;
  for (let t = 0; t <= 1 && contrast(out, bg) < min; t += 0.02) out = mix(fg, toward, t);
  return out;
}

// The palette of a render: drawn pixels (mostly opaque) composited over the background, sorted by
// luminance. Most cells are background dots, so the low end is the dot and the high end the
// highlight; the dominant mid tone is the median of the cells brighter than the dots.
export function paletteFrom(art: Raster, background: Rgb255): LandingPalette {
  const drawn: { l: number; rgb: Rgb255 }[] = [];
  const { data } = art;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.6) continue;
    const rgb = [0, 1, 2].map((c) =>
      Math.round(data[i + c] * a + background[c] * (1 - a)),
    ) as unknown as Rgb255;
    drawn.push({ l: relativeLuminance(rgb), rgb });
  }
  if (drawn.length === 0) {
    return { background, dot: background, mid: [200, 200, 200], highlight: [255, 255, 255] };
  }
  drawn.sort((x, y) => x.l - y.l);
  const at = (share: number) => drawn[Math.min(drawn.length - 1, Math.floor(drawn.length * share))];
  const dot = at(0.3).rgb;
  const brighter = drawn.filter((d) => d.l > at(0.3).l * 1.15);
  const middle = brighter.length > 0 ? brighter[Math.floor(brighter.length / 2)].rgb : at(0.7).rgb;
  const highlight = at(0.995).rgb;
  return {
    background,
    dot,
    mid: lifted(middle, background, highlight),
    highlight: lifted(highlight, background, [255, 255, 255], 7),
  };
}

export const hex = (rgb: Rgb255) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
