import { ADVICE_TOPICS } from "@/config/suggestions";
import { DETECTORS, runDetectors } from "@/detectors";
import type { Detector, Suggestion } from "@/detectors/contract";
import { forTheBeta } from "@/lib/suggestions";
import { buildProfile } from "@/profile/build";
import { generateCsvPeople, type CsvSet } from "./people";
import { CSV_SETS } from "./report";
import { profileInputOfUpload, runUpload } from "./score";

// Which detectors allowed on real accounts ever fire on uploaded statements (Stage 1, roadmap item
// 6). The CSV bench's people go through the upload path, as a new person's files do, and every
// detector runs on what comes out. No database, and nobody real.

export const detectorId = (d: Pick<Detector, "capability" | "topic">) =>
  `${d.capability}:${d.topic}`;

// What a real account may be shown: never an advice topic.
export const allowedOnRealAccounts = DETECTORS.filter(
  (d) => !(ADVICE_TOPICS as readonly string[]).includes(d.topic),
);

export type SweepRow = {
  id: string;
  people: number;
  // Fired, then hidden: its button promises a page the read-only beta hides.
  hidden: number;
  threw: number;
  example: string | null;
};

export type Sweep = { people: number; rows: SweepRow[]; adviceBlocked: string[] };

export async function runSweep(sets: readonly CsvSet[] = CSV_SETS): Promise<Sweep> {
  const rows = new Map<string, SweepRow>(
    allowedOnRealAccounts.map((d) => [
      detectorId(d),
      { id: detectorId(d), people: 0, hidden: 0, threw: 0, example: null },
    ]),
  );
  let people = 0;
  for (const set of sets) {
    for (const person of generateCsvPeople(undefined, set)) {
      people += 1;
      const data = profileInputOfUpload(await runUpload(person));
      const fired: Suggestion[] = runDetectors(
        { profile: buildProfile(data), data },
        allowedOnRealAccounts,
        (d) => {
          rows.get(detectorId(d))!.threw += 1;
        },
      );
      const shown = new Set(forTheBeta(fired).map((s) => s.id));
      for (const s of fired) {
        const row = rows.get(`${s.capability}:${s.topic}`);
        if (!row) continue;
        row.people += 1;
        if (!shown.has(s.id)) row.hidden += 1;
        row.example ??= s.title;
      }
    }
  }
  return {
    people,
    rows: [...rows.values()].sort((a, b) => a.people - b.people || a.id.localeCompare(b.id)),
    adviceBlocked: DETECTORS.filter((d) => !allowedOnRealAccounts.includes(d)).map(detectorId),
  };
}
