import type { Snapshot } from "@/lib/founder-numbers";
import { formatWholeDollars } from "@/lib/money";

// The rows of /admin/numbers: what each shows and how.

const MINUTE_MS = 60_000;

export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
}

const dollars = (cents: number | null) => (cents === null ? "–" : formatWholeDollars(cents));

export type Line = {
  name: string;
  value: (s: Snapshot) => number | null;
  show: (n: number | null) => string;
};

const count = (n: number | null) => (n === null ? "–" : String(n));

export const LINES: Line[] = [
  { name: "Signed up", value: (s) => s.signedUp, show: count },
  { name: "Uploaded or connected an account", value: (s) => s.added, show: count },
  { name: "Have at least one finding", value: (s) => s.withFinding, show: count },
  {
    name: "Found per person per year (median)",
    value: (s) => s.foundMedianCents,
    show: dollars,
  },
  { name: "Found per person per year (mean)", value: (s) => s.foundMeanCents, show: dollars },
  { name: "Fixes marked done", value: (s) => s.fixesDone, show: count },
  { name: "Verified savings per year", value: (s) => s.verified.cents, show: dollars },
  { name: "People with verified savings", value: (s) => s.verified.people, show: count },
  { name: "Weekly active people", value: (s) => s.weeklyActive, show: count },
  {
    name: "Sign-up to first finding (median)",
    value: (s) => s.medianMsToFirstFinding,
    show: formatDuration,
  },
];

export function change(line: Line, before: number | null, now: number | null): string {
  if (before === null || now === null) return "–";
  const diff = now - before;
  if (diff === 0) return "no change";
  const sign = diff > 0 ? "+" : "−";
  return `${sign}${line.show(Math.abs(diff))}`;
}
