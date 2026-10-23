import { describe, expect, it } from "vitest";
import { PRACTICE_TOPIC } from "@/config/practice-suggestions";
import { SAFETY_HISTORY_FLOOR } from "@/config/suggestions";
import { practiceLearned } from "./practice-learned";

// What the person's answers changed, per practice kind: up with yes, down with no, and a
// safety kind stays at its floor.

describe("practiceLearned", () => {
  it("is empty before any answer", () => {
    expect(practiceLearned({})).toEqual([]);
    expect(practiceLearned({ [PRACTICE_TOPIC.dip_buy]: { yes: 0, no: 0 } })).toEqual([]);
  });

  it("brings a kind the person says yes to sooner, and one they decline later", () => {
    const out = practiceLearned({
      [PRACTICE_TOPIC.dip_buy]: { yes: 2, no: 0 },
      [PRACTICE_TOPIC.news_idea]: { yes: 0, no: 3 },
      unrelated_topic: { yes: 5, no: 0 },
    });
    expect(out.map((l) => [l.kind, l.effect])).toEqual([
      ["dip_buy", "sooner"],
      ["news_idea", "later"],
    ]);
    expect(out[0].factor).toBeGreaterThan(1);
    expect(out[0].says).toBe("You said yes twice, so Jane brings these sooner.");
    expect(out[1].factor).toBeLessThan(1);
    expect(out[1].says).toMatch(/^You said no 3 times, so Jane brings these later/);
  });

  it("keeps a safety kind at its floor however often it's declined", () => {
    const [l] = practiceLearned({ [PRACTICE_TOPIC.max_drop_near]: { yes: 0, no: 9 } });
    expect(l.effect).toBe("safety");
    expect(l.factor).toBe(SAFETY_HISTORY_FLOOR);
    expect(l.says).toMatch(/safety check, so Jane still brings it/);
  });
});
