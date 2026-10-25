"use client";

import { useEffect, useRef, useState } from "react";

// The landing page's pillar (founder, 2026-10-25): the founder's eight drawings of a Roman column,
// from "Very Broken" to "Almost Perfect", as ASCII (scripts/pillars/build.ts). It stays still on
// screen while the story scrolls past, and the further down the page, the more it's repaired:
// between two drawings each character switches over at its own moment, bottom first, so the
// column rebuilds smoothly instead of jumping. Scrolling back up breaks it again.

type Frames = { cols: number; rows: number; frames: string[] };

// The widths built by the script, the largest that fits each screen.
const WIDTHS = [
  { min: 1280, cols: 300 },
  { min: 1024, cols: 220 },
  { min: 640, cols: 150 },
  { min: 0, cols: 96 },
];
const GLYPH_ASPECT = 0.6;

const widthFor = (px: number) => WIDTHS.find((w) => px >= w.min)!.cols;

// Each frame as a grid of rows padded to the full width, so every character has a place.
function grids(data: Frames): string[][] {
  return data.frames.map((frame) =>
    frame.split("\n").map((line) => line.padEnd(data.cols, " ").slice(0, data.cols)),
  );
}

// When each character switches to the next drawing, between 0 and 1: random, but lower towards
// the bottom so the column rebuilds from its base up. Seeded, so it's the same on every visit.
function thresholds(rows: number, cols: number): Float32Array {
  const out = new Float32Array(rows * cols);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const row = Math.floor(i / cols);
    out[i] = 0.72 * (seed / 0x7fffffff) + 0.28 * (1 - row / rows);
  }
  return out;
}

// How far down the page, 0 at the top and 1 at the bottom.
function progress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
}

export function PillarStory({ initial }: { initial: Frames }) {
  const pre = useRef<HTMLPreElement>(null);
  const [data, setData] = useState<Frames>(initial);
  const [stage, setStage] = useState(1);

  // The most detailed drawing the screen fits.
  useEffect(() => {
    const cols = widthFor(window.innerWidth);
    if (cols === initial.cols) return;
    let live = true;
    fetch(`/landing/pillar-${cols}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Frames>) : null))
      .then((next) => {
        if (live && next) setData(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [initial.cols]);

  useEffect(() => {
    const el = pre.current;
    if (!el) return;
    const frames = grids(data);
    const when = thresholds(data.rows, data.cols);
    const last = frames.length - 1;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let shown = "";
    let queued = 0;

    const draw = () => {
      queued = 0;
      const at = progress() * last;
      const from = Math.min(last - 1, Math.floor(at));
      // Reduced motion: whole drawings only, no character-by-character change.
      const t = still ? Math.round(at - from) : at - from;
      const a = frames[from];
      const b = frames[from + 1];
      const lines: string[] = [];
      for (let r = 0; r < data.rows; r++) {
        const ra = a[r];
        const rb = b[r];
        if (t <= 0 || ra === rb) lines.push(t >= 1 ? rb : ra);
        else if (t >= 1) lines.push(rb);
        else {
          let line = "";
          const base = r * data.cols;
          for (let c = 0; c < data.cols; c++) line += when[base + c] < t ? rb[c] : ra[c];
          lines.push(line);
        }
      }
      const text = lines.join("\n");
      if (text !== shown) {
        el.textContent = text;
        shown = text;
      }
      setStage(Math.round(at) + 1);
    };
    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (queued) cancelAnimationFrame(queued);
    };
  }, [data]);

  return (
    <div
      data-testid="landing-pillar"
      data-stage={stage}
      aria-hidden="true"
      className="pillar-stage pointer-events-none flex h-full w-full items-center justify-center overflow-hidden [container-type:size]"
    >
      <pre
        ref={pre}
        className="pillar-art m-0 leading-none whitespace-pre text-[var(--landing-hi)] select-none"
        style={{
          // A system monospace face, always there: the drawing only holds together when every
          // character, spaces included, is exactly as wide as the next.
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
          // As large as fits both ways: its width in glyphs and its height in lines.
          fontSize: `min(calc(100cqw / ${(data.cols * GLYPH_ASPECT).toFixed(1)}), calc(100cqh / ${data.rows}))`,
        }}
      >
        {initial.frames[0]}
      </pre>
    </div>
  );
}
