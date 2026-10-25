"use client";

import { useEffect, useRef, useState } from "react";
import { panOffset, toLines } from "@/lib/column-art";

// The landing page's column (founder, 2026-10-25): the founder's drawing of a weathered column,
// its capital broken and its shaft cracked, mending down to a perfect base
// (public/landing/column.png), drawn in very fine ASCII as wide as its panel. It's several
// screens tall; as the page scrolls it pans from the capital at the top down to the base.

const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SOURCE = "/landing/column.png";

type Drawing = { font: number; text: string; height: number };

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function draw(width: number): Promise<Drawing | null> {
  // Tiny characters for detail.
  const font = width >= 600 ? 3 : 2.6;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = `${font}px ${FONT}`;
  const advance = measure.measureText("M").width || font * 0.6;
  const img = await load(SOURCE);
  // As wide as the panel; as tall as the drawing's proportions make it.
  const cols = Math.floor(width / advance);
  const height = (cols * advance * img.height) / img.width;
  const rows = Math.round(height / font);
  if (cols < 20 || rows < 20) return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cols, rows);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cols, rows);
  const pixels = ctx.getImageData(0, 0, cols, rows).data;
  const lum = new Float32Array(cols * rows);
  // Deepen the mid-tones: the drawing is pale marble, and at this size light glyphs vanish.
  for (let i = 0; i < lum.length; i++) {
    const v = pixels[i * 4] / 255;
    lum[i] = v > 0.95 ? v : Math.pow(v, 2.4);
  }
  return { font, text: toLines(lum, cols, rows).join("\n"), height: rows * font };
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
      draw(next)
        .then((d) => {
          if (live) setDrawing(d);
        })
        .catch(() => {});
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
