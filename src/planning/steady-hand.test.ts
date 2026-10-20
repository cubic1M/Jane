import { describe, expect, it } from "vitest";
import { PREDICTION_WORDS } from "@/config/steady-hand";
import { steadyMessage, pauseNote, timelines } from "@/lib/jane-agent/investments/steady-copy";
import type { Bucket } from "./goal-buckets";
import { detectDrop, givenUp } from "./steady-hand";

// Spec step 163: a big drop gets one calm message; a sell pauses once, skippably.

const P = (key: string, r: number | null) => ({ key, label: key, timeWeighted: r });

describe("detectDrop", () => {
  it("fires at -8% over a month or -15% over three, and picks the worse", () => {
    expect(detectDrop([P("1m", -0.079), P("3m", -0.14)])).toBeNull();
    expect(detectDrop([P("1m", -0.08), P("3m", -0.02)])).toMatchObject({ key: "1m", rate: -0.08 });
    expect(detectDrop([P("1m", -0.09), P("3m", -0.2)])).toMatchObject({ key: "3m" });
    expect(detectDrop([P("1m", null), P("1y", -0.5)])).toBeNull();
    expect(detectDrop([])).toBeNull();
  });
});

describe("givenUp", () => {
  it("is a range over 10 years at the 4% to 7% assumptions", () => {
    // $10,000: 1.04^10 − 1 = 48.02%, 1.07^10 − 1 = 96.72%.
    expect(givenUp(1_000_000)).toEqual({ lowCents: 480_244, highCents: 967_151, years: 10 });
  });
});

const GOALS: Bucket[] = [
  {
    id: "a",
    name: "House",
    yearsLeft: 2,
    nearTerm: true,
    mix: { us_stocks: 0, intl_stocks: 0, bonds: 0, cash: 1 },
    monthlyCents: 0,
    why: "",
  },
  {
    id: "b",
    name: "Retirement",
    yearsLeft: 25,
    nearTerm: false,
    mix: { us_stocks: 0.7, intl_stocks: 0.1, bonds: 0.2, cash: 0 },
    monthlyCents: 0,
    why: "",
  },
];
const DROP = { key: "1m", windowLabel: "the last month", rate: -0.1 };

describe("Jane never says what markets will do", () => {
  it("keeps every steady-hand message free of predictions, and says she can't know", () => {
    const texts = [
      steadyMessage(DROP, GOALS),
      steadyMessage(DROP, []),
      pauseNote(250_000, DROP),
      timelines(GOALS),
    ];
    for (const t of texts) expect(t).not.toMatch(PREDICTION_WORDS);
    expect(texts[0]).toMatch(/I can't tell you what markets will do, and nobody can\./);
    expect(texts[0]).toMatch(/down 10\.0% over the last month/);
    expect(texts[0]).toMatch(/Already in cash, so the drop doesn't touch it: House/);
    expect(texts[0]).toMatch(/The plan stays as it is/);
  });

  it("the prediction check itself catches predictions", () => {
    for (const bad of [
      "Stocks will recover soon",
      "It's likely to rebound",
      "a forecast of gains",
      "we expect a rally",
    ]) {
      expect(bad).toMatch(PREDICTION_WORDS);
    }
  });
});

describe("the pause", () => {
  it("shows what selling gives up as a range, labelled an assumption, with a way past it", () => {
    const note = pauseNote(250_000, DROP);
    expect(note).toMatch(
      /\$2,500\.00 you'd take out would have grown by roughly \$1,200\.61 to \$2,417\.88 over 10 years at the assumed 4% to 7% a year \(an assumption, not a promise\)/,
    );
    expect(note).toMatch(/sell anyway, or leave it a few days\.$/);
  });
});
