import { describe, expect, it } from "vitest";
import { PMI_ASK_LTV } from "@/config/debt";
import { payoffPlan } from "./debt";
import {
  breakEvenMonths,
  escrowChange,
  extraPrincipal,
  loanToValue,
  percent,
  pmiLetter,
  pmiStatus,
} from "./mortgage";

describe("refinance break-even", () => {
  it("is the closing costs over the monthly saving, rounded up", () => {
    expect(breakEvenMonths(781_000, 25_000)).toBe(32);
    expect(breakEvenMonths(780_000, 26_000)).toBe(30);
    expect(breakEvenMonths(0, 10_000)).toBe(0);
  });

  it("never pays back without a monthly saving", () => {
    expect(breakEvenMonths(500_000, 0)).toBeNull();
    expect(breakEvenMonths(500_000, -1_000)).toBeNull();
  });
});

describe("PMI", () => {
  it("compares the loan with the home's value", () => {
    expect(loanToValue(31_240_000, 45_000_000)).toBeCloseTo(0.694, 3);
    expect(loanToValue(31_240_000, null)).toBeNull();
    expect(percent(0.6942)).toBe("69.4%");
  });

  it("can come off under 80% of the value; not before, and not without one", () => {
    expect(pmiStatus(true, 31_240_000, 45_000_000)).toMatchObject({ kind: "can_ask" });
    expect(pmiStatus(true, 31_240_000, 38_000_000)).toEqual({
      kind: "not_yet",
      ltv: 31_240_000 / 38_000_000,
      balanceAtAskCents: Math.floor(38_000_000 * PMI_ASK_LTV),
    });
    expect(pmiStatus(true, 31_240_000, null)).toEqual({ kind: "unknown", why: "no_value" });
    expect(pmiStatus(null, 31_240_000, 45_000_000)).toEqual({
      kind: "unknown",
      why: "not_reported",
    });
    expect(pmiStatus(false, 31_240_000, 45_000_000)).toEqual({ kind: "none" });
  });

  it("drafts a written request with the figures", () => {
    const letter = pmiLetter({
      name: "Sam Demo",
      loanName: "Demo Home Loan",
      balanceCents: 31_240_000,
      homeValueCents: 45_000_000,
      ltv: 31_240_000 / 45_000_000,
    });
    expect(letter).toContain("cancel the private mortgage insurance on my loan (Demo Home Loan)");
    expect(letter).toContain(
      "$312,400.00, which is 69.4% of my home's current value of about $450,000.00",
    );
    expect(letter.endsWith("Sam Demo")).toBe(true);
  });
});

describe("extra principal", () => {
  it("saves months and interest against the payment now, with the planner's math", () => {
    const result = extraPrincipal(31_240_000, 399, 219_831, [25_000])!;
    const base = payoffPlan(
      [{ id: "m", name: "m", balanceCents: 31_240_000, aprBps: 399, minimumCents: 219_831 }],
      219_831,
      "avalanche",
    );
    const more = payoffPlan(
      [{ id: "m", name: "m", balanceCents: 31_240_000, aprBps: 399, minimumCents: 244_831 }],
      244_831,
      "avalanche",
    );
    expect(result.baseMonths).toBe(base.ok ? base.months : -1);
    expect(result.scenarios[0]).toEqual({
      extraCents: 25_000,
      monthsSaved: (base.ok ? base.months : 0) - (more.ok ? more.months : 0),
      interestSavedCents:
        (base.ok ? base.totalInterestCents : 0) - (more.ok ? more.totalInterestCents : 0),
    });
    expect(result.scenarios[0].monthsSaved).toBeGreaterThan(0);
  });
});

describe("escrow changes", () => {
  const pay = (date: string, cents: number) => ({ date, cents });
  it("spots the latest payment moving against the ones before it", () => {
    expect(
      escrowChange([
        pay("2026-07-01", 214_154),
        pay("2026-08-01", 214_154),
        pay("2026-09-01", 214_154),
        pay("2026-10-01", 219_831),
      ]),
    ).toEqual({ fromCents: 214_154, toCents: 219_831, changeCents: 5_677, on: "2026-10-01" });
  });

  it("ignores pennies and a single payment", () => {
    expect(escrowChange([pay("2026-09-01", 214_154), pay("2026-10-01", 214_200)])).toBeNull();
    expect(escrowChange([pay("2026-10-01", 214_154)])).toBeNull();
  });
});
