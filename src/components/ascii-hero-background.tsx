"use client";

import { useEffect, useState } from "react";

// The landing page's background (ASCII style): an ASCII-art animation. A small still frame
// shows at once; the animation (4.5 MB) replaces it once the page has loaded, unless the
// person prefers reduced motion or has asked their browser to save data. Light mode turns
// it into dark characters on white. Decorative only. Both files live in public/landing, so
// swapping the art is a matter of replacing them.

const STILL = "/landing/jane-ascii-poster.webp";
const ANIMATED = "/landing/jane-ascii.webp";

export function AsciiHeroBackground() {
  const [src, setSrc] = useState(STILL);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    if (still || saveData) return;
    const animate = () => setSrc(ANIMATED);
    if (document.readyState === "complete") animate();
    else window.addEventListener("load", animate, { once: true });
    return () => window.removeEventListener("load", animate);
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- an animated WebP, served as is */}
      <img
        src={src}
        alt=""
        className="absolute top-1/2 right-0 h-[115%] w-auto max-w-none -translate-y-1/2 opacity-60 sm:opacity-80 dark:opacity-90 [@media(prefers-color-scheme:light)]:invert"
      />
      {/* Fades the art out under the words. */}
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)] from-30% via-[var(--background)]/70 via-55% to-transparent" />
    </div>
  );
}
