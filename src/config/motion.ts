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
