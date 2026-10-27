import { SUGGESTED_UPLOAD_DAYS } from "@/config/import";

// What the report shows. While the first scan still runs it says so, with what's found so far,
// never "Nothing to fix right now" (messy-bank QA: an empty list while Jane was still reading).
export type ReportState = "no_data" | "scanning" | "nothing" | "found";

export function reportState({
  transactions,
  findings,
  firstDetectionDone,
  scanRunning,
}: {
  transactions: number;
  findings: number;
  // Detection has finished at least once (src/detection/engine.ts).
  firstDetectionDone: boolean;
  // A bank linked in the last few minutes is still being read (src/lib/scan.ts).
  scanRunning: boolean;
}): ReportState {
  if (transactions === 0) return scanRunning ? "scanning" : "no_data";
  if (!firstDetectionDone || scanRunning) return "scanning";
  return findings === 0 ? "nothing" : "found";
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Uploaded statements covering less than SUGGESTED_UPLOAD_DAYS: how many days they cover, so
// the report can ask for more months. Null when nothing was uploaded or there's enough.
export function shortUploadDays(
  first: Date | null,
  last: Date | null,
  enough = SUGGESTED_UPLOAD_DAYS,
): number | null {
  if (!first || !last) return null;
  const days = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  return days < enough ? days : null;
}
