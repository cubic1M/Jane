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
export function ScanRefresher({ shown }: { shown: number }) {
  const router = useRouter();
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
