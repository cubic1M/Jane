"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SCAN_REFRESH_MAX_MS, SCAN_REFRESH_MS } from "@/config/scan";

// While the first scan is still running, the open chat reloads itself every few seconds so
// Jane's findings appear as they're ready. The page stops rendering this once the scan is
// done, and it gives up after SCAN_REFRESH_MAX_MS either way.
export function ScanRefresher() {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= SCAN_REFRESH_MAX_MS) return clearInterval(timer);
      router.refresh();
    }, SCAN_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
      Jane is still looking through your accounts. This page fills in by itself.
    </p>
  );
}
