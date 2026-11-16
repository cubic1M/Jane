import { describe, expect, it } from "vitest";
import { safeReply } from "./replies";

// Gate E (11-16): a beta person whose only upload is October's checking statement. One month finds
// no bills yet, so safe to spend is the whole $2,168.97 balance, and "That's after upcoming bills"
// said otherwise with rent of $1,200 still to come.
const TODAY = "2026-11-03";
const parts = { billsCents: 0, budgetsLeftCents: 0, goalsCents: 0, setAsideCents: 0 };

describe("what safe to spend says it took off", () => {
  it("says it's the whole balance when nothing was taken off", () => {
    expect(safeReply({ safeCents: 216_897, payday: null, ...parts }, TODAY).body).toBe(
      "You have $2,168.97 safe to spend. That's your whole checking balance: I don't see any bills coming up, budgets or goals yet.",
    );
  });

  it("names only what was taken off", () => {
    expect(
      safeReply({ safeCents: 96_897, payday: null, ...parts, billsCents: 120_000 }, TODAY).body,
    ).toBe("You have $968.97 safe to spend. That's after upcoming bills.");
    expect(
      safeReply(
        { safeCents: 50_000, payday: null, ...parts, billsCents: 120_000, goalsCents: 20_000 },
        TODAY,
      ).body,
    ).toBe(
      "You have $500.00 safe to spend. That's after upcoming bills and what goes to your goals.",
    );
  });

  it("still says what tax it held back", () => {
    expect(
      safeReply({ safeCents: 20_000, payday: null, ...parts, taxHeldCents: 40_000 }, TODAY).body,
    ).toBe(
      "You have $200.00 safe to spend. That's your checking balance, with $400.00 held back for tax not yet withheld or paid (an estimate): I don't see any bills coming up, budgets or goals yet.",
    );
  });
});
