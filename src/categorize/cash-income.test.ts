import { describe, expect, it } from "vitest";
import { regularCashDeposits, saidNotIncome, type DepositRow } from "./cash-income";

// A server paid in tips: cash deposited about twice a week, amounts all over the place.
const day = (n: number) => new Date(Date.UTC(2026, 7, 1 + n)).toISOString().slice(0, 10);
const deposit = (n: number, dollars: number, over: Partial<DepositRow> = {}): DepositRow => ({
  id: `d${n}`,
  date: day(n),
  amountCents: -dollars * 100,
  pfcDetailed: "TRANSFER_IN_DEPOSIT",
  categorySource: "rule",
  ...over,
});
const tips = [0, 3, 7, 10, 14, 17, 21, 24, 28, 31, 35, 38, 42, 45, 49, 52, 56, 59].map((n, i) =>
  deposit(n, [140, 310, 95, 260, 180, 420, 120, 230][i % 8]),
);

describe("regularCashDeposits", () => {
  it("counts tips deposited every few days as income, with how sure", () => {
    const found = regularCashDeposits(tips, 2)!;
    expect(found.ids).toHaveLength(tips.length);
    // Two months of statements: thin data, so not very sure (src/profile/confidence.ts).
    expect(found.percent).toBeGreaterThan(0);
    expect(found.percent).toBeLessThan(60);
    expect(regularCashDeposits(tips, 12)!.percent).toBeGreaterThan(found.percent);
  });

  it("leaves a one-off out: a car sold for cash isn't pay", () => {
    const found = regularCashDeposits([...tips, deposit(40, 6_500, { id: "car" })], 2)!;
    expect(found.ids).not.toContain("car");
    expect(found.ids).toHaveLength(tips.length);
  });

  it("counts nothing for a few deposits, a burst in one week, or deposits that come and go", () => {
    expect(regularCashDeposits(tips.slice(0, 3), 2)).toBeNull();
    expect(
      regularCashDeposits(
        [0, 1, 2, 3, 4].map((n) => deposit(n, 200)),
        2,
      ),
    ).toBeNull();
    // Months apart, different amounts: not regular.
    const scattered = [0, 9, 70, 75, 150].map((n, i) => deposit(n, [40, 900, 120, 2_000, 15][i]));
    expect(regularCashDeposits(scattered, 6)).toBeNull();
  });

  it("counts deposits of a similar amount even at an uneven cadence", () => {
    const rent = [0, 12, 35, 41, 66].map((n) => deposit(n, 600 + n));
    expect(regularCashDeposits(rent, 3)?.ids).toHaveLength(5);
  });

  it("gives the same answer after the deposits were counted, so a re-run changes nothing", () => {
    const counted = tips.map((t) => ({
      ...t,
      pfcDetailed: "INCOME_OTHER",
      categorySource: "cash_income",
    }));
    expect(regularCashDeposits(counted, 2)).toEqual(regularCashDeposits(tips, 2));
  });

  it("only reads money in: cash taken out isn't a deposit", () => {
    const out = tips.map((t) => ({ ...t, amountCents: -t.amountCents }));
    expect(regularCashDeposits(out, 2)).toBeNull();
  });

  it("knows when the person said the deposits aren't income", () => {
    expect(saidNotIncome(tips)).toBe(false);
    expect(saidNotIncome([...tips.slice(1), { ...tips[0], categorySource: "user" }])).toBe(true);
  });
});
