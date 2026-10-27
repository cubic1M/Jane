"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { dismissImport } from "@/app/import/actions";
import { IMPORT_POLL_MS, IMPORT_STARTED_EVENT } from "@/config/import";
import type { ImportRunView } from "@/lib/import/background";
import { formatWholeDollars } from "@/lib/money";

// An upload finishing in the background (src/lib/import/background.ts), on every page: a small
// chip at the top, "Importing 172 transactions… 40%", then "Done: found $360/yr". It never
// covers the page or stops a tap. It asks /api/import/status when a page first loads and
// when /import says an upload was saved, then every IMPORT_POLL_MS until the upload is done;
// then the page's numbers are loaded again, so they show the new rows.

const RUNNING = new Set(["queued", "matching", "balances", "looking", "refreshing"]);

async function fetchRun(): Promise<ImportRunView | null> {
  try {
    const response = await fetch("/api/import/status", { cache: "no-store" });
    if (!response.ok) return null;
    return ((await response.json()) as { run: ImportRunView | null }).run;
  } catch {
    return null;
  }
}

export function ImportChip() {
  const router = useRouter();
  const [run, setRun] = useState<ImportRunView | null>(null);
  // The last answer, to tell when a running upload has just finished.
  const last = useRef<ImportRunView | null>(null);

  const check = useCallback(async () => {
    const next = await fetchRun();
    const before = last.current;
    last.current = next;
    setRun(next);
    // Finished while this page was open: its numbers are loaded again.
    if (before && RUNNING.has(before.stage) && next && !RUNNING.has(next.stage)) {
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    // Asked once the page has loaded, and again when /import saves an upload.
    const first = setTimeout(check, 0);
    const started = () => void check();
    window.addEventListener(IMPORT_STARTED_EVENT, started);
    return () => {
      clearTimeout(first);
      window.removeEventListener(IMPORT_STARTED_EVENT, started);
    };
  }, [check]);

  const running = run !== null && RUNNING.has(run.stage);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(check, IMPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [running, check]);

  if (!run) return null;
  const close = () => {
    last.current = null;
    setRun(null);
    void dismissImport(run.id);
  };
  const rows = `${run.rows} transaction${run.rows === 1 ? "" : "s"}`;
  // After a removal the same work runs again: it's an update, not an import.
  const removal = run.kind === "removal";

  return (
    <div
      role="status"
      aria-live="polite"
      data-import-chip={run.stage}
      data-import-run={run.id}
      className="fixed top-2 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
    >
      {running ? (
        <>
          <span className="whitespace-nowrap">
            {removal ? "Updating your numbers" : `Importing ${rows}`}…{" "}
            <span className="tabular-nums">{run.percent}%</span>
          </span>
          <span aria-hidden className="hidden h-1.5 w-20 bg-zinc-200 sm:block dark:bg-zinc-800">
            <span
              className="block h-1.5 bg-zinc-900 transition-[width] duration-500 dark:bg-zinc-100"
              style={{ width: `${run.percent}%` }}
            />
          </span>
        </>
      ) : run.stage === "done" ? (
        <>
          <span>
            Done:{" "}
            {run.foundCents ? `found ${formatWholeDollars(run.foundCents)}/yr` : `${rows} read`}
          </span>
          <Link href="/report" className="font-medium underline" onClick={close}>
            See findings
          </Link>
        </>
      ) : (
        <span>The import hit a problem. Jane will try again shortly.</span>
      )}
      {!running && (
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}
