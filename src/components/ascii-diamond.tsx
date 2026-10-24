"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LANDING_ART } from "@/config/landing-art";
import { flatField, renderDiamonds } from "@/lib/ascii-diamond";

// The landing page's art (founder, 2026-10-24): the picture as ASCII diamonds
// (src/lib/ascii-diamond.ts, recipe in src/config/landing-art.ts). The pre-rendered poster is
// the first paint and what shows without JavaScript; then the same renderer draws it once onto
// a canvas at the screen's pixel ratio, cached, and again only when its size changes (resizes
// are debounced). Nothing animates; the canvas fades in over the poster, and not even that
// under reduced motion. Decorative: the words beside it say everything.
//
// The page's background tile (DiamondBackground) is the same diamonds over the picture's own
// background colour; the art sets --diamond-grid-x/y on it so the tile's cells line up with its
// own.

const RESIZE_DEBOUNCE_MS = 200;
const ASPECT = LANDING_ART.crop.height / LANDING_ART.crop.width;

// Rendered art by device size, so a remount or a resize back costs nothing.
const cache = new Map<string, ImageData>();
let sourceImage: Promise<HTMLImageElement> | null = null;

function loadSource(): Promise<HTMLImageElement> {
  sourceImage ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("landing art source didn't load"));
    img.src = LANDING_ART.source;
  });
  return sourceImage;
}

async function rendered(width: number, height: number, dpr: number): Promise<ImageData> {
  const key = `${width}x${height}@${dpr}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = await loadSource();
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  const { crop } = LANDING_ART;
  ctx.drawImage(
    img,
    crop.x * img.naturalWidth,
    crop.y * img.naturalHeight,
    crop.width * img.naturalWidth,
    crop.height * img.naturalHeight,
    0,
    0,
    width,
    height,
  );
  const art = renderDiamonds(
    { width, height, data: ctx.getImageData(0, 0, width, height).data },
    LANDING_ART.recipe.cellSize * dpr,
    LANDING_ART.recipe,
  );
  const image = new ImageData(new Uint8ClampedArray(art.data), width, height);
  cache.set(key, image);
  return image;
}

// Lines the background tile's cells up with the art's: the tile starts where the art's grid
// does, measured from the background's own corner.
// The canvas is also nudged onto whole device pixels and sized exactly to its pixels, so the
// browser never resamples it: its dots stay as crisp as the tile's.
function alignGrid(el: HTMLElement, out: HTMLCanvasElement, dpr: number, w: number, h: number) {
  const art = el.getBoundingClientRect();
  const nudge = (v: number) => (Math.round(v * dpr) - v * dpr) / dpr;
  const [dx, dy] = [nudge(art.left), nudge(art.top)];
  out.style.width = `${w / dpr}px`;
  out.style.height = `${h / dpr}px`;
  out.style.transform = `translate(${dx}px, ${dy}px)`;
  const layer = document.querySelector<HTMLElement>("[data-diamond-background]");
  if (!layer) return;
  const cell = LANDING_ART.recipe.cellSize;
  const from = layer.getBoundingClientRect();
  const x = (((art.left + dx - from.left) % cell) + cell) % cell;
  const y = (((art.top + dy - from.top) % cell) + cell) % cell;
  layer.style.setProperty("--diamond-grid-x", `${x.toFixed(3)}px`);
  layer.style.setProperty("--diamond-grid-y", `${y.toFixed(3)}px`);
}

// The art's edges fade into the page: its dots sit on the same grid as the background's, so the
// picture comes out of the pattern instead of sitting in a box.
const EDGE = "transparent, black 14%, black 86%, transparent";
const FADE: CSSProperties = {
  maskImage: `linear-gradient(to right, ${EDGE}), linear-gradient(to bottom, ${EDGE})`,
  maskComposite: "intersect",
  WebkitMaskImage: `linear-gradient(to right, ${EDGE}), linear-gradient(to bottom, ${EDGE})`,
  WebkitMaskComposite: "source-in",
};

export function AsciiDiamond({ className = "" }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = box.current;
    const out = canvas.current;
    if (!el || !out || typeof ResizeObserver === "undefined") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const draw = () => {
      const cssWidth = el.clientWidth;
      if (cssWidth === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.round(cssWidth * dpr);
      const height = Math.round(width * ASPECT);
      alignGrid(el, out, dpr, width, height);
      const key = `${width}x${height}@${dpr}`;
      if (key === last) return;
      last = key;
      rendered(width, height, dpr)
        .then((image) => {
          if (!alive) return;
          out.width = width;
          out.height = height;
          out.getContext("2d")?.putImageData(image, 0, 0);
          setDrawn(true);
        })
        .catch(() => {
          // The poster stays.
        });
    };
    draw();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(draw, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      alive = false;
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={box}
      aria-hidden="true"
      data-testid="landing-art"
      data-rendered={drawn ? "canvas" : "poster"}
      className={`relative w-full ${className}`}
      style={{ aspectRatio: `${1} / ${ASPECT}`, ...FADE }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-rendered pixels, shown as they are */}
      <img
        src={LANDING_ART.poster}
        alt=""
        className={`absolute inset-0 size-full ${drawn ? "invisible" : ""}`}
      />
      <canvas
        ref={canvas}
        className={`absolute top-0 left-0 transition-opacity duration-200 motion-reduce:transition-none ${drawn ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

// The pre-rendered tile is for 2x screens; any other pixel ratio gets its own, from the same
// renderer, so its dots are exactly the art's.
const PRE_RENDERED_DPR = 2;
const tiles = new Map<number, string>();

function tileFor(dpr: number): string {
  const hit = tiles.get(dpr);
  if (hit) return hit;
  const { recipe, tileCells, background } = LANDING_ART;
  const size = Math.round(tileCells * recipe.cellSize * dpr);
  const art = renderDiamonds(
    flatField(size, size, [...background]),
    recipe.cellSize * dpr,
    recipe,
    {
      wrap: true,
    },
  );
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(new Uint8ClampedArray(art.data), size, size), 0, 0);
  const url = canvas.toDataURL("image/png");
  tiles.set(dpr, url);
  return url;
}

// The whole page's dotted diamonds: the tile (the same renderer over the picture's background
// colour) repeated, lined up with the art's own cells.
export function DiamondBackground() {
  const [tile, setTile] = useState<string>(LANDING_ART.tile);
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (dpr === PRE_RENDERED_DPR) return;
    const id = requestAnimationFrame(() => setTile(tileFor(dpr)));
    return () => cancelAnimationFrame(id);
  }, []);
  const size = LANDING_ART.tileCells * LANDING_ART.recipe.cellSize;
  const style: CSSProperties = {
    backgroundImage: `url(${tile})`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: "var(--diamond-grid-x, 0px) var(--diamond-grid-y, 0px)",
  };
  return (
    <div
      aria-hidden="true"
      data-testid="diamond-background"
      data-diamond-background=""
      className="pointer-events-none absolute inset-0 -z-10"
      style={style}
    />
  );
}
