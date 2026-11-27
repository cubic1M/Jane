import { describe, expect, it } from "vitest";
import { federalParams } from "@/config/tax-params";
import type { FilingStatus } from "@/config/tax";
import { standardDeductionOf } from "@/planning/student-tax";
import { estimateTaxes, standardDeductionFor } from "@/planning/tax-estimate";
import { inputOf } from "@/tax-bench/serialize";

// Tax T5: the standard deduction for the person's situation. The figures are Rev. Proc. 2024-40
// section 2.15 (2025) and Rev. Proc. 2025-32 section 4.14 (2026), and Pub. 501 (2025) Tables 7 and 8,
// read 2026-11-27. Each expected number below is worked by hand in the comment beside it.
const $ = (dollars: number) => Math.round(dollars * 100);
const P26 = federalParams(2026);
const P25 = federalParams(2025);

describe("standardDeductionFor", () => {
  it("is the regular amount for anyone who says nothing more", () => {
    for (const status of [
      "single",
      "married_joint",
      "married_separate",
      "head_of_household",
    ] as const)
      expect(standardDeductionFor(P26, { status, earnedCents: 0 })).toBe(
        P26.standardDeduction.value[status],
      );
  });

  it("limits a dependent to the greater of $1,350 or earned income plus $450 (2026 and 2025)", () => {
    // 600 + 450 = 1,050 < 1,350: the floor. 6,000 + 450 = 6,450. 20,000 + 450 caps at the regular 16,100.
    for (const P of [P26, P25]) {
      const s = (earnedCents: number) =>
        standardDeductionFor(P, { status: "single", claimedAsDependent: true, earnedCents });
      expect(s($(600))).toBe($(1_350));
      expect(s($(6_000))).toBe($(6_450));
      expect(s($(1_000_000))).toBe(P.standardDeduction.value.single);
    }
  });

  it("counts a taxable scholarship as earned income for a dependent, and never a negative amount", () => {
    // A $2,000 loss and a $3,000 scholarship are combined first: 1,000 + 450 = 1,450, over the floor.
    expect(
      standardDeductionFor(P25, {
        status: "single",
        claimedAsDependent: true,
        earnedCents: -$(2_000),
        taxableScholarshipCents: $(3_000),
      }),
    ).toBe($(1_450));
    // 2,000 wages + 3,000 scholarship + 450 = 5,450.
    expect(
      standardDeductionFor(P25, {
        status: "single",
        claimedAsDependent: true,
        earnedCents: $(2_000),
        taxableScholarshipCents: $(3_000),
      }),
    ).toBe($(5_450));
    // A net loss is not below the floor: max(1,350, -2,000 + 450).
    expect(
      standardDeductionFor(P25, {
        status: "single",
        claimedAsDependent: true,
        earnedCents: -$(2_000),
      }),
    ).toBe($(1_350));
  });

  it("does not limit someone with no dependent answer", () => {
    expect(standardDeductionFor(P26, { status: "single", earnedCents: $(600) })).toBe($(16_100));
    expect(
      standardDeductionFor(P26, {
        status: "single",
        claimedAsDependent: false,
        earnedCents: $(600),
      }),
    ).toBe($(16_100));
  });

  it("adds one amount for 65 or older (age at the year's end) and one for blind", () => {
    const single = (age: number | null, blind = false) =>
      standardDeductionFor(P26, { status: "single", age, blind, earnedCents: 0 });
    expect(single(64)).toBe($(16_100));
    expect(single(null)).toBe($(16_100));
    expect(single(65)).toBe($(16_100 + 2_050));
    expect(single(65, true)).toBe($(16_100 + 2 * 2_050));
    expect(single(40, true)).toBe($(16_100 + 2_050));
  });

  it("uses the married amount on a married status and the unmarried amount otherwise", () => {
    const at = (status: FilingStatus) =>
      standardDeductionFor(P26, { status, age: 66, earnedCents: 0 }) -
      P26.standardDeduction.value[status];
    expect(at("single")).toBe($(2_050));
    expect(at("head_of_household")).toBe($(2_050));
    expect(at("married_joint")).toBe($(1_650));
    expect(at("married_separate")).toBe($(1_650));
  });

  it("counts a spouse's age and blindness on a joint return only", () => {
    const joint = standardDeductionFor(P26, {
      status: "married_joint",
      age: 66,
      spouseAge: 65,
      blind: true,
      spouseBlind: true,
      earnedCents: 0,
    });
    // 32,200 + 4 x 1,650 = 38,800.
    expect(joint).toBe($(38_800));
    const separate = standardDeductionFor(P26, {
      status: "married_separate",
      age: 66,
      spouseAge: 65,
      spouseBlind: true,
      earnedCents: 0,
    });
    // 16,100 + 1,650: the person's own only.
    expect(separate).toBe($(17_750));
  });

  it("adds the extra amounts to a dependent's limited amount (Pub. 501 Table 8, Example 3)", () => {
    // 18 and blind, wages 2,900: 3,350 + 2,000 = 5,350 (2025).
    expect(
      standardDeductionFor(P25, {
        status: "single",
        age: 18,
        blind: true,
        claimedAsDependent: true,
        earnedCents: $(2_900),
      }),
    ).toBe($(5_350));
  });
});

describe("the estimate reads the situation", () => {
  const est = (year: number, status: FilingStatus, wages: number, rest = {}) =>
    estimateTaxes(inputOf(year, status, { wagesCents: $(wages) }, rest));

  it("HE-3a: a 2026 dependent with $6,000 of wages owes nothing", () => {
    const e = est(2026, "single", 6_000, { claimedAsDependent: true });
    expect(e.deduction.standardCents).toBe($(6_450));
    expect(e.taxableCents).toBe(0);
    expect(e.incomeTaxCents).toBe(0);
  });

  it("HE-3b: with $20,000 of wages the regular amount caps it: taxable $3,900, tax $390.00", () => {
    const e = est(2026, "single", 20_000, { claimedAsDependent: true });
    expect(e.deduction.standardCents).toBe($(16_100));
    expect(e.taxableCents).toBe($(3_900));
    expect(e.incomeTaxCents).toBe($(390));
  });

  it("HE-3c: single, 67, wages $30,000: the standard deduction is $18,150", () => {
    // Before the senior deduction (T19) taxable would be $11,850 and the tax $1,185.00; they are not
    // asserted here because T19 changes them.
    expect(est(2026, "single", 30_000, { age: 67 }).deduction.standardCents).toBe($(18_150));
  });

  it("the deduction an itemizer compares against is the full one, extra amounts included", () => {
    // Itemized 17,000 beats 16,100 but not 16,100 + 2,050 = 18,150.
    const e = estimateTaxes(
      inputOf(
        2026,
        "single",
        { wagesCents: $(60_000) },
        { age: 70, mortgageInterestCents: $(17_000) },
      ),
    );
    expect(e.deduction.kind).toBe("standard");
    expect(e.deduction.standardCents).toBe($(18_150));
  });

  it("a dependent's earned income takes half the self-employment tax off", () => {
    // 5,000 of self-employment: tax = 5,000 x 0.9235 x 15.3% = 706.5, half 353.25; earned 4,646.75 + 450.
    const e = estimateTaxes(
      inputOf(2026, "single", { selfEmploymentCents: $(5_000) }, { claimedAsDependent: true }),
    );
    const half = e.adjustments.halfSelfEmploymentTaxCents;
    expect(e.deduction.standardCents).toBe(Math.max($(1_350), $(5_000) - half + $(450)));
  });
});

describe("student-tax shares the rule", () => {
  it("standardDeductionOf is standardDeductionFor", () => {
    for (const earned of [0, $(600), $(6_000), $(40_000)])
      for (const dependent of [true, false])
        expect(standardDeductionOf("single", dependent, earned, 2026)).toBe(
          standardDeductionFor(P26, {
            status: "single",
            claimedAsDependent: dependent,
            earnedCents: earned,
          }),
        );
  });
});
