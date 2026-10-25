"use client";

import { useEffect, useRef, useState } from "react";
import { draw as model, HEIGHT, panOffset, toLines, weather } from "@/lib/column-art";

// The landing page's column (founder, 2026-10-25), built from scratch (src/lib/column-art.ts):
// an Ionic column in very fine ASCII, its shaft about half the screen wide, ruined at the top and
// mended more and more down to a perfect base. It's several screens tall; as the page scrolls
// it pans from the cracked capital at the top down to the base at the bottom.

const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

type Drawing = { font: number; text: string; height: number; top: number; bottom: number };

function draw(width: number): Drawing | null {
  // Tiny characters for detail.
  const font = width >= 600 ? 3.2 : 2.6;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = `${font}px ${FONT}`;
  const advance = measure.measureText("M").width || font * 0.6;
  // The shaft's diameter: about half the screen on a computer, more on a phone.
  const wide = window.innerWidth >= 1024;
  const diameter = window.innerWidth * (wide ? 0.42 : 0.62);
  const cols = Math.floor(width / advance);
  const dc = diameter / advance;
  const dr = diameter / font;
  const rows = Math.ceil(HEIGHT * dr);
  if (cols < 20 || rows < 20) return null;
  const grid = model(cols, rows, cols / 2, dc, dr);
  const damage = weather(grid, 7);
  return {
    font,
    text: toLines(grid.lum, cols, rows).join("\n"),
    height: rows * font,
    top: damage.top,
    bottom: damage.bottom,
  };
}

// How far down the page, 0 at the top and 1 at the bottom.
function progress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

export function ColumnArt() {
  const panel = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLPreElement>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);

  // Draw for the panel's width, and again if it changes.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let width = 0;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redraw = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next === width) return;
      width = next;
      // Off the main paint: the drawing takes a moment.
      setTimeout(() => {
        if (live) setDrawing(draw(next));
      }, 0);
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(redraw, 150);
    });
    observer.observe(el);
    redraw();
    return () => {
      live = false;
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Pan with the page.
  useEffect(() => {
    const el = panel.current;
    const pre = art.current;
    if (!el || !pre || !drawing) return;
    let queued = 0;
    const place = () => {
      queued = 0;
      const offset = panOffset(progress(), drawing.height, el.clientHeight);
      pre.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
      el.dataset.progress = progress().toFixed(2);
    };
    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (queued) cancelAnimationFrame(queued);
    };
  }, [drawing]);

  return (
    <div
      ref={panel}
      data-testid="landing-column"
      data-height={drawing ? Math.round(drawing.height) : 0}
      data-damage-top={drawing?.top ?? 0}
      data-damage-bottom={drawing?.bottom ?? 0}
      aria-hidden="true"
      className="pointer-events-none h-full w-full overflow-hidden select-none"
    >
      <pre
        ref={art}
        className="m-0 whitespace-pre text-[var(--landing-hi)] will-change-transform"
        style={{
          fontFamily: FONT,
          fontSize: `${drawing?.font ?? 3}px`,
          lineHeight: `${drawing?.font ?? 3}px`,
        }}
      >
        {drawing?.text ?? ""}
      </pre>
    </div>
  );
}
