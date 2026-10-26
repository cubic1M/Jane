import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { fromFixture, generateHistories, toFixture } from "./generate";
import {
  DETECTOR_NAMES,
  calibration,
  judgedLifeFacts,
  judgedSuggestions,
  levels,
  scoreboard,
  type Bucket,
  type DetectorName,
  type Score,
} from "./score";

// `npm run accuracy`: every detector on the labelled histories, precision and recall per
// detector and the false-alarm rate, then calibration (is "80% sure" right 80% of the time).
// ACCURACY_WRITE=1 also rewrites the fixtures, the baseline the CI gate holds to
// (./baseline.json) and the scoreboard in docs/accuracy.md. Skipped in a normal test run.

const FIXTURES = "src/accuracy/__fixtures__/histories.json";
const BASELINE = "src/accuracy/baseline.json";
const DOC = "docs/accuracy.md";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const isLife = (d: DetectorName) => d.startsWith("life_");

export function scoreTable(
  scores: Record<DetectorName, Score>,
  names: readonly DetectorName[] = DETECTOR_NAMES.filter((d) => !isLife(d)),
): string {
  const rows = names.map((d) => {
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

describe.runIf(process.env.ACCURACY === "1")("the accuracy scoreboard", () => {
  it("scores every detector on the labelled histories", () => {
    const write = process.env.ACCURACY_WRITE === "1";
    if (write) writeFileSync(FIXTURES, `${JSON.stringify(toFixture(generateHistories()))}\n`);
    const histories = fromFixture(JSON.parse(readFileSync(FIXTURES, "utf8")));
    const { scores, mistakes } = scoreboard(histories);
    const buckets = calibration(judgedSuggestions(histories));
    const lifeBuckets = calibration(judgedLifeFacts(histories));
    const lifeNames = DETECTOR_NAMES.filter(isLife);
    const byLevel = levels(histories);
    const out = [
      `${histories.length} people, ${histories.reduce((n, h) => n + h.rows.length, 0)} transactions`,
      scoreTable(scores),
      "",
      "Calibration (suggestions' confidence %):",
      calibrationTable(buckets),
      "",
      "Life facts (the profile's picture of the person's life):",
      scoreTable(scores, lifeNames),
      "",
      "Life facts' calibration:",
      calibrationTable(lifeBuckets),
      "",
      "Finding levels:",
      ...Object.entries(byLevel).map(
        ([level, { count, right }]) => `${level}: ${right}/${count} right (${pct(right / count)})`,
      ),
    ].join("\n");
    console.log(out);
    if (process.env.ACCURACY_MISTAKES === "1") {
      for (const m of mistakes) console.log(`${m.detector} ${m.kind} ${m.person} ${m.item}`);
    }
    if (write) {
      const baseline = Object.fromEntries(
        DETECTOR_NAMES.map((d) => [
          d,
          {
            precision: Number(scores[d].precision.toFixed(4)),
            recall: Number(scores[d].recall.toFixed(4)),
          },
        ]),
      );
      writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
      const doc = readFileSync(DOC, "utf8");
      const start = "<!-- scoreboard:start -->";
      const end = "<!-- scoreboard:end -->";
      const table = `${start}\n${scoreTable(scores)}\n\nCalibration now:\n\n${calibrationTable(buckets)}\n${end}`;
      const life = `<!-- life:start -->\n${scoreTable(scores, lifeNames)}\n\nLife facts' calibration now:\n\n${calibrationTable(lifeBuckets)}\n<!-- life:end -->`;
      writeFileSync(
        DOC,
        doc
          .replace(new RegExp(`${start}[\\s\\S]*${end}`), table)
          .replace(/<!-- life:start -->[\s\S]*<!-- life:end -->/, life),
      );
    }
  });
});
