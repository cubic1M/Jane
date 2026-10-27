import type { CheckRun } from "./run";
import { formatCents } from "@/lib/money";

// The nightly scores over time (spec step 195): kept in docs/chat-quality-history.json, one
// entry a night, so /admin and docs/chat-quality.md can show them and a drop can be seen.
// Only scores and the questions that failed: never an answer's words. Pure.

// The depth bar (docs/spec.md, "Depth first"): the share of questions Jane understood (an
// answer, not a fallback), the share of figures it got right, the share of follow-ups and
// two-part questions it handled (scoring at least FAIL_BELOW), and how long answers take.
export type Metrics = {
  understoodPct: number | null;
  figuresPct: number | null;
  followUpsPct: number | null;
  // The number each is a share of.
  counts: { questions: number; withFigures: number; followUps: number };
  firstWordsMs: number | null;
  fullAnswerMs: number | null;
};

// The bar, as percentages.
export const BAR = { understood: 95, figures: 100, followUps: 90 } as const;

export function metricsOf(results: CheckRun["results"]): Metrics {
  const graded = results.filter((r) => r.status === "graded");
  const share = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
  const med = (values: number[]) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const answered = graded.filter((r) => r.checks?.find((c) => c.name === "answered")?.ok);
  const withFigures = graded.filter((r) => r.checks?.some((c) => c.name === "figures"));
  const rightFigures = withFigures.filter((r) => r.checks?.find((c) => c.name === "figures")?.ok);
  const followUps = graded.filter((r) => r.followUp);
  const handled = followUps.filter((r) => (r.score ?? 0) >= FAIL_BELOW);
  return {
    understoodPct: share(answered.length, graded.length),
    figuresPct: share(rightFigures.length, withFigures.length),
    followUpsPct: share(handled.length, followUps.length),
    counts: {
      questions: graded.length,
      withFigures: withFigures.length,
      followUps: followUps.length,
    },
    firstWordsMs: med(
      graded.flatMap((r) => (r.firstWordsMs === undefined ? [] : [r.firstWordsMs])),
    ),
    fullAnswerMs: med(graded.flatMap((r) => (r.totalMs === undefined ? [] : [r.totalMs]))),
  };
}

// Whether a night meets the whole bar (a measure with nothing behind it doesn't).
export const meetsBar = (m: Metrics | undefined): boolean =>
  Boolean(
    m &&
    m.understoodPct !== null &&
    m.understoodPct >= BAR.understood &&
    m.figuresPct !== null &&
    m.figuresPct >= BAR.figures &&
    m.followUpsPct !== null &&
    m.followUpsPct >= BAR.followUps,
  );

export type NightEntry = {
  date: string;
  mode: CheckRun["mode"];
  promptVersion: string;
  score: number | null;
  graded: number;
  skipped: number;
  costCents: number;
  firstWordsMs: number | null;
  // Understood, right figures, follow-ups and timings (older nights have none).
  metrics?: Metrics;
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
    metrics: metricsOf(run.results),
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

// The table of recent nights that goes between the markers in docs/chat-quality.md, and the
// depth bar: the last nights with the three measures, the timings, and whether each met it.
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v}%`);
const secs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`;

export function nightlyTable(history: readonly NightEntry[]): string {
  const rows = [...history].slice(-14).reverse();
  if (rows.length === 0) return "No nightly run has been recorded yet.";
  const full = rows.filter((r) => r.mode === "full");
  const lastThree = full.slice(0, 3);
  const streak = lastThree.length === 3 && lastThree.every((r) => meetsBar(r.metrics));
  return [
    `**The depth bar**: understood at least ${BAR.understood}%, figures right ${BAR.figures}%, follow-ups and two-part questions at least ${BAR.followUps}%, three nights in a row. ${streak ? "Met for the last three nights." : "Not met yet."}`,
    "",
    "| Night | Mode | Understood | Figures right | Follow-ups | First words | Full answer | Score | Graded | Failing | Cost | Bar |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |",
    ...rows.map(
      (r) =>
        `| ${r.date} | ${r.mode === "full" ? "with Claude" : "rules only"} | ${pct(r.metrics?.understoodPct)} | ${pct(r.metrics?.figuresPct)} | ${pct(r.metrics?.followUpsPct)} | ${secs(r.metrics?.firstWordsMs ?? r.firstWordsMs)} | ${secs(r.metrics?.fullAnswerMs)} | ${r.score ?? "–"} | ${r.graded} | ${r.failed.length} | ${formatCents(r.costCents)} | ${meetsBar(r.metrics) ? "yes" : "no"} |`,
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
