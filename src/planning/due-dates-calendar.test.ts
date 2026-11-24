import { describe, expect, it } from "vitest";
import type { Debt } from "@/insights/debts";
import { dueMoves } from "./due-dates";

// CodeRabbit sweep 1b: the payday gap counted a 31-day month whatever the month, and a payday on
// the 26th wrapped the suggested due day to the 1st, days after it.
const debt = (nextDue: string): Debt =>
  ({
    key: "k",
    name: "Car loan",
    nextDue,
    paymentCents: 30_000,
    paymentEvery: "month",
    accountId: "a1",
  }) as unknown as Debt;

describe("due-date moves on the real calendar", () => {
  it("a Feb 28 due date is 5 days before a payday on the 5th (March), so it is a move", () => {
    expect(dueMoves([debt("2026-02-28")], [5])).toHaveLength(1);
  });
  it("a payday on the 26th suggests the 28th, not the 1st", () => {
    const [m] = dueMoves([debt("2026-03-24")], [26]);
    expect(m.suggestedDay).toBe(28);
  });
});
