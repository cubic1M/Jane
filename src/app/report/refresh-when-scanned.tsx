"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 2_000;

// While the report says Jane is still reading, it asks how the first scan is going and reloads
// the page's data once the findings are in (/api/detection/status, as /scanning does). Draws
// nothing; the page's loading bar is what the person sees.
export function RefreshWhenScanned() {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const id = setInterval(async () => {
      try {
        const response = await fetch("/api/detection/status", { cache: "no-store" });
        const body = response.ok
          ? ((await response.json()) as { complete?: boolean; progress?: { done?: boolean } })
          : null;
        if (!stopped && body?.complete) {
          stopped = true;
          clearInterval(id);
          router.refresh();
        }
      } catch {
        // Tried again on the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router]);
  return null;
}
