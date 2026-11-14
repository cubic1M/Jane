import { describe, expect, it } from "vitest";
import { cashFlowView } from "./view";

// Debugger 11-14: a student who uploaded one statement (26 days, Sep 29 to Oct 24) read "Next 30
// days: Nothing due in the next month" on Home, though a $2,356.18 check went out that month. With
// so little history no monthly bill can have shown twice, so the strip says there's too little to
// tell. With enough history and nothing due, it still says so.

const empty = { bills: [], deposits: [], deadlines: [] };

describe("an empty cash-flow strip", () => {
  it("says there's too little history when there is", () => {
    const strip = cashFlowView({ ...empty, asOf: "2026-11-14", historyDays: 26 });
    expect(strip.events).toEqual([]);
    expect(strip.empty).toBe(
      "Too little history to see your bills yet: about two months of statements shows them.",
    );
  });

  it("says nothing is due when the history is long enough to know", () => {
    const strip = cashFlowView({ ...empty, asOf: "2026-11-14", historyDays: 120 });
    expect(strip.empty).toBe("Nothing due in the next month.");
  });
});
