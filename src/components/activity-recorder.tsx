"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { startRecorder } from "@/lib/activity/recorder";

// The beta's activity log in the browser (src/lib/activity/recorder.ts), mounted once from the
// app layout: pages and buttons, never what anyone types. Its code loads once the page is up, in a
// chunk of its own, so no page waits for it (speed round, 11-15).
export function ActivityRecorder() {
  const pathname = usePathname();
  const recorder = useRef<ReturnType<typeof startRecorder> | null>(null);
  const page = useRef(pathname);

  useEffect(() => {
    let stopped = false;
    void import("@/lib/activity/recorder").then(({ startRecorder }) => {
      if (stopped) return;
      recorder.current = startRecorder({ framed: window.self !== window.top });
      recorder.current.page(page.current);
    });
    return () => {
      stopped = true;
      recorder.current?.stop();
      recorder.current = null;
    };
  }, []);

  useEffect(() => {
    page.current = pathname;
    recorder.current?.page(pathname);
  }, [pathname]);

  return null;
}
