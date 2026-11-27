import { describe, expect, it } from "vitest";
import { ESTIMATED_TAX } from "@/config/student-taxes";
import {
  ageOf,
  federalTaxOf,
  marginalRateFor,
  nextEstimatedDate,
  standardDeductionOf,
} from "./student-tax";
import { studentMoney } from "./student-money";

// The arithmetic behind the student tax cards (suggest-taxes, 11-18), worked by hand from
// Rev. Proc. 2025-32: 10% to $12,400 of taxable income, 12% to $50,400; $16,100 standard
// deduction; a dependent's is the greater of $1,350 or earned income plus $450.

describe("federal tax on a student's year", () => {
  it("taxes a $57,000 fellowship as $40,900 taxable: $1,240 + 12% of $28,500", () => {
    expect(federalTaxOf(5_700_000, "single", false)).toBe(124_000 + 342_000);
  });

  it("owes nothing at or under the standard deduction, and 10% on the first dollar over", () => {
    expect(federalTaxOf(1_610_000, "single", false)).toBe(0);
    expect(federalTaxOf(1_610_100, "single", false)).toBe(10);
  });

  it("gives a dependent the larger of $1,350 or earned income plus $450, at most $16,100", () => {
    expect(standardDeductionOf("single", true, 0)).toBe(135_000);
    expect(standardDeductionOf("single", true, 89_999)).toBe(135_000);
    expect(standardDeductionOf("single", true, 90_001)).toBe(135_001);
    expect(standardDeductionOf("single", true, 1_000_000)).toBe(1_045_000);
    expect(standardDeductionOf("single", true, 1_565_000)).toBe(1_610_000);
    expect(standardDeductionOf("single", true, 3_000_000)).toBe(1_610_000);
    // $2,000 not earned (a parent's gift isn't income; interest is): $650 taxable at 10%.
    expect(federalTaxOf(200_000, "single", true, 0)).toBe(6_500);
  });
});

describe("the next estimated payment date", () => {
  it("is the date itself on the day, the next one the day after, none after January 15", () => {
    expect(nextEstimatedDate("2026-09-15")?.due).toBe("2026-09-15");
    expect(nextEstimatedDate("2026-09-16")?.due).toBe("2027-01-15");
    expect(nextEstimatedDate("2027-01-15")?.due).toBe(ESTIMATED_TAX.dates[3].due);
    expect(nextEstimatedDate("2027-01-16")).toBeNull();
  });
});

describe("a student's money", () => {
  const tx = (
    date: string,
    amountCents: number,
    description: string,
    pfc: string | null = null,
  ) => ({
    date,
    amountCents,
    description,
    pfc,
    accountId: "a",
  });

  it("reads a student-account refund as a school deposit, and payroll as pay", () => {
    const m = studentMoney({
      today: "2026-11-17",
      transactions: [
        tx("2026-11-02", -475_000, "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001"),
        tx("2026-11-07", -198_540, "STANFORD UNIVERSITY PAYROLL", "INCOME_SALARY"),
        tx(
          "2026-10-20",
          320_000,
          "STANFORD UNIVERSITY TUITION PAYMENT",
          "GENERAL_SERVICES_EDUCATION",
        ),
        tx("2026-11-03", 164_000, "STANFORD R&DE HOUSING PAYMENT"),
      ],
    });
    expect(m.schoolDeposits.map((t) => t.amountCents)).toEqual([-475_000]);
    expect(m.stipendNamed).toBe(false);
    expect(m.schoolPay.map((t) => t.amountCents)).toEqual([-198_540]);
    expect(m.tuition.map((t) => t.amountCents)).toEqual([320_000]);
    expect(m.campusRent.map((t) => t.amountCents)).toEqual([164_000]);
  });

  it("counts a stipend from $500, not a smaller refund, and only this year's", () => {
    const m = studentMoney({
      today: "2026-11-17",
      transactions: [
        tx("2026-10-01", -50_000, "UNIVERSITY OF X FELLOWSHIP STIPEND"),
        tx("2026-10-02", -49_999, "UNIVERSITY OF X FELLOWSHIP STIPEND"),
        tx("2025-12-01", -400_000, "UNIVERSITY OF X FELLOWSHIP STIPEND"),
      ],
    });
    expect(m.schoolDeposits.map((t) => t.amountCents)).toEqual([-50_000]);
    expect(m.stipendNamed).toBe(true);
  });
});

describe("the age reaches the card's tax (T5 deferred item)", () => {
  // 2026 single: $16,100 standard deduction plus $2,050 at 65 or older (Rev. Proc. 2025-32 4.14),
  // so tax starts at $18,150, not $16,100.
  it("adds the extra standard deduction from 65 in the tax and the marginal rate", () => {
    expect(standardDeductionOf("single", false, 0, 2026, 65)).toBe(1_610_000 + 205_000);
    expect(federalTaxOf(1_815_000, "single", false, 1_815_000, 2026, 65)).toBe(0);
    expect(federalTaxOf(1_815_100, "single", false, 1_815_100, 2026, 65)).toBe(10);
    expect(federalTaxOf(1_815_100, "single", false, 1_815_100, 2026, 64)).toBe(
      federalTaxOf(1_815_100, "single", false, 1_815_100, 2026),
    );
    expect(marginalRateFor(1_700_000, "single", false, 1_700_000, 2026, 65)).toBe(0);
    expect(marginalRateFor(1_700_000, "single", false, 1_700_000, 2026, 30)).toBe(0.1);
  });

  it("reads the age only when it is a number", () => {
    expect(ageOf({ age: { value: 66 } })).toBe(66);
    expect(ageOf({ age: { value: "66" } })).toBeNull();
    expect(ageOf({})).toBeNull();
  });
});
