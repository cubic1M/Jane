"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SCAN_PULSE_MS, SCAN_REFRESH_MAX_MS, SCAN_SLOW_REFRESH_MS } from "@/config/scan";

// While the first scan is still running, the open chat shows Jane's findings as soon as they
// are posted. It asks a cheap endpoint how many messages there are every SCAN_PULSE_MS and
// reloads the page when that is not the number shown (reloading the whole page every few
// seconds queued up behind the busy scan and the brief showed a minute late). A slow reload
// every SCAN_SLOW_REFRESH_MS is the safety net. The page stops rendering this once the scan is
// done, and it gives up after SCAN_REFRESH_MAX_MS either way.
// A failed telling is tried again a few times.
const OPENED_TRIES = 3;
const OPENED_RETRY_MS = 3_000;

export function ScanRefresher({ shown, opened = false }: { shown: number; opened?: boolean }) {
  const router = useRouter();
  // The chat is really on screen (a render alone is not: it also runs when a page is loaded ahead
  // of time): Jane's turn, when one is owed, starts now (/api/opened, src/lib/page-opened.ts).
  useEffect(() => {
    if (!opened) return;
    let tries = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const tell = () => {
      tries += 1;
      fetch("/api/opened", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: "chat" }),
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok && tries < OPENED_TRIES) retry = setTimeout(tell, OPENED_RETRY_MS);
        })
        .catch(() => {
          if (tries < OPENED_TRIES) retry = setTimeout(tell, OPENED_RETRY_MS);
        });
    };
    tell();
    return () => clearTimeout(retry);
    // `shown` too: a page that is refreshed in place and finds a turn owed again tells again (the
    // server starts nothing twice).
  }, [opened, shown]);
  useEffect(() => {
    const started = Date.now();
    let busy = false;
    const stop = () => {
      clearInterval(pulse);
      clearInterval(slow);
    };
    const pulse = setInterval(async () => {
      if (Date.now() - started >= SCAN_REFRESH_MAX_MS) return stop();
      // More messages than one page: the count can't be compared, the slow reload covers it.
      if (busy || shown < 0) return;
      busy = true;
      try {
        const response = await fetch("/api/chat/pulse", { cache: "no-store" });
        const body = response.ok ? ((await response.json()) as { count?: number }) : null;
        if (typeof body?.count === "number" && body.count !== shown) router.refresh();
      } catch {
        // Retried on the next pulse.
      } finally {
        busy = false;
      }
    }, SCAN_PULSE_MS);
    const slow = setInterval(() => router.refresh(), SCAN_SLOW_REFRESH_MS);
    return stop;
  }, [router, shown]);
  // Nothing to read: the page's loading bar (src/components/scan-bar.tsx) says how far the
  // scan has got (founder: the chat "should not show this message at all").
  return null;
}
