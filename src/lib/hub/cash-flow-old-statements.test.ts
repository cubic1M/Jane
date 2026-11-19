import { describe, expect, it } from "vitest";
import { cashFlowView } from "./view";

// Debug 3, 11-19 (class 5, debug3-invariants.md): Home's strip told someone whose statements ended
// in September "Nothing due in the next month." in November: nothing is known about the next
// month, which isn't the same as nothing due.

const quiet = { asOf: "2026-11-12", bills: [], deposits: [], deadlines: [], historyDays: 60 };

describe("Home's cash flow, from statements that ended long ago", () => {
  it("says when the statements end instead of saying nothing is due", () => {
    expect(cashFlowView({ ...quiet, statementsEnd: "2026-09-11" }).empty).toBe(
      "Your statements end Sep 11, 2026: upload newer ones to see what's due now.",
    );
  });

  it("still says nothing is due for statements that reach today", () => {
    expect(cashFlowView(quiet).empty).toBe("Nothing due in the next month.");
  });
});
