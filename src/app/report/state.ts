import { COUNT_ONLY_WHEN_APPROVED } from "@/config/detection";
import { SUGGESTED_UPLOAD_DAYS } from "@/config/import";
import type { FindingType } from "@/generated/prisma/client";

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

// The line under "We found $X a year". Subscriptions count toward the total only once the
// person says to cancel them (COUNT_ONLY_WHEN_APPROVED), so when one is listed the line says
// so (overnight upload QA: "We found $289 a year" sat above three subscriptions worth $700).
export function foundLine(transactions: number, types: readonly FindingType[]): string {
  const base = `Estimates from ${transactions} transactions. The three that matter most are first; open one to decide.`;
  return types.some((t) => COUNT_ONLY_WHEN_APPROVED.includes(t))
    ? `${base} Subscriptions count toward the total once you decide to cancel them.`
    : base;
}
