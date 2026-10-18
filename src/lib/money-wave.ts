// The landing page's background (src/components/ui/money-surface.tsx): a field of dollar
// signs rolling like a wave. The numbers live here so they can be tested without WebGL.

// Space between neighbours, in scene units.
export const WAVE_SEPARATION = 150;

// How many signs across and deep. Phones get fewer, to spare the battery.
export function waveGrid(viewportWidth: number): { across: number; deep: number } {
  return viewportWidth < 640 ? { across: 24, deep: 36 } : { across: 40, deep: 60 };
}

// The height of the sign at grid position (ix, iy) at time t: two crossing sine waves.
export function waveHeight(ix: number, iy: number, t: number): number {
  return Math.sin((ix + t) * 0.3) * 50 + Math.sin((iy + t) * 0.5) * 50;
}

// Each sign's green, from deep emerald to a lighter mint, so the field has some depth.
// RGB in 0–1, as three.js vertex colours expect.
export function signColor(ix: number, iy: number, dark: boolean): [number, number, number] {
  const mix = (Math.sin(ix * 0.7) * Math.cos(iy * 0.4) + 1) / 2;
  const [from, to] = dark
    ? [
        [0.2, 0.83, 0.6], // emerald-400
        [0.65, 0.95, 0.82], // emerald-200
      ]
    : [
        [0.02, 0.47, 0.34], // emerald-700
        [0.06, 0.73, 0.51], // emerald-500
      ];
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * mix) as [number, number, number];
}
