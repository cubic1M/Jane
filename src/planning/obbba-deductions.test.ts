import { describe, expect, it } from "vitest";
import { QBI } from "@/config/tax-rates";
import { catchUpMustBeRoth, obbbaDeduction, seniorDeduction } from "./obbba-deductions";

// Connectors roadmap round 16: the two tax-config gaps it found.

describe("the QBI threshold", () => {
  it("is Rev. Proc. 2025-32's, not the bracket edges", () => {
    expect(QBI.threshold).toEqual({
      single: 20_175_000,
      married_joint: 40_350_000,
      married_separate: 20_177_500,
      head_of_household: 20_175_000,
    });
  });
});

describe("tips, overtime and car-loan interest", () => {
  const at = (
    magiCents: number,
    status: "single" | "married_joint" | "married_separate" = "single",
  ) => ({
    claimedCents: 3_000_000,
    magiCents,
    status,
    taxYear: 2026,
  });

  it("caps tips at $25,000 and takes $100 off for each $1,000 over $150,000", () => {
    expect(obbbaDeduction("tips", at(10_000_000)).cents).toBe(2_500_000);
    // $160,500 is ten whole thousands over: $1,000 off.
    expect(obbbaDeduction("tips", at(16_050_000)).cents).toBe(2_400_000);
    expect(obbbaDeduction("tips", at(40_000_000)).cents).toBe(0);
    // Married: from $300,000, and only on a joint return.
    expect(obbbaDeduction("tips", at(30_000_000, "married_joint")).cents).toBe(2_500_000);
    expect(obbbaDeduction("tips", at(10_000_000, "married_separate"))).toMatchObject({
      cents: 0,
      why: "needs a joint return",
    });
    expect(obbbaDeduction("tips", at(10_000_000)).rule).toContain("26 USC 224");
  });

  it("caps overtime at $12,500, or $25,000 on a joint return", () => {
    expect(obbbaDeduction("overtime", at(10_000_000)).cents).toBe(1_250_000);
    expect(obbbaDeduction("overtime", at(10_000_000, "married_joint")).cents).toBe(2_500_000);
  });

  it("caps car-loan interest at $10,000 and takes $200 off for each $1,000 over $100,000", () => {
    expect(
      obbbaDeduction("carLoanInterest", { ...at(10_000_000), claimedCents: 450_000 }).cents,
    ).toBe(450_000);
    expect(obbbaDeduction("carLoanInterest", at(12_000_000)).cents).toBe(600_000);
    // No joint-return rule for this one.
    expect(obbbaDeduction("carLoanInterest", at(5_000_000, "married_separate")).cents).toBe(
      1_000_000,
    );
  });

  it("is only for 2025 to 2028", () => {
    expect(obbbaDeduction("tips", { ...at(5_000_000), taxYear: 2029 }).cents).toBe(0);
    expect(obbbaDeduction("tips", { ...at(5_000_000), taxYear: 2024 }).cents).toBe(0);
    expect(obbbaDeduction("tips", { ...at(5_000_000), taxYear: 2025 }).cents).toBe(2_500_000);
  });
});

describe("the senior deduction", () => {
  it("is $6,000 for each person 65 or older, less 6% of income over the line", () => {
    expect(
      seniorDeduction({ peopleAge65: 1, magiCents: 6_000_000, status: "single", taxYear: 2026 })
        .cents,
    ).toBe(600_000);
    expect(
      seniorDeduction({
        peopleAge65: 2,
        magiCents: 12_000_000,
        status: "married_joint",
        taxYear: 2026,
      }).cents,
    ).toBe(1_200_000);
    // $85,000 single: $10,000 over, $600 off.
    expect(
      seniorDeduction({ peopleAge65: 1, magiCents: 8_500_000, status: "single", taxYear: 2026 })
        .cents,
    ).toBe(540_000);
    // A single return counts one person, a separate return none.
    expect(
      seniorDeduction({ peopleAge65: 2, magiCents: 0, status: "single", taxYear: 2026 }).cents,
    ).toBe(600_000);
    expect(
      seniorDeduction({ peopleAge65: 1, magiCents: 0, status: "married_separate", taxYear: 2026 })
        .cents,
    ).toBe(0);
    expect(
      seniorDeduction({ peopleAge65: 1, magiCents: 0, status: "single", taxYear: 2029 }).cents,
    ).toBe(0);
  });
});

describe("the Roth catch-up rule", () => {
  it("applies from 2027 to anyone over $150,000 of FICA wages the year before", () => {
    expect(catchUpMustBeRoth({ priorYearFicaWagesCents: 15_000_001, taxYear: 2027 })).toBe(true);
    expect(catchUpMustBeRoth({ priorYearFicaWagesCents: 15_000_000, taxYear: 2027 })).toBe(false);
    expect(catchUpMustBeRoth({ priorYearFicaWagesCents: 30_000_000, taxYear: 2026 })).toBe(false);
  });
});
