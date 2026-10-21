"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ScanProgress } from "@/lib/scan";
import { monthsLabel, percentFor, STAGES, stagesDone } from "./stages";

// The first scan as named steps and a bar that only moves forward, driven by what has
// really finished (GET /api/detection/status). The chat opens as soon as the accounts and
// transactions are in (it says Jane is still looking and fills in); the report waits for
// detection. Between finished steps the bar creeps toward the next one, never past it.
// Polled quickly while the first scan is young (the chat opens as soon as the data is in, and
// every poll interval is waiting time), then calmer.
const POLL_FAST_MS = 300;
const POLL_FAST_FOR_MS = 12_000;
const POLL_MS = 1000;
const TICK_MS = 250;
// How long a step's creep takes to cover most of its way.
const CREEP_MS = 6000;
// Opens at once: the bar's last move isn't worth a wait.
const HAND_OFF_MS = 0;
// After this long, offer the report anyway rather than leave someone staring at a bar.
const SLOW_MS = 25_000;

export function ScanningProgress({ next = "/report" }: { next?: "/report" | "/chat" }) {
  const router = useRouter();
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [percent, setPercent] = useState(0);
  const [slow, setSlow] = useState(false);
  const stageSince = useRef<{ done: number; at: number } | null>(null);
  const done = stagesDone(progress);
  // Where this screen hands off: the chat once transactions are in, the report once found.
  const opens = next === "/chat" ? done >= 2 : done >= 3;

  useEffect(() => {
    if (!opens) return;
    const timer = setTimeout(() => router.replace(next), HAND_OFF_MS);
    return () => clearTimeout(timer);
  }, [opens, router, next]);

  useEffect(() => {
    if (opens) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    async function check() {
      try {
        const response = await fetch("/api/detection/status", { cache: "no-store" });
        const body = response.ok ? ((await response.json()) as { progress?: ScanProgress }) : null;
        if (!cancelled && body?.progress) setProgress(body.progress);
      } catch {
        // A dropped request is retried on the next poll.
      }
      if (cancelled) return;
      if (Date.now() - started >= SLOW_MS) setSlow(true);
      timer = setTimeout(check, Date.now() - started < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_MS);
    }

    timer = setTimeout(check, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [opens]);

  // The bar: the finished steps' share plus a creep toward the next, and never back.
  useEffect(() => {
    if (stageSince.current?.done !== done) stageSince.current = { done, at: Date.now() };
    const tick = () => {
      const elapsed = Date.now() - (stageSince.current?.at ?? Date.now());
      const creep = 1 - Math.exp(-elapsed / CREEP_MS);
      setPercent((p) => Math.max(p, percentFor(done, creep)));
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [done]);

  return (
    <div className="flex flex-col gap-6">
      <div
        role="progressbar"
        aria-label="Scanning your money"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="flex flex-col gap-2"
      >
        <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-3 bg-emerald-700 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-sm text-zinc-600 tabular-nums dark:text-zinc-400">{percent}%</p>
      </div>
      <ol className="flex flex-col gap-3" aria-live="polite">
        {STAGES.map((stage, i) => {
          const label = i === 1 && progress ? monthsLabel(progress.months) : stage.label;
          const finished = i < done;
          const running = i === done;
          return (
            <li key={stage.label} className="flex items-center gap-3">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  finished
                    ? "bg-emerald-700 text-white"
                    : running
                      ? "border-2 border-emerald-700 text-emerald-700"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
                }`}
              >
                {finished ? "✓" : i + 1}
              </span>
              <span className={finished || running ? "" : "text-zinc-500"}>
                {label}
                {running && <span className="sr-only"> (in progress)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {slow && !opens && (
        <p className="text-zinc-600 dark:text-zinc-400">
          This is taking longer than usual.{" "}
          <Link href="/report" className="font-medium text-emerald-700 hover:underline">
            See your report
          </Link>{" "}
          and savings will appear as soon as they&apos;re ready.
        </p>
      )}
    </div>
  );
}
