"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { percentFor, scanBarText, stageLabel, stagesDone } from "@/app/scanning/stages";
import type { ScanProgress } from "@/lib/scan";

// The first scan's loading bar (founder: "replace it with like a loading bar during the initial
// entry of the site where data isn't fully loaded yet"), at the top of every page while Jane
// reads a new person's accounts: "[████████░░░░░░░░] 52% · reading transactions". It's driven
// by what has really finished (/api/detection/status, the same stages as /scanning), creeps
// toward the next stage while one runs, and fades out at 100%, when the page reloads its data.
// In the page's flow under the top bar, so it never covers a title, the card dock or the chat;
// still under reduced motion.

const POLL_MS = 1_500;
// The creep toward the next stage takes about this long.
const CREEP_MS = 6_000;

export function ScanBar({ initial }: { initial: ScanProgress }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ScanProgress>(initial);
  const [creep, setCreep] = useState(0);
  const [gone, setGone] = useState(false);
  // The latest progress, for the creep's timer.
  const latest = useRef(initial);
  useEffect(() => {
    latest.current = progress;
  });
  const done = progress.done;

  useEffect(() => {
    if (done) return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch("/api/detection/status", { cache: "no-store" });
        const body = response.ok ? ((await response.json()) as { progress?: ScanProgress }) : null;
        if (!stopped && body?.progress) setProgress(body.progress);
      } catch {
        // A dropped request is tried again on the next tick.
      }
    };
    const poll = setInterval(check, POLL_MS);
    // The creep starts again each time a stage finishes.
    let lastDone = -1;
    let since = Date.now();
    const tick = setInterval(() => {
      const finishedNow = stagesDone(latest.current);
      if (finishedNow !== lastDone) {
        lastDone = finishedNow;
        since = Date.now();
      }
      setCreep(Math.min(1, (Date.now() - since) / CREEP_MS));
    }, 250);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [done]);

  const finished = stagesDone(progress);

  // At 100% the page reloads what's now there, and the bar fades away.
  useEffect(() => {
    if (!done) return;
    router.refresh();
    const timer = setTimeout(() => setGone(true), 900);
    return () => clearTimeout(timer);
  }, [done, router]);

  if (gone) return null;
  const percent = done ? 100 : percentFor(finished, creep);
  const label = done ? "Ready" : stageLabel(progress);
  return (
    <div
      role="progressbar"
      aria-label="Jane is reading your accounts"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%, ${label}`}
      data-scan-bar=""
      className={`scan-bar flex h-6 items-center justify-center overflow-hidden bg-zinc-950 px-3 font-mono text-xs whitespace-nowrap text-zinc-50 tabular-nums dark:bg-zinc-50 dark:text-zinc-950 ${
        done ? "scan-bar-out" : ""
      }`}
    >
      {scanBarText(percent, label)}
    </div>
  );
}
