import { describe, expect, it } from "vitest";
import { checkGuardrails, recommendsAChoice } from "@/lib/guardrails";
import { allPlannerCopy, PLANNER_COPY } from "./debt-copy";

describe("debt planner wording", () => {
  it.each(allPlannerCopy())("never recommends a choice: %s", (text) => {
    expect(recommendsAChoice(text)).toBe(false);
    expect(checkGuardrails(text, [])).toEqual({ ok: true });
  });

  it("says plainly that it's math, not a recommendation", () => {
    expect(PLANNER_COPY.disclaimer).toMatch(/^This is math, not a recommendation\./);
  });

  it("catches wording that recommends one", () => {
    for (const text of [
      "You should pay the highest rate first.",
      "We recommend the snowball method.",
      "Avalanche is the better choice for you.",
      "Go with snowball if you like quick wins.",
      "Recommended: highest rate first",
    ]) {
      expect(recommendsAChoice(text), text).toBe(true);
    }
  });
});
