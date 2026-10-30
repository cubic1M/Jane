import { COUNT_ONLY_WHEN_APPROVED } from "@/config/detection";
import { PLAN_URGENT_FINDING_TYPES } from "@/config/plan";
import { CONFIDENCE_SCORE, REPORT_LIKELIHOOD } from "@/config/priorities";
import { confidenceOf, counted } from "@/profile/confidence";
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

// The report's order: the time-sensitive first, then by what each is likely to be worth (its
// yearly figure, times how likely that is to be a real saving and how sure Jane is), so a
// subscription that's only a saving if it's unused doesn't outrank surer money.
type Rankable = {
  id: string;
  type: FindingType;
  annualSavingsCents: number | null;
  confidence: keyof typeof CONFIDENCE_SCORE;
};
export const likelyWorth = (f: Rankable): number =>
  (f.annualSavingsCents ?? 0) * (REPORT_LIKELIHOOD[f.type] ?? 1) * CONFIDENCE_SCORE[f.confidence];

export function reportOrder<T extends Rankable>(findings: readonly T[]): T[] {
  const urgent = (f: T) => PLAN_URGENT_FINDING_TYPES.includes(f.type);
  return [...findings].sort(
    (a, b) =>
      Number(urgent(b)) - Number(urgent(a)) ||
      likelyWorth(b) - likelyWorth(a) ||
      a.id.localeCompare(b.id),
  );
}

// How sure Jane is of a finding, for its line on the report (demo-video list: the list showed
// none). The same words the cards and /jane say, from one source (demo-video re-take: idle cash
// read 59% on its card and 62% on the report; fees "12" on /jane and "6" here): the scan's
// suggestion on the same topic when there is one; else worked out the way the suggestions are
// (src/profile/confidence.ts), from the months of data and every charge behind the finding.
export type SuggestionSure = { topic: string; confidencePercent: number; confidenceReason: string };

// `sameType` is how many findings share this one's topic: the suggestion speaks for all of them
// (debugger 10-30: fees on two accounts, "5 bank fees" on the card whose own finding rests on 1),
// so with more than one each counts its own charges.
export function findingSure(
  finding: { type: string; evidence: unknown },
  suggestions: readonly SuggestionSure[],
  months: number,
  sameType = 1,
): { percent: number; reason: string } {
  const same = sameType === 1 ? suggestions.find((s) => s.topic === finding.type) : undefined;
  if (same) return { percent: same.confidencePercent, reason: same.confidenceReason };
  const charges = evidenceCharges(finding.evidence);
  const span = `${months} month${months === 1 ? "" : "s"} of data`;
  return {
    percent: confidenceOf("seen", { months, matches: charges || months }),
    reason: charges > 0 ? `${counted(charges, "charges")} in ${span}` : span,
  };
}

// Every dated charge a finding rests on: all of them, not the few its card lists.
export function evidenceCharges(evidence: unknown): number {
  if (!evidence || typeof evidence !== "object") return 0;
  const e = evidence as Record<string, unknown>;
  return ["transactions", "charges"].reduce(
    (n, k) => n + (Array.isArray(e[k]) ? (e[k] as unknown[]).length : 0),
    0,
  );
}
