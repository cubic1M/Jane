import type { CheckRun } from "./run";

// The nightly scores over time (spec step 195): kept in docs/chat-quality-history.json, one
// entry a night, so /admin and docs/chat-quality.md can show them and a drop can be seen.
// Only scores and the questions that failed: never an answer's words. Pure.

export type NightEntry = {
  date: string;
  mode: CheckRun["mode"];
  promptVersion: string;
  score: number | null;
  graded: number;
  skipped: number;
  costCents: number;
  firstWordsMs: number | null;
  // Questions that scored under FAIL_BELOW, worst first.
  failed: { id: string; text: string; score: number; reason: string }[];
};

export const FAIL_BELOW = 80;
// A score that falls by more than this since the last run in the same mode is a drop.
export const DROP_THRESHOLD = 2;
const KEEP_NIGHTS = 120;

export function entryOf(run: CheckRun, date: string): NightEntry {
  return {
    date,
    mode: run.mode,
    promptVersion: run.promptVersion,
    score: run.score,
    graded: run.graded,
    skipped: run.skipped,
    costCents: run.costCents,
    firstWordsMs: run.firstWordsMs?.median ?? null,
    failed: run.results
      .filter((r) => r.status === "graded" && (r.score ?? 100) < FAIL_BELOW)
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .slice(0, 30)
      .map((r) => ({ id: r.id, text: r.text, score: r.score!, reason: r.reason.slice(0, 200) })),
  };
}

export function appendEntry(history: readonly NightEntry[], entry: NightEntry): NightEntry[] {
  return [...history.filter((h) => !(h.date === entry.date && h.mode === entry.mode)), entry]
    .sort((a, b) => a.date.localeCompare(b.date) || a.mode.localeCompare(b.mode))
    .slice(-KEEP_NIGHTS);
}

// Why this night is a drop against the last one in the same mode, or null.
export function dropOf(history: readonly NightEntry[], entry: NightEntry): string | null {
  const before = [...history].filter((h) => h.mode === entry.mode && h.date < entry.date).at(-1);
  if (!before || before.score === null || entry.score === null) return null;
  if (before.score - entry.score <= DROP_THRESHOLD) return null;
  return `The ${entry.mode === "full" ? "graded (with Claude)" : "rules-only"} score fell from ${before.score} (${before.date}) to ${entry.score} (${entry.date}).`;
}

export const START = "<!-- nightly:start -->";
export const END = "<!-- nightly:end -->";

// The table of recent nights that goes between the markers in docs/chat-quality.md.
export function nightlyTable(history: readonly NightEntry[]): string {
  const rows = [...history].slice(-14).reverse();
  if (rows.length === 0) return "No nightly run has been recorded yet.";
  return [
    "| Night | Mode | Score | Graded | Skipped | Failing | First words (median) | Cost |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (r) =>
        `| ${r.date} | ${r.mode === "full" ? "with Claude" : "rules only"} | ${r.score ?? "–"} | ${r.graded} | ${r.skipped} | ${r.failed.length} | ${r.firstWordsMs === null ? "–" : `${r.firstWordsMs} ms`} | ${(r.costCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} |`,
    ),
  ].join("\n");
}

export function withNightlyTable(doc: string, history: readonly NightEntry[]): string {
  const block = `${START}\n${nightlyTable(history)}\n${END}`;
  if (doc.includes(START) && doc.includes(END)) {
    return doc.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  return `${doc.trimEnd()}\n\n## Nightly\n\nWritten by the nightly run (.github/workflows/chat-quality.yml).\n\n${block}\n`;
}
