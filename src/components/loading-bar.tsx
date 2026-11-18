"use client";

import { useEffect, useState } from "react";
import { DrawnBar } from "@/components/drawn-bar";

// The loading bar (founder: "when you open a subsection, it should always show a loading bar
// ... instead of the simple 'Loading xxx....'. The loading bar should not cover up anything"):
// a drawn bar and "34% · Loading taxes", in the page's flow where the content will be, never
// over the title, the card dock or the chat. Nobody knows how long a page takes, so it creeps
// toward 90% and the content replaces it; still under reduced motion.

const START = 8;
const CEILING = 90;
const TICK_MS = 250;

export function LoadingBar({ label = "Loading" }: { label?: string }) {
  const [percent, setPercent] = useState(START);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setPercent((p) => Math.min(CEILING, p + Math.max(0.5, (CEILING - p) * 0.08))),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, []);
  const shown = Math.round(percent);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      data-loading-bar=""
      className="flex items-center gap-3 overflow-hidden py-1 text-xs whitespace-nowrap text-zinc-700 tabular-nums dark:text-zinc-300"
    >
      <DrawnBar percent={shown} label={label} />
    </div>
  );
}
