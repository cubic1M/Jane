// The motion spec (docs/design/area-pages.md, "Motion"), for what animates from JavaScript (the
// Web Animations API); src/app/globals.css has the same as --motion-* and --ease-*. Everything
// that moves takes one of these, and nothing moves under prefers-reduced-motion.
export const MOTION = {
  fastMs: 150,
  baseMs: 200,
  slowMs: 250,
  // Pop-ups and things that arrive: a little overshoot.
  spring: "cubic-bezier(0.2, 0.9, 0.3, 1.15)",
  // Everything else.
  standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

// Every marching dotted line (founder, 2026-10-26: "some are grey and some are white"): one
// colour, width, dash and speed, drawn by <MarchingPath> (src/components/marching-path.tsx) and
// .marching-line in src/app/globals.css (--line-march, --line-march-period).
export const MARCHING_LINE = {
  // A mid grey that reads on white, near-black and Jane's inverted cards alike.
  color: "#8a8a8a",
  width: 2,
  dash: "3 6",
  // One dash and gap travel by in this long; the line never marches under reduced motion.
  periodMs: 600,
} as const;
