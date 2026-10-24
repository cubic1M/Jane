import type { DiamondRecipe } from "@/lib/ascii-diamond";

// The landing page's art (founder, 2026-10-24): the Patrick Jane picture drawn as ASCII diamonds
// with the founder's recipe, on the right of the headline, and the same diamonds as the whole
// page's background. The page's colours come from the render (src/app/landing.css).
//
// To use another picture: put it in public/landing, set `source` (and `crop`) here, and run
// `npm run render:landing-art` to remake the poster, the tile and the palette.

// The 21st.dev "Custom ASCII art" recipe the founder chose (src/lib/ascii-diamond.ts draws it).
export const LANDING_RECIPE: DiamondRecipe = {
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
  toneCurve: [
    [0, 0],
    [0.7078, 0.0709],
    [1, 1],
  ],
  bloom: { on: true, intensity: 45 },
};

export const LANDING_ART = {
  // The picture: the clearest frame (69) of the old Patrick Jane ASCII animation.
  source: "/landing/patrick-jane.webp",
  // The part of it to use, as shares of its width and height (this one drops the
  // "asciicraft.com" mark in the bottom corner).
  crop: { x: 0, y: 0, width: 1, height: 0.9 },
  // Pre-rendered by scripts/render-landing-art.ts: the first paint, and what shows without
  // JavaScript.
  poster: "/landing/diamond-poster.webp",
  posterWidth: 640,
  // The background tile: the same diamonds over the picture's own background colour.
  tile: "/landing/diamond-tile.png",
  // The tile's size in CSS pixels (a whole number of cells) and the colour it's made from: the
  // source's background, measured by the script.
  tileCells: 32,
  background: [27, 25, 24] as [number, number, number],
  recipe: LANDING_RECIPE,
} as const;
