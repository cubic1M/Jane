import { PRACTICE_IDEA_DAYS, PRACTICE_TOPIC } from "@/config/practice-suggestions";
import { SCAN_LABELS, type ScanKind } from "@/config/practice-scan";
import type { PracticeIdea } from "@/profile/build";
import type { ScanFlag } from "./practice-scan";
import { DAY_MS } from "@/lib/dates";

// The practice ideas a replay leaves waiting (Phase AW, Stage A), as openPracticeIdeas
// (src/lib/practice/ideas.ts) reads the live scan's back: the suggestions the replay kept (it
// skips as the live scan does, notAskedYet), from the last PRACTICE_IDEA_DAYS days, newest
// first. Pure: the detector harness gives them to the sample people.

export function ideasFrom(
  suggestions: readonly { date: string; flag: ScanFlag }[],
  today: string,
): PracticeIdea[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - PRACTICE_IDEA_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return suggestions
    .filter((k) => k.date >= since && k.date <= today)
    .sort((a, b) =>
      a.date === b.date ? (a.flag.key < b.flag.key ? -1 : 1) : a.date < b.date ? 1 : -1,
    )
    .flatMap(({ date, flag }) =>
      flag.ask && Object.hasOwn(PRACTICE_TOPIC, flag.kind)
        ? [
            {
              key: flag.key,
              kind: flag.kind,
              scannedAt: `${date}T21:30:00.000Z`,
              label: SCAN_LABELS[flag.kind as ScanKind],
              headline: flag.ask.headline,
              short: flag.ask.short,
              worthCents: flag.ask.worthCents,
              worthKind: flag.ask.worthKind,
              figures: flag.figures,
              caps: flag.caps,
              confidence: flag.confidence,
              trades: flag.trades.length,
            },
          ]
        : [],
    );
}
