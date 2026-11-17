import { describe, expect, it } from "vitest";
import { safeReply } from "./replies";

// Debug 2, third desktop sweep (11-16, upload S5): "Set it up" on the dock's emergency fund goal,
// then "how much can I safely spend?" answered "…no bills are due before then, and I don't see
// budgets or goals yet." The goal was there; it holds nothing back before payday. Safe to spend
// says what it held back, never that there's no goal.

describe("safe to spend with nothing held back", () => {
  it("doesn't say there are no goals", () => {
    const body = safeReply(
      {
        safeCents: 64_218,
        payday: "2026-11-27",
        billsCents: 0,
        budgetsLeftCents: 0,
        goalsCents: 0,
        setAsideCents: 0,
      },
      "2026-11-16",
    ).body;
    expect(body).toBe(
      "You have $642.18 safe to spend until your next payday, Nov 27 (in 11 days). That's your whole checking balance: no bills are due before then, and nothing is held back for budgets or goals.",
    );
  });
});
