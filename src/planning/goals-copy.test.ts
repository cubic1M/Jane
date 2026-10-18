import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { GOALS_COPY, allGoalsCopy } from "./goals-copy";

describe("goals wording", () => {
  it.each(allGoalsCopy())("never recommends: %s", (text) => {
    expect(recommendsAChoice(text)).toBe(false);
    // Figures in the examples come from the goal math, so they're allowed here.
    const figures = dollarFigures(text).map((f) => f.cents);
    expect(checkGuardrails(text, figures)).toEqual({ ok: true });
  });

  it("says it's math, not a recommendation", () => {
    expect(GOALS_COPY.disclaimer).toMatch(/^This is math, not a recommendation\./);
  });
});
