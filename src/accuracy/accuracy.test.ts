import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import baseline from "./baseline.json";
import { fromFixture, generateHistories, toFixture } from "./generate";
import {
  DETECTOR_NAMES,
  calibration,
  judgedLifeFacts,
  judgedSuggestions,
  scoreboard,
} from "./score";

// The accuracy gate (docs/accuracy.md): every detector on the 40 labelled histories must keep
// its precision and recall within ALLOWED_DROP of the recorded baseline (src/accuracy/
// baseline.json, written by `ACCURACY_WRITE=1 npm run accuracy`). A change that makes a
// detector better passes; record the new baseline with it so the gain is kept.

// "A few points": a drop of more than this fails.
const ALLOWED_DROP = 0.03;
// A confidence bucket with this many suggestions may not claim more than OVERCONFIDENT_BY
// points above how often it's right.
const BUCKET_MIN = 10;
const OVERCONFIDENT_BY = 10;

const fixture = JSON.parse(readFileSync("src/accuracy/__fixtures__/histories.json", "utf8"));
const histories = fromFixture(fixture);

describe("the accuracy bench", () => {
  it("is the generator's fixed-seed output, so the labels can't drift from the data", () => {
    expect(JSON.stringify(toFixture(generateHistories()))).toBe(JSON.stringify(fixture));
    expect(histories).toHaveLength(40);
  });

  const { scores } = scoreboard(histories);
  it.each(DETECTOR_NAMES)("keeps %s's precision and recall at its baseline", (name) => {
    const base = baseline[name];
    const now = scores[name];
    expect(now.precision, `${name} precision`).toBeGreaterThanOrEqual(
      base.precision - ALLOWED_DROP,
    );
    expect(now.recall, `${name} recall`).toBeGreaterThanOrEqual(base.recall - ALLOWED_DROP);
  });

  const judged = judgedSuggestions(histories);
  it("never says 0% sure: a suggestion that rests on nothing isn't made", () => {
    expect(judged.filter((j) => j.percent <= 0)).toEqual([]);
  });

  it("is never much surer than it turns out to be", () => {
    for (const b of calibration(judged)) {
      if (b.count < BUCKET_MIN) continue;
      expect(b.saidPercent, `${b.from}–${b.to}%`).toBeLessThanOrEqual(
        b.rightPercent + OVERCONFIDENT_BY,
      );
    }
  });

  // The life facts (founder, 2026-10-26): "I'm 85% sure you have a dog" must be right about that
  // often, the same bar as the suggestions.
  const lifeJudged = judgedLifeFacts(histories);
  it("never says a life fact at 0%, and is never much surer of one than it turns out to be", () => {
    expect(lifeJudged.length).toBeGreaterThan(0);
    expect(lifeJudged.filter((j) => j.percent <= 0)).toEqual([]);
    for (const b of calibration(lifeJudged)) {
      if (b.count < BUCKET_MIN) continue;
      expect(b.saidPercent, `life facts ${b.from}–${b.to}%`).toBeLessThanOrEqual(
        b.rightPercent + OVERCONFIDENT_BY,
      );
    }
  });
});
