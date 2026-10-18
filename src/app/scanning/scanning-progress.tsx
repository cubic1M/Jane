"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Imports finish before this page loads, so the steps only pace the hand-off to the
// report. Detection (step 4) will make the last step real.
const STEPS = ["Reading your transactions", "Sorting them into categories", "Looking for savings"];
const STEP_MS = 700;

export function ScanningProgress() {
  const router = useRouter();
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done < STEPS.length) {
      const timer = setTimeout(() => setDone((d) => d + 1), STEP_MS);
      return () => clearTimeout(timer);
    }
    router.replace("/report");
  }, [done, router]);

  return (
    <ol className="flex flex-col gap-3" aria-live="polite">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-3">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i < done ? "bg-emerald-700 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
            }`}
          >
            {i < done ? "✓" : i + 1}
          </span>
          <span className={i < done ? "" : "text-zinc-500"}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
