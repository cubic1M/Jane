import { describe, expect, it } from "vitest";
import { DEPRECIATION } from "@/config/side-income";
import {
  lossAllowance,
  matchPlatform,
  rentalDepreciation,
  rentalNet,
  sideIncomeBothWays,
} from "./side-income";

// Spec step 173: depreciation math is tested; platform payouts are matched to their 1099s.

const dep = (year: number, placedOn: string, priceCents = 30_000_000, buildingShare?: number) =>
  rentalDepreciation({ year, priceCents, placedOn, buildingShare });

describe("rental depreciation", () => {
  it("depreciates the building, not the land: 80% of the price by default", () => {
    expect(dep(2026, "2026-01-10").buildingCents).toBe(24_000_000);
    expect(dep(2026, "2026-01-10", 30_000_000, 0.7).buildingCents).toBe(21_000_000);
  });

  it("takes the mid-month first-year share by the month it was rented out", () => {
    // $240,000 of building: January 3.485%, July 1.667%, December 0.152%.
    expect(dep(2026, "2026-01-10").cents).toBe(Math.round(24_000_000 * 0.03485));
    expect(dep(2026, "2026-01-10").cents).toBe(836_400);
    expect(dep(2026, "2026-07-01").cents).toBe(400_080);
    expect(dep(2026, "2026-12-31").cents).toBe(36_480);
  });

  it("takes nothing before the property was ready to rent", () => {
    expect(dep(2025, "2026-03-01").cents).toBe(0);
  });

  it("takes 3.636% a full year after, 27.5 years in all", () => {
    expect(dep(2027, "2026-03-01").cents).toBe(Math.round(24_000_000 * 0.03636));
    expect(dep(2027, "2026-03-01").percent).toBe(DEPRECIATION.perYear);
    // 1/27.5 = 3.636%: the full years add up to the building over the recovery period.
    expect(DEPRECIATION.perYear).toBeCloseTo(1 / DEPRECIATION.years, 5);
    let total = 0;
    for (let y = 2026; y <= 2026 + 28; y += 1) total += dep(y, "2026-01-15").cents;
    expect(total).toBe(24_000_000);
  });

  it("never takes more than the building, and the last year is what's left", () => {
    const last = dep(2026 + 27, "2026-01-15");
    const through = Array.from({ length: 27 }, (_, i) => dep(2026 + i, "2026-01-15").cents).reduce(
      (a, b) => a + b,
      0,
    );
    expect(through + last.cents).toBeLessThanOrEqual(24_000_000);
    expect(dep(2026 + 29, "2026-01-15").cents).toBe(0);
  });
});

describe("a rental's net and the loss allowance", () => {
  it("is rent less expenses less depreciation, all counted when it's a profit", () => {
    const r = rentalNet({
      rentCents: 2_400_000,
      expensesCents: 600_000,
      depreciationCents: 800_000,
      otherIncomeCents: 8_000_000,
    });
    expect(r).toMatchObject({ netCents: 1_000_000, countedCents: 1_000_000, suspendedCents: 0 });
  });

  it("lets a loss through up to $25,000 at modest income, and carries the rest forward", () => {
    const small = rentalNet({
      rentCents: 1_000_000,
      expensesCents: 2_000_000,
      depreciationCents: 800_000,
      otherIncomeCents: 8_000_000,
    });
    expect(small).toMatchObject({
      netCents: -1_800_000,
      countedCents: -1_800_000,
      suspendedCents: 0,
    });
    const big = rentalNet({
      rentCents: 0,
      expensesCents: 3_000_000,
      depreciationCents: 1_000_000,
      otherIncomeCents: 8_000_000,
    });
    expect(big).toMatchObject({ countedCents: -2_500_000, suspendedCents: 1_500_000 });
  });

  it("phases the allowance out between $100,000 and $150,000 of income", () => {
    expect(lossAllowance(10_000_000)).toBe(2_500_000);
    expect(lossAllowance(12_000_000)).toBe(1_500_000);
    expect(lossAllowance(15_000_000)).toBe(0);
    expect(lossAllowance(20_000_000)).toBe(0);
    const high = rentalNet({
      rentCents: 0,
      expensesCents: 1_000_000,
      depreciationCents: 0,
      otherIncomeCents: 16_000_000,
    });
    expect(high).toMatchObject({ countedCents: 0, suspendedCents: 1_000_000 });
  });
});

describe("hobby or business", () => {
  it("taxes a hobby's whole income with no expenses, and a business's profit", () => {
    expect(sideIncomeBothWays({ incomeCents: 500_000, expensesCents: 300_000 })).toEqual({
      business: { incomeCents: 200_000, selfEmploymentTax: true },
      hobby: { incomeCents: 500_000, selfEmploymentTax: false },
    });
  });
});

describe("matching a platform's payouts to its 1099", () => {
  it("is matched when the form checks out, differs when it doesn't, waiting without a form", () => {
    expect(
      matchPlatform({
        payoutsCents: 900_000,
        formCents: 900_000,
        checkStatus: "matches",
        mayNotSend: false,
      }),
    ).toBe("matched");
    expect(
      matchPlatform({
        payoutsCents: 900_000,
        formCents: 700_000,
        checkStatus: "differs",
        mayNotSend: false,
      }),
    ).toBe("differs");
    expect(
      matchPlatform({
        payoutsCents: 900_000,
        formCents: null,
        checkStatus: null,
        mayNotSend: false,
      }),
    ).toBe("waiting");
    expect(
      matchPlatform({
        payoutsCents: 100_000,
        formCents: null,
        checkStatus: null,
        mayNotSend: true,
      }),
    ).toBe("unneeded");
  });
});
