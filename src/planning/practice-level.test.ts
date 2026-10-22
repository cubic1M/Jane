import { describe, expect, it } from "vitest";
import { DROP_REACTIONS, HORIZONS } from "@/config/investing";
import { MODEL_PORTFOLIOS, stocksShare } from "@/config/portfolios";
import { practiceLevel, type PracticeAnswers } from "./practice-level";

const base: PracticeAnswers = {
  horizon: "over_20",
  dropReaction: "buy",
  stability: "steady",
  goals: ["growth"],
};

describe("the practice risk level", () => {
  it("waits for the horizon and the reaction to a drop", () => {
    expect(practiceLevel({ ...base, horizon: null })).toEqual({ complete: false });
    expect(practiceLevel({ ...base, dropReaction: "bogus" })).toEqual({ complete: false });
  });

  it("takes the lower of what the person can afford and what they would stand", () => {
    const a = practiceLevel({ ...base, dropReaction: "worry" });
    expect(a.complete && a.level).toBe(3);
    const b = practiceLevel({ ...base, horizon: "under_3" });
    expect(b.complete && b.level).toBe(1);
    const c = practiceLevel(base);
    expect(c.complete && [c.level, c.label]).toEqual([5, "Very high"]);
  });

  it("lowers a level for uneven income and keeps a soon goal at Medium or below", () => {
    const uneven = practiceLevel({ ...base, stability: "variable" });
    expect(uneven.complete && uneven.level).toBe(4);
    const home = practiceLevel({
      ...base,
      horizon: "3_to_10",
      dropReaction: "buy",
      goals: ["home"],
    });
    expect(home.complete && home.level).toBe(3);
  });

  it("explains itself in one sentence and always gives the same answer", () => {
    const a = practiceLevel({ ...base, horizon: "10_to_20", dropReaction: "fine" });
    expect(a).toEqual(practiceLevel({ ...base, horizon: "10_to_20", dropReaction: "fine" }));
    expect(a.complete && a.reason).toMatch(
      /^High: you need the money in 10 to 20 years; after a 20% drop/,
    );
  });

  it("covers every combination with a level from one to five and a matching portfolio", () => {
    for (const h of Object.keys(HORIZONS)) {
      for (const d of Object.keys(DROP_REACTIONS)) {
        for (const stability of ["steady", "variable", null] as const) {
          const r = practiceLevel({ horizon: h, dropReaction: d, stability, goals: [] });
          expect(r.complete).toBe(true);
          if (r.complete) expect(r.portfolio.level).toBe(r.level);
        }
      }
    }
  });
});

describe("the model portfolios", () => {
  it("sum to 100% and never hold fewer stocks at a higher level", () => {
    let last = -1;
    for (const level of [1, 2, 3, 4, 5] as const) {
      const w = MODEL_PORTFOLIOS[level].weights;
      expect(w.us_stocks + w.intl_stocks + w.bonds + w.cash).toBeCloseTo(1, 10);
      expect(stocksShare(level)).toBeGreaterThanOrEqual(last);
      last = stocksShare(level);
    }
  });
});
