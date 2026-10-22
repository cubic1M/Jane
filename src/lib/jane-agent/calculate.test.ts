import { describe, expect, it } from "vitest";
import { checkGuardrails } from "@/lib/guardrails";
import { calculate } from "./calculate";

const ok = (input: Parameters<typeof calculate>[0]) => {
  const r = calculate(input);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("the chat's arithmetic", () => {
  it("applies the 4% rule to a named balance", () => {
    // Her retirement balance, 4% a year, and a month of it.
    const year = ok({ operation: "percent_of", percent: 4, amount: 849_414 });
    expect(year.cents.result).toBe(3_397_656);
    expect(ok({ operation: "per_month", amount: 33_976.56 }).cents.result).toBe(283_138);
  });

  it("a monthly amount over a year, a difference, a sum", () => {
    expect(ok({ operation: "per_year", amount: 15.49 }).cents.result).toBe(18_588);
    expect(ok({ operation: "difference", amount: 1_180, other_amount: 38.2 }).cents.result).toBe(
      114_180,
    );
    expect(ok({ operation: "sum", amounts: [10.1, 20.2, 0.05] }).cents.result).toBe(3_035);
  });

  it("how long to pay off a card at $200 a month", () => {
    const r = ok({
      operation: "payoff_months",
      balance: 2_410.5,
      monthly_payment: 200,
      apr_percent: 29,
    });
    // About 15 months, and about $500 of interest.
    expect(r.numbers.months).toBe(15);
    expect(r.numbers).toMatchObject({ years: 1, extraMonths: 3 });
    expect(r.cents.totalInterest).toBeGreaterThan(40_000);
    expect(r.cents.totalInterest).toBeLessThan(60_000);
    expect(r.cents.totalPaid).toBe(241_050 + r.cents.totalInterest);
    // No interest: just balance over payment, rounded up.
    expect(
      ok({ operation: "payoff_months", balance: 1_000, monthly_payment: 300 }).numbers.months,
    ).toBe(4);
  });

  it("says when the payment never clears the interest", () => {
    const r = ok({
      operation: "payoff_months",
      balance: 10_000,
      monthly_payment: 100,
      apr_percent: 29,
    });
    expect(r.note).toMatch(/never be paid off/);
    expect(r.numbers).toEqual({});
  });

  it("refuses missing or odd input", () => {
    expect(calculate({ operation: "percent_of", percent: 4 })).toMatchObject({ ok: false });
    expect(calculate({ operation: "nope" })).toMatchObject({ ok: false });
    expect(calculate({ operation: "sum", amounts: [1, "x"] })).toMatchObject({ ok: false });
    expect(
      calculate({ operation: "payoff_months", balance: -5, monthly_payment: 1 }),
    ).toMatchObject({ ok: false });
    expect(calculate({ operation: "per_year", amount: Number.NaN })).toMatchObject({ ok: false });
  });

  it("gives amounts the guardrail accepts once they are the tool's", () => {
    const r = ok({ operation: "percent_of", percent: 4, amount: 849_414 });
    const answer = "A 4% withdrawal from your $849,414.00 is $33,976.56 a year.";
    expect(checkGuardrails(answer, [84_941_400], undefined, "demo_advice").ok).toBe(false);
    expect(checkGuardrails(answer, [84_941_400, r.cents.result], undefined, "demo_advice").ok).toBe(
      true,
    );
  });
});
