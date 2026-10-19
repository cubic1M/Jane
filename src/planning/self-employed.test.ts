import { describe, expect, it } from "vitest";
import {
  homeOfficeDeduction,
  mileageDeduction,
  quarterlyPlan,
  setAsideRate,
} from "./self-employed";
import { estimatedTaxDates } from "./tax-pack";
import { NO_OVERRIDES, tagOf } from "./tax-tags";

// Spec step 123: freelancers' quarterly payments, set-aside, home office and miles.

const dates = estimatedTaxDates(2026);

describe("quarterlyPlan", () => {
  it("splits what's still owed over the dates left, adding up to the estimate exactly", () => {
    const input = {
      dueDates: dates,
      today: "2026-07-01",
      totalTaxCents: 1_234_567,
      withheldCents: 300_000,
      paidCents: 200_000,
    };
    const plan = quarterlyPlan(input);
    expect(plan.payments.map((p) => p.date)).toEqual(["2026-09-15", "2027-01-15"]);
    const sum = plan.payments.reduce((s, p) => s + p.cents, 0);
    expect(sum).toBe(plan.owedCents);
    expect(sum + input.withheldCents + input.paidCents).toBe(input.totalTaxCents);
  });

  it("isn't needed under $1,000 owed, and has no payments once the dates have passed", () => {
    expect(
      quarterlyPlan({
        dueDates: dates,
        today: "2026-07-01",
        totalTaxCents: 99_999,
        withheldCents: 0,
        paidCents: 0,
      }),
    ).toEqual({
      owedCents: 99_999,
      needed: false,
      payments: [],
    });
    expect(
      quarterlyPlan({
        dueDates: dates,
        today: "2027-02-01",
        totalTaxCents: 500_000,
        withheldCents: 0,
        paidCents: 0,
      }).payments,
    ).toEqual([]);
  });

  it("counts a due date that's today", () => {
    expect(
      quarterlyPlan({
        dueDates: dates,
        today: "2026-09-15",
        totalTaxCents: 400_000,
        withheldCents: 0,
        paidCents: 0,
      }).payments,
    ).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("set-aside is the tax freelance income adds over the money in, capped at half", () => {
    expect(
      setAsideRate({
        taxWithCents: 1_500_000,
        taxWithoutCents: 1_200_000,
        freelanceInCents: 1_000_000,
      }),
    ).toBe(0.3);
    expect(
      setAsideRate({ taxWithCents: 900_000, taxWithoutCents: 0, freelanceInCents: 1_000_000 }),
    ).toBe(0.5);
    expect(setAsideRate({ taxWithCents: 1, taxWithoutCents: 0, freelanceInCents: 0 })).toBe(0);
  });

  it("home office at $5 a square foot up to 300; miles at 72.5 cents", () => {
    expect(homeOfficeDeduction(150)).toBe(75_000);
    expect(homeOfficeDeduction(500)).toBe(150_000);
    expect(homeOfficeDeduction(null)).toBe(0);
    expect(mileageDeduction(1_000)).toBe(72_500);
  });

  it("suggests office supplies as a business expense only for freelancers, and asks", () => {
    const t = {
      id: "t1",
      date: "2026-05-01",
      amountCents: 4_000,
      description: "STAPLES 123",
      merchantName: "Staples",
      pfcDetailed: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
    };
    expect(tagOf(t, NO_OVERRIDES)).toBeNull();
    expect(tagOf(t, { ...NO_OVERRIDES, businessHints: true })).toMatchObject({
      tag: "business",
      source: "check",
    });
  });
});
