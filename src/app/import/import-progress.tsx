"use client";

import { useEffect, useRef, useState } from "react";
import { IMPORT_STEPS, importPercent, stepLabel, type ImportStep } from "./progress";

// The import's real steps as they happen (src/app/import/progress.ts), in the page's flow
// under the Import button: a bar that only moves forward and the list of steps, each ticked
// when the next starts. Fits a phone.

const TICK_MS = 250;
// How long a step's creep takes to cover most of its way.
const CREEP_MS = 4000;

export function ImportProgress({ step, rows }: { step: ImportStep | null; rows: number | null }) {
  const [percent, setPercent] = useState(0);
  const since = useRef<{ step: ImportStep | null; at: number } | null>(null);
  const current = step === null ? -1 : IMPORT_STEPS.findIndex((s) => s.step === step);

  useEffect(() => {
    if (since.current?.step !== step) since.current = { step, at: Date.now() };
    const tick = () => {
      const creep = 1 - Math.exp(-(Date.now() - (since.current?.at ?? Date.now())) / CREEP_MS);
      setPercent((p) => Math.max(p, importPercent(step, creep)));
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [step]);

  return (
    <div data-import-progress="" className="flex flex-col gap-3">
      <div
        role="progressbar"
        aria-label="Importing your statements"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="flex flex-col gap-1"
      >
        <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-3 bg-zinc-900 transition-[width] duration-500 ease-out motion-reduce:transition-none dark:bg-zinc-100"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-sm text-zinc-600 tabular-nums dark:text-zinc-400">{percent}%</p>
      </div>
      <ol className="flex flex-col gap-2" aria-live="polite">
        {IMPORT_STEPS.map(({ step: s }, i) => {
          const finished = i < current;
          const running = i === current;
          return (
            <li key={s} data-step={s} className="flex items-center gap-3 text-sm">
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  finished
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : running
                      ? "border-2 border-zinc-900 dark:border-zinc-100"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
                }`}
              >
                {finished ? "✓" : i + 1}
              </span>
              <span className={finished || running ? "" : "text-zinc-500"}>
                {stepLabel(s, rows)}
                {running && <span className="sr-only"> (in progress)</span>}
                {finished && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
