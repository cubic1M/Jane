import { PEOPLE } from "@/config/people";
import { runHarness } from "@/detectors/harness";
import { INVESTING_TRUTH } from "./truth";

// The investing accuracy bench (docs/detectors/investing.md): each investing detector scored on
// the eight sample people against the truth in ./truth.ts. Pure and database-free.
// precision = right fires / all fires that weren't "maybe"; recall = right fires / people it
// should reach. A detector that fires for no one and should for no one scores 1 and 1.

export type DetectorScore = {
  topic: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  falseFires: string[];
  missed: string[];
};

export function scoreInvesting(): DetectorScore[] {
  const fired = new Map<string, Set<string>>();
  for (const r of runHarness()) fired.set(r.person.id, new Set(r.fired.map((s) => s.topic)));
  return Object.entries(INVESTING_TRUTH).map(([topic, truth]) => {
    const yes = new Set<string>(truth.yes);
    const maybe = new Set<string>(truth.maybe ?? []);
    let tp = 0;
    const falseFires: string[] = [];
    const missed: string[] = [];
    for (const p of PEOPLE) {
      const did = fired.get(p.id)?.has(topic) ?? false;
      if (did && yes.has(p.id)) tp += 1;
      else if (did && !maybe.has(p.id)) falseFires.push(p.id);
      else if (!did && yes.has(p.id)) missed.push(p.id);
    }
    const fp = falseFires.length;
    const fn = missed.length;
    return {
      topic,
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
      falseFires,
      missed,
    };
  });
}

export function formatScores(scores: readonly DetectorScore[]): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    "| Detector | Precision | Recall | False fires | Missed |",
    "| --- | ---: | ---: | --- | --- |",
    ...scores.map(
      (s) =>
        `| ${s.topic} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.falseFires.join(", ") || "–"} | ${s.missed.join(", ") || "–"} |`,
    ),
  ].join("\n");
}
