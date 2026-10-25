// The landing page's ASCII diamond art (founder, 2026-10-24): a picture drawn as a grid of
// diamonds, one per cell, after the 21st.dev "Custom ASCII art" recipe in
// src/config/landing-art.ts. A reimplementation, not their code. Pure: it takes pixels and gives
// pixels, so the browser's canvas (src/components/ascii-diamond.tsx), the pre-rendered poster and
// the page's background tile (scripts/render-landing-art.ts) are the same pixels.
//
// Per cell, in order:
//  1. the cell's average colour;
//  2. brightness, contrast, saturation, grayscale;
//  3. the tone curve maps its luminance (points sorted by x, straight lines between);
//  4. the tint colour blended over it (soft light) at the tint's opacity;
//  5. a diamond centred in the cell, its size from the curved luminance and the density.
// Then a bloom: a blurred copy laid over with "screen" at the bloom's intensity.

export type DiamondRecipe = {
  // Cell size in CSS pixels.
  cellSize: number;
  // Share of cells drawn, 0–100.
  coverage: number;
  // -100–100.
  brightness: number;
  // -100–100.
  contrast: number;
  // How big the diamonds are, 0–100 (100: corners touch at full luminance).
  density: number;
  // Not used by the landing recipe (0).
  edgeEmphasis: number;
  invert: boolean;
  // Percent: 100 leaves colour as it is, 0 is grey.
  saturation: number;
  // Percent toward grey, applied after saturation.
  grayscale: number;
  tint: { color: string; opacity: number; blend: "soft-light" };
  toneCurve: readonly (readonly [number, number])[];
  // Intensity 0–100.
  bloom: { on: boolean; intensity: number };
};

export type Raster = { width: number; height: number; data: Uint8ClampedArray };
type Rgb = [number, number, number];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// The tone curve through its points, sorted by x; straight lines between them, flat beyond.
export function toneCurve(points: DiamondRecipe["toneCurve"]): (x: number) => number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return (x) => x;
  return (x) => {
    if (x <= sorted[0][0]) return clamp01(sorted[0][1]);
    for (let i = 1; i < sorted.length; i++) {
      const [x1, y1] = sorted[i];
      if (x <= x1) {
        const [x0, y0] = sorted[i - 1];
        const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
        return clamp01(y0 + (y1 - y0) * t);
      }
    }
    return clamp01(sorted[sorted.length - 1][1]);
  };
}

// Brightness, contrast, saturation, grayscale, in that order; channels 0–1.
export function adjust(rgb: Rgb, r: DiamondRecipe): Rgb {
  const b = r.brightness / 100;
  // The usual contrast factor, on a -100–100 scale.
  const c = (r.contrast / 100) * 255;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  let out = rgb.map((v) => clamp01(factor * (v + b - 0.5) + 0.5)) as Rgb;
  const grey = luminance(out);
  const sat = r.saturation / 100;
  out = out.map((v) => clamp01(grey + (v - grey) * sat)) as Rgb;
  const g = r.grayscale / 100;
  const grey2 = luminance(out);
  return out.map((v) => clamp01(v + (grey2 - v) * g)) as Rgb;
}

// The W3C soft-light blend: `blend` laid over `base`.
export function softLight(base: number, blend: number): number {
  if (blend <= 0.5) return base - (1 - 2 * blend) * base * (1 - base);
  const d = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
  return base + (2 * blend - 1) * (d - base);
}

export function tinted(rgb: Rgb, r: DiamondRecipe): Rgb {
  const tint = hexToRgb(r.tint.color);
  const a = r.tint.opacity;
  return rgb.map((v, i) => clamp01(v + (softLight(v, tint[i]) - v) * a)) as Rgb;
}

// One cell: its colour and the diamond's half-diagonal as a share of half the cell (0–1).
export function cellOf(average: Rgb, r: DiamondRecipe, curve = toneCurve(r.toneCurve)) {
  let rgb = adjust(average, r);
  if (r.invert) rgb = rgb.map((v) => 1 - v) as Rgb;
  const level = curve(luminance(rgb));
  // Every cell keeps a dot, so dark areas read as a dotted field; light ones grow to full size.
  const size = clamp01((r.density / 100) * (0.5 + 0.5 * level));
  return { rgb: tinted(rgb, r), size };
}

// Whether a cell is drawn under `coverage` below 100: the same cells every time.
const kept = (col: number, row: number, coverage: number) =>
  coverage >= 100 || (((col * 73856093) ^ (row * 19349663)) >>> 0) % 100 < coverage;

// Draws the art. `source` is the picture already drawn at the output size (device pixels);
// `cellPx` is the cell in device pixels. The background stays transparent.
export function renderDiamonds(
  source: Raster,
  cellPx: number,
  r: DiamondRecipe,
  { wrap = false }: { wrap?: boolean } = {},
): Raster {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(width * height * 4);
  const curve = toneCurve(r.toneCurve);
  const cols = Math.ceil(width / cellPx);
  const rows = Math.ceil(height / cellPx);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!kept(col, row, r.coverage)) continue;
      const x0 = Math.round(col * cellPx);
      const y0 = Math.round(row * cellPx);
      const x1 = Math.min(width, Math.round((col + 1) * cellPx));
      const y1 = Math.min(height, Math.round((row + 1) * cellPx));
      // The cell's average colour, weighted by alpha.
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const a = data[i + 3] / 255;
          sr += data[i] * a;
          sg += data[i + 1] * a;
          sb += data[i + 2] * a;
          sa += a;
        }
      }
      if (sa === 0) continue;
      const { rgb, size } = cellOf([sr / sa / 255, sg / sa / 255, sb / sa / 255], r, curve);
      const half = (cellPx / 2) * size;
      if (half <= 0) continue;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      // Antialiased: a pixel's cover is how far its centre is inside the diamond, ±half a pixel.
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const d = Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy);
          const cover = clamp01(half - d + 0.5);
          if (cover <= 0) continue;
          const i = (y * width + x) * 4;
          out[i] = rgb[0] * 255;
          out[i + 1] = rgb[1] * 255;
          out[i + 2] = rgb[2] * 255;
          out[i + 3] = cover * 255;
        }
      }
    }
  }
  return r.bloom.on && r.bloom.intensity > 0
    ? bloom({ width, height, data: out }, cellPx * 2, r.bloom.intensity / 100, wrap)
    : { width, height, data: out };
}

// A box blur of premultiplied colour, one direction; `wrap` for a tile that repeats.
function blurLine(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  wrap: boolean,
) {
  const len = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const span = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const at = (k: number) => {
      let p = k;
      if (wrap) p = ((p % len) + len) % len;
      else p = p < 0 ? 0 : p >= len ? len - 1 : p;
      return horizontal ? (line * width + p) * 4 : (p * width + line) * 4;
    };
    const sum = [0, 0, 0, 0];
    for (let k = -radius; k <= radius; k++) {
      const i = at(k);
      for (let c = 0; c < 4; c++) sum[c] += src[i + c];
    }
    for (let k = 0; k < len; k++) {
      const o = at(k);
      for (let c = 0; c < 4; c++) dst[o + c] = sum[c] / span;
      const add = at(k + radius + 1);
      const drop = at(k - radius);
      for (let c = 0; c < 4; c++) sum[c] += src[add + c] - src[drop + c];
    }
  }
}

// The glow: the art blurred (two box passes each way, close to a gaussian) and laid over it
// with "screen" at `intensity`.
function bloom(art: Raster, radius: number, intensity: number, wrap: boolean): Raster {
  const { width, height, data } = art;
  const n = width * height * 4;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 4) {
    const alpha = data[i + 3] / 255;
    a[i] = (data[i] / 255) * alpha;
    a[i + 1] = (data[i + 1] / 255) * alpha;
    a[i + 2] = (data[i + 2] / 255) * alpha;
    a[i + 3] = alpha;
  }
  const b = new Float32Array(n);
  const r = Math.max(1, Math.round(radius / 2));
  for (let pass = 0; pass < 2; pass++) {
    blurLine(a, b, width, height, r, true, wrap);
    blurLine(b, a, width, height, r, false, wrap);
  }
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 4) {
    const alpha = data[i + 3] / 255;
    const glowA = a[i + 3] * intensity;
    // Screen, premultiplied: s = base + glow - base * glow.
    const outA = alpha + glowA - alpha * glowA;
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const base = (data[i + c] / 255) * alpha;
      const glow = a[i + c] * intensity;
      out[i + c] = ((base + glow - base * glow) / outA) * 255;
    }
    out[i + 3] = outA * 255;
  }
  return { width, height, data: out };
}

// A flat field of one colour, for the page's background tile: the same renderer, so the tile
// matches the art's own background.
export function flatField(width: number, height: number, rgb255: Rgb): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb255[0];
    data[i + 1] = rgb255[1];
    data[i + 2] = rgb255[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}
