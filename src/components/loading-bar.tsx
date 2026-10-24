"use client";

import { useEffect, useState } from "react";
import { scanBarText } from "@/app/scanning/stages";

// The loading bar (founder: "when you open a subsection, it should always show a loading bar
// ... instead of the simple 'Loading xxx....'. The loading bar should not cover up anything"):
// "[████░░░░░░░░░░░░] 34% · loading taxes", in the page's flow where the content will be, never
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
      className="overflow-hidden py-1 font-mono text-xs whitespace-nowrap text-zinc-700 tabular-nums dark:text-zinc-300"
    >
      {scanBarText(shown, label)}
    </div>
  );
}
