"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { startRecorder } from "@/lib/activity/recorder";

// The beta's activity log in the browser (src/lib/activity/recorder.ts), mounted once from the
// app layout: pages and buttons, never what anyone types.
export function ActivityRecorder() {
  const pathname = usePathname();
  const recorder = useRef<ReturnType<typeof startRecorder> | null>(null);

  useEffect(() => {
    recorder.current = startRecorder();
    return () => recorder.current?.stop();
  }, []);

  useEffect(() => {
    recorder.current?.page(pathname);
  }, [pathname]);

  return null;
}
