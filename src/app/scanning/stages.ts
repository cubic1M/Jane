import type { ScanProgress } from "@/lib/scan";

// The named steps of the first scan and the share of the bar each one is worth, driven by
// what has really finished (src/lib/scan.ts scanProgress). The percentage only moves
// forward: a stage's share is reached when it finishes, and while it runs the bar creeps
// toward (never to) the next one.

export type Stage = { label: string; done: (p: ScanProgress) => boolean; percent: number };

export const monthsLabel = (months: number) =>
  months > 0
    ? `Reading ${months} month${months === 1 ? "" : "s"} of transactions`
    : "Reading your transactions";

export const STAGES: readonly Stage[] = [
  { label: "Linking your accounts", done: (p) => p.accounts, percent: 10 },
  { label: "Reading your transactions", done: (p) => p.transactions, percent: 40 },
  { label: "Finding what you're losing", done: (p) => p.detection, percent: 70 },
  {
    label: "Checking insurance, taxes, investing and loans",
    done: (p) => p.suggestions,
    percent: 92,
  },
  { label: "Ready", done: (p) => p.done, percent: 100 },
];

// How many stages are finished, in order (a later one done doesn't count before an earlier).
export function stagesDone(progress: ScanProgress | null): number {
  if (!progress) return 0;
  let n = 0;
  while (n < STAGES.length && STAGES[n].done(progress)) n += 1;
  return n;
}

// The bar for a state: the finished stages' share, plus a creep (0..1) of the way to the next.
export function percentFor(done: number, creep: number): number {
  const base = done === 0 ? 0 : STAGES[done - 1].percent;
  if (done >= STAGES.length) return 100;
  const next = STAGES[done].percent;
  return Math.round(base + (next - base) * 0.9 * Math.min(1, Math.max(0, creep)));
}

// What a slow scan offers instead of the bar: where this screen was heading. From Try Jane
// (then=home) that's Home, whose chat opens with Jane saying she's still looking.
export function slowLink(next: "/report" | "/home"): {
  href: string;
  label: string;
  after: string;
} {
  return next === "/home"
    ? {
        href: "/home",
        label: "Open Jane",
        after: "and Jane will post what she finds as it's ready.",
      }
    : {
        href: "/report",
        label: "See your report",
        after: "and savings will appear as soon as they're ready.",
      };
}

// The page's loading bar during the first scan (src/components/scan-bar.tsx), in ASCII:
// "[████████░░░░░░░░] 52% · reading transactions".
export const BAR_CELLS = 16;

export function scanBarText(percent: number, label: string): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((p / 100) * BAR_CELLS);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}] ${p}% · ${label.toLowerCase()}`;
}

// What's happening now: the first stage not yet finished.
export function stageLabel(progress: ScanProgress | null): string {
  const done = stagesDone(progress);
  if (done >= STAGES.length) return STAGES[STAGES.length - 1].label;
  const stage = STAGES[done];
  return stage.label === "Reading your transactions" && progress
    ? monthsLabel(progress.months)
    : stage.label;
}
