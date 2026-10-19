"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// The first steps pace the hand-off; the last one waits until detection has finished
// (GET /api/detection/status), then the report opens, or Jane's chat after linking the
// demo bank (spec step 82).
const STEPS = ["Reading your transactions", "Sorting them into categories", "Looking for savings"];
const STEP_MS = 700;
const POLL_MS = 1000;
// After this long, offer the report anyway rather than leave someone staring at a spinner.
const SLOW_MS = 20_000;

export function ScanningProgress({ next = "/report" }: { next?: "/report" | "/chat" }) {
  const router = useRouter();
  const [done, setDone] = useState(0);
  const [detected, setDetected] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const last = STEPS.length - 1;
    if (done === STEPS.length) {
      router.replace(next);
      return;
    }
    if (done === last && !detected) return;
    const timer = setTimeout(() => setDone((d) => d + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [done, detected, router, next]);

  useEffect(() => {
    if (detected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    async function check() {
      try {
        const response = await fetch("/api/detection/status", { cache: "no-store" });
        const body = response.ok ? ((await response.json()) as { complete?: boolean }) : null;
        if (body?.complete) {
          if (!cancelled) setDetected(true);
          return;
        }
      } catch {
        // A dropped request is retried on the next poll.
      }
      if (cancelled) return;
      if (Date.now() - started >= SLOW_MS) setSlow(true);
      timer = setTimeout(check, POLL_MS);
    }

    timer = setTimeout(check, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [detected]);

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3" aria-live="polite">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-3">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                i < done
                  ? "bg-emerald-700 text-white"
                  : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
              }`}
            >
              {i < done ? "✓" : i + 1}
            </span>
            <span className={i < done ? "" : "text-zinc-500"}>{step}</span>
          </li>
        ))}
      </ol>
      {slow && !detected && (
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
