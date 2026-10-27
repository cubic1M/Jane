// The import's progress bar on /import: the steps /api/import reports as each starts, and
// the share of the bar each is worth. Looking for savings takes longest, so it has the most.
// The bar only moves forward: a step's share is reached when it starts, and while it runs the
// bar creeps toward (never to) the next one.

export type ImportStep = "reading" | "sorting" | "saving" | "looking";

export type ImportEvent =
  | { stage: "reading" }
  | { stage: "sorting"; rows: number }
  | { stage: "saving" }
  | { stage: "looking" }
  | { type: "done"; foundCents: number; next: string }
  | { type: "error"; text: string };

export const IMPORT_STEPS: readonly { step: ImportStep; percent: number }[] = [
  { step: "reading", percent: 5 },
  { step: "sorting", percent: 25 },
  { step: "saving", percent: 45 },
  { step: "looking", percent: 65 },
];

export function stepLabel(step: ImportStep, rows: number | null): string {
  switch (step) {
    case "reading":
      return "Reading your file";
    case "sorting":
      return rows === null
        ? "Sorting your transactions"
        : `Sorting ${rows} transaction${rows === 1 ? "" : "s"}`;
    case "saving":
      return "Saving";
    case "looking":
      return "Looking for savings";
  }
}

// The bar for the step running now (null: not started), with a creep (0..1) toward the next.
export function importPercent(step: ImportStep | null, creep: number): number {
  if (step === null) return 0;
  const i = IMPORT_STEPS.findIndex((s) => s.step === step);
  const base = IMPORT_STEPS[i].percent;
  const next = IMPORT_STEPS[i + 1]?.percent ?? 100;
  return Math.round(base + (next - base) * 0.9 * Math.min(1, Math.max(0, creep)));
}

// Splits streamed text into whole lines: the events read so far, and what's left over.
export function readEvents(buffer: string): { events: ImportEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ImportEvent];
      } catch {
        return [];
      }
    });
  return { events, rest };
}
