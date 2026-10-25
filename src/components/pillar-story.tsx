"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { PILLAR_COLS, PILLAR_FRAMES, PILLAR_ROWS } from "@/content/pillar-frames";
import { CHAR_ASPECT } from "@/lib/ascii-art";
import { frameNumber, morph, stepped, thresholds, toGrid } from "@/lib/pillar-morph";

// The landing page's story (founder, 2026-10-25): an ASCII Roman column stays put on the screen
// while the words scroll past it, and the further down, the more it's repaired: broken at the
// top, whole beside "Try it with sample data" at the bottom. On a computer it stands on the right;
// on a phone it's behind the words, which sit on a scrim. It's fixed to the screen, so it never
// moves, footer and all. Scrolling is read once per frame (requestAnimationFrame) and the <pre>
// only changes when the picture does; its size never does, so nothing else on the page moves.
// Under reduced motion it steps whole frames.

const GRIDS = PILLAR_FRAMES.map((f) => toGrid(f, PILLAR_COLS, PILLAR_ROWS));
const LIMITS = thresholds(PILLAR_COLS, PILLAR_ROWS);

const SIZE = {
  "--pillar-rows": PILLAR_ROWS,
  "--pillar-cols": PILLAR_COLS * CHAR_ASPECT,
} as CSSProperties;

export function PillarStory({ children }: { children: ReactNode }) {
  const story = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = story.current;
    const pre = art.current;
    if (!el || !pre) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let queued = 0;
    let shown = "";
    const draw = () => {
      queued = 0;
      const box = el.getBoundingClientRect();
      const room = box.height - window.innerHeight;
      const progress = room > 0 ? Math.min(1, Math.max(0, -box.top / room)) : 1;
      const text = still.matches ? stepped(GRIDS, progress) : morph(GRIDS, progress, LIMITS);
      if (text !== shown) {
        pre.textContent = text;
        shown = text;
      }
      pre.dataset.frame = String(frameNumber(progress, GRIDS.length));
      pre.dataset.progress = progress.toFixed(3);
    };
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    still.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(queued);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      still.removeEventListener("change", schedule);
    };
  }, []);

  return (
    <div ref={story} className="relative mx-auto w-full max-w-6xl">
      {/* Fixed, so it never moves however far the page scrolls (the footer included): behind the
          words on a phone, the right half of the page's column on a computer. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center overflow-hidden opacity-45 lg:left-auto lg:right-[max(0px,calc((100vw-72rem)/2))] lg:w-[min(50vw,36rem)] lg:opacity-100"
      >
        <pre
          ref={art}
          data-testid="pillar"
          data-frame="1"
          className="pillar-art font-mono whitespace-pre text-zinc-700 select-none dark:text-zinc-300"
          style={SIZE}
        >
          {GRIDS[0].join("\n")}
        </pre>
      </div>
      <div className="relative px-4 sm:px-6 lg:w-1/2">{children}</div>
    </div>
  );
}
