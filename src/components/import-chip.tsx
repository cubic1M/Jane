"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { chipRoomCookie } from "@/lib/import-chip-room";
import { useCallback, useEffect, useRef, useState } from "react";
import { dismissImport } from "@/app/import/actions";
import { IMPORT_POLL_MS, IMPORT_STARTED_EVENT } from "@/config/import";
import { DATA_CHANGED_EVENT } from "@/config/side-chat";
import type { ImportRunView } from "@/lib/import/background";
import { askImportStatus } from "@/lib/import/chip-status";
import { formatWholeDollars } from "@/lib/money";

// An upload finishing in the background (src/lib/import/background.ts), on every page: a small
// chip at the top, "Importing 172 transactions… 40%", then "Done: found $360/yr". It never
// covers the page or stops a tap. It asks /api/import/status when a page first loads and
// when /import says an upload was saved, then every IMPORT_POLL_MS until the upload is done;
// then the page's numbers are loaded again, so they show the new rows.

const RUNNING = new Set(["queued", "matching", "balances", "looking", "refreshing"]);

// `room`: the page's HTML keeps the notice's room on a phone, because it showed on the last page
// (src/lib/import-chip-room.ts), until the first answer says what to put in it.
export function ImportChip({ room = false }: { room?: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<ImportRunView | null>(null);
  const [answered, setAnswered] = useState(false);
  // The last answer, to tell when a running upload has just finished.
  const last = useRef<ImportRunView | null>(null);

  // Only the newest answer counts: under load the page's first "nothing running" could land after
  // the upload's own check and blank the chip, which then never asked again (demo-polish e2e).
  const asked = useRef(0);
  const [unheard, setUnheard] = useState(0);
  const check = useCallback(async () => {
    const ask = ++asked.current;
    const next = await askImportStatus();
    if (ask !== asked.current) return;
    // Didn't hear: what's on screen stands, and it asks again.
    if (next === "unknown") {
      setUnheard((n) => n + 1);
      return;
    }
    const before = last.current;
    last.current = next;
    setRun(next);
    setAnswered(true);
    // Finished while this page was open: its numbers are loaded again.
    if (before && RUNNING.has(before.stage) && next && !RUNNING.has(next.stage)) {
      router.refresh();
      // And the side chat, which is a page of its own in a frame.
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    }
  }, [router]);

  useEffect(() => {
    // The docked chat is the chat page in a frame, with this layout inside it too: only the
    // page around it shows the chip (QA: it sat over the chat's first message).
    if (window.self !== window.top) return;
    // Asked once the page has loaded, and again when /import saves an upload.
    const first = setTimeout(check, 0);
    const started = () => void check();
    window.addEventListener(IMPORT_STARTED_EVENT, started);
    return () => {
      clearTimeout(first);
      window.removeEventListener(IMPORT_STARTED_EVENT, started);
    };
  }, [check]);

  // A chip showing is asked about again on each new page: after "Delete all my data" (a client
  // navigation to /goodbye), there's no run, or no one to ask for, and it goes (it stayed,
  // "Done: found $228/yr", for a person whose account was gone).
  const pathname = usePathname();
  // The room the page's HTML kept is this page's for as long as it's open, even if the notice
  // turns out to be gone: the page never moves up under a tap. A new page starts without it.
  const [keepRoom, setKeepRoom] = useState(room);
  const [roomPage, setRoomPage] = useState(pathname);
  if (pathname !== roomPage) {
    setRoomPage(pathname);
    setKeepRoom(false);
  }
  useEffect(() => {
    if (!last.current || window.self !== window.top) return;
    const again = setTimeout(check, 0);
    return () => clearTimeout(again);
  }, [pathname, check]);

  useEffect(() => {
    if (unheard === 0) return;
    const again = setTimeout(check, IMPORT_POLL_MS);
    return () => clearTimeout(again);
  }, [unheard, check]);

  const running = run !== null && RUNNING.has(run.stage);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(check, IMPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [running, check]);

  // On the findings it points to, a finished upload's chip has said its piece: it goes, so it
  // doesn't follow the person to every page after (demo-video list).
  const arrived =
    run !== null && run.stage === "done" && run.kind === "upload" && pathname === "/report";
  const arrivedRun = arrived ? run.id : null;
  useEffect(() => {
    if (arrivedRun) void dismissImport(arrivedRun);
  }, [arrivedRun]);

  // While it shows, the next page keeps its room from the start (src/lib/import-chip-room.ts).
  const showing = run !== null && !arrived;
  useEffect(() => {
    if (!answered || window.self !== window.top) return;
    document.cookie = chipRoomCookie(showing);
  }, [answered, showing]);

  if (!run || arrived) {
    // On a phone only: a computer's notice floats.
    return keepRoom ? (
      <div
        aria-hidden
        data-import-chip-room=""
        className="order-first mx-4 mt-2 h-[38px] lg:hidden"
      />
    ) : null;
  }
  const close = () => {
    last.current = null;
    setRun(null);
    void dismissImport(run.id);
  };
  const rows = `${run.rows} transaction${run.rows === 1 ? "" : "s"}`;
  // After a removal or a balance given, the same work runs again: it's an update, not an import.
  const removal = run.kind !== "upload";

  return (
    <div
      role="status"
      aria-live="polite"
      data-import-chip={run.stage}
      data-import-run={run.id}
      // On a computer bottom left, like a toast, never over a heading (demo-video list: on /import
      // it sat over "# Upload statement files"). On a phone or tablet the first thing on the page,
      // in its own room (order-first in the body column): floating beside the Jane button, it sat
      // over Home's first screen right after an upload ("Your plan" before #1974, the chart's
      // 1W / 1M / 3M row after: mobile pass 11-16). The page moves down for it when it arrives.
      className="z-40 order-first mx-4 mt-2 flex min-h-[38px] max-w-[calc(100vw-2rem)] items-center gap-3 self-start rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs shadow-sm lg:fixed lg:text-sm lg:bottom-4 lg:left-4 lg:order-none lg:mx-0 lg:mt-0 lg:max-w-[calc(100vw-380px-2rem)] dark:border-zinc-700 dark:bg-zinc-950"
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
            {/* An update finds nothing new, so not "found $497/yr" (new-user pass: it said so
                after a card's balance was given). */}
            {removal
              ? "your numbers are up to date"
              : run.foundCents
                ? `found ${formatWholeDollars(run.foundCents)}/yr`
                : `${rows} read`}
          </span>
          {/* After "Start over" there's nothing to see. */}
          {(!removal || (run.foundCents ?? 0) > 0) && (
            <Link href="/report" className="font-medium underline" onClick={close}>
              See findings
            </Link>
          )}
        </>
      ) : (
        <span>
          {run.temporary
            ? "The import hit a problem. Upload the file again, or start over."
            : "The import hit a problem. Jane will try again shortly."}
        </span>
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
