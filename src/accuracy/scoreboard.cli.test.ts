import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  fromFixture,
  generateHeldOut,
  generateHistories,
  toFixture,
  type BenchSet,
} from "./generate";
import {
  DETECTOR_NAMES,
  calibration,
  judgedSuggestions,
  levels,
  scoreboard,
  type Bucket,
  type DetectorName,
  type Score,
} from "./score";

// `npm run accuracy`: every detector on the labelled histories, precision and recall per
// detector and the false-alarm rate, then calibration (is "80% sure" right 80% of the time),
// for the tuning set and, separately, the held-out set. ACCURACY_WRITE=1 also rewrites the
// fixtures, the baseline the CI gate holds to (./baseline.json) and the scoreboard in
// docs/accuracy.md. ACCURACY_MISTAKES=1 lists the tuning set's mistakes, the ones to fix rules
// on; the held-out sets' are left out on purpose. Skipped in a normal test run.

export const FIXTURES: Record<BenchSet, string> = {
  tuning: "src/accuracy/__fixtures__/histories.json",
  "held-out": "src/accuracy/__fixtures__/held-out.json",
  "held-out-2": "src/accuracy/__fixtures__/held-out-2.json",
};
const BASELINE = "src/accuracy/baseline.json";
const DOC = "docs/accuracy.md";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function scoreTable(scores: Record<DetectorName, Score>): string {
  const rows = DETECTOR_NAMES.map((d) => {
    const s = scores[d];
    return `| ${d} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.falseAlarmRate)} | ${s.tp} | ${s.fp} | ${s.fn} |`;
  });
  return [
    "| Detector | Precision | Recall | False-alarm rate | Right | False alarms | Missed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

export function calibrationTable(buckets: Bucket[]): string {
  return [
    "| Said | Suggestions | Average said | Actually right |",
    "| --- | ---: | ---: | ---: |",
    ...buckets.map(
      (b) =>
        `| ${b.from}–${b.to}% | ${b.count} | ${b.count ? `${b.saidPercent}%` : "–"} | ${b.count ? `${b.rightPercent}%` : "–"} |`,
    ),
  ].join("\n");
}

const SET_NAMES: Record<BenchSet, string> = {
  tuning: "Tuning set",
  "held-out": "Held-out set",
  "held-out-2": "Second held-out set",
};

describe.runIf(process.env.ACCURACY === "1")("the accuracy scoreboard", () => {
  it("scores every detector on the labelled histories", () => {
    const write = process.env.ACCURACY_WRITE === "1";
    if (write) {
      writeFileSync(FIXTURES.tuning, `${JSON.stringify(toFixture(generateHistories()))}\n`);
      for (const set of ["held-out", "held-out-2"] as const) {
        const people = generateHeldOut(undefined, set);
        writeFileSync(FIXTURES[set], `${JSON.stringify(toFixture(people))}\n`);
      }
    }
    const baseline: Record<string, Record<string, { precision: number; recall: number }>> = {};
    const doc: string[] = [];
    for (const set of ["tuning", "held-out", "held-out-2"] as const) {
      const histories = fromFixture(JSON.parse(readFileSync(FIXTURES[set], "utf8")));
      const { scores, mistakes } = scoreboard(histories);
      const buckets = calibration(judgedSuggestions(histories));
      const byLevel = levels(histories);
      const people = `${histories.length} people, ${histories.reduce((n, h) => n + h.rows.length, 0)} transactions`;
      console.log(
        [
          `${SET_NAMES[set]}: ${people}`,
          scoreTable(scores),
          "",
          "Calibration (suggestions' confidence %):",
          calibrationTable(buckets),
          "",
          "Finding levels:",
          ...Object.entries(byLevel).map(
            ([level, { count, right }]) =>
              `${level}: ${right}/${count} right (${pct(right / count)})`,
          ),
          "",
        ].join("\n"),
      );
      if (set === "tuning" && process.env.ACCURACY_MISTAKES === "1") {
        for (const m of mistakes) console.log(`${m.detector} ${m.kind} ${m.person} ${m.item}`);
      }
      baseline[set] = Object.fromEntries(
        DETECTOR_NAMES.map((d) => [
          d,
          {
            precision: Number(scores[d].precision.toFixed(4)),
            recall: Number(scores[d].recall.toFixed(4)),
          },
        ]),
      );
      doc.push(
        `${SET_NAMES[set]} (${people}):`,
        "",
        scoreTable(scores),
        "",
        `Calibration, ${SET_NAMES[set].toLowerCase()}:`,
        "",
        calibrationTable(buckets),
        "",
      );
    }
    if (write) {
      writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
      const text = readFileSync(DOC, "utf8");
      const start = "<!-- scoreboard:start -->";
      const end = "<!-- scoreboard:end -->";
      const table = `${start}\n${doc.join("\n").trimEnd()}\n${end}`;
      writeFileSync(DOC, text.replace(new RegExp(`${start}[\\s\\S]*${end}`), table));
    }
  });
});
