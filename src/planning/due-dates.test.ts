import { describe, expect, it } from "vitest";
import type { Debt } from "@/insights/debts";
import { rateChanges } from "./rate-watch";
import { dueMoves, ordinal, paydaysOf } from "./due-dates";

const debt = (over: Partial<Debt> & Pick<Debt, "key">): Debt =>
  ({
    accountId: "a",
    name: over.key,
    kind: "student",
    balanceCents: 1_000_000,
    aprBps: 525,
    aprFrom: "bank",
    paymentCents: 19_500,
    paymentEvery: "month",
    nextDue: "2026-10-28",
    ...over,
  }) as Debt;

describe("paydays", () => {
  it("are the days of the month paychecks keep landing on", () => {
    expect(
      paydaysOf(["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-10-07"]),
    ).toEqual([1, 15]);
    expect(paydaysOf(["2026-10-07"])).toEqual([]);
  });
});

describe("due-date moves", () => {
  it("moves a payment due just before payday to just after it, with the request drafted", () => {
    const [move] = dueMoves([debt({ key: "student" })], [1, 15]);
    expect(move).toMatchObject({ dueDay: 28, payday: 1, suggestedDay: 4 });
    expect(move.request).toContain("from the 28th to the 4th of each month");
  });

  it("leaves payments on payday, well before it, or without an account", () => {
    expect(dueMoves([debt({ key: "car", nextDue: "2026-11-01" })], [1, 15])).toEqual([]);
    expect(dueMoves([debt({ key: "card", nextDue: "2026-10-26" })], [1])).toEqual([]);
    expect(dueMoves([debt({ key: "plan", accountId: null })], [1, 15])).toEqual([]);
    expect(dueMoves([debt({ key: "student" })], [])).toEqual([]);
  });

  it("writes days as people say them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 28].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "28th",
    ]);
  });
});

describe("rates watched", () => {
  it("notes a bank rate the first time and reports a change after", () => {
    const first = rateChanges({}, [debt({ key: "car", aprBps: 690 })], "2026-10-18");
    expect(first).toEqual({ rates: { car: 690 }, changes: [] });
    const next = rateChanges(first.rates, [debt({ key: "car", aprBps: 715 })], "2026-11-18");
    expect(next.changes).toEqual([
      { debtKey: "car", name: "car", fromBps: 690, toBps: 715, on: "2026-11-18" },
    ]);
    // Typed rates aren't the bank's to change.
    expect(
      rateChanges({ x: 100 }, [debt({ key: "x", aprBps: 200, aprFrom: "typed" })], "d").changes,
    ).toEqual([]);
  });
});
