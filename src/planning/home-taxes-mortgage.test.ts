import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { draftParams, federalParams } from "@/config/tax-params";
import { inputOf } from "@/tax-bench/serialize";
import { deductibleMortgageInterest, homeTaxes, saltCap, type HomeInput } from "./home-taxes";
import { estimateTaxes } from "./tax-estimate";

// Tax T6: home mortgage interest counts on the first $750,000 of debt ($375,000 married filing
// separately; 26 USC 163(h)(3)(B)(ii), (F)(i)(II); Publication 936 (2025), Part II line 8, read
// 2026-11-27), worked once, in deductibleMortgageInterest, by both the estimate and the home section.
const $ = (dollars: number) => Math.round(dollars * 100);
const P26 = federalParams(2026);
const draftOrSupported = (year: number) => {
  try {
    return federalParams(year);
  } catch {
    return draftParams(year);
  }
};

describe("deductibleMortgageInterest", () => {
  const at = (status: FilingStatus, interest: number, balance: number | null) =>
    deductibleMortgageInterest(P26, {
      status,
      interestCents: $(interest),
      balanceCents: balance === null ? null : $(balance),
    });

  it("counts all the interest on a loan at or under the limit, and cuts it to the share over", () => {
    // $750,000 exactly: the whole $40,000. $1,000,000: 750 / 1,000 of $40,000 = $30,000.
    expect(at("single", 40_000, 750_000)).toEqual({
      cents: $(40_000),
      limitCents: $(750_000),
      limited: false,
    });
    expect(at("single", 40_000, 1_000_000)).toEqual({
      cents: $(30_000),
      limitCents: $(750_000),
      limited: true,
    });
  });

  it("flags a loan one cent over the limit, though the rounded interest does not move", () => {
    // 4,000,000 x 75,000,000 / 75,000,001 = 3,999,999.9467: rounds to 4,000,000, and the figure is flagged.
    const r = deductibleMortgageInterest(P26, {
      status: "single",
      interestCents: 4_000_000,
      balanceCents: 75_000_001,
    });
    expect(r.cents).toBe(4_000_000);
    expect(r.limited).toBe(true);
  });

  it("halves the limit for a separate return: $375,000", () => {
    // $40,000 on $500,000 filing separately: 375 / 500 = 75% = $30,000; on $375,000 all of it.
    expect(at("married_separate", 40_000, 500_000).cents).toBe($(30_000));
    expect(at("married_separate", 40_000, 375_000).limited).toBe(false);
    // The other three statuses use the full limit.
    for (const s of ["single", "married_joint", "head_of_household"] as const)
      expect(at(s, 40_000, 500_000).cents).toBe($(40_000));
  });

  it("counts all of it when the loan's size is not known, and ignores a debt's sign", () => {
    expect(at("single", 40_000, null).cents).toBe($(40_000));
    expect(at("single", 40_000, -1_000_000).cents).toBe($(30_000));
    expect(at("single", 0, 1_000_000).cents).toBe(0);
  });

  it("reads each year's own limit from the parameters", () => {
    for (const year of [2025, 2026, 2027] as const) {
      // 2027 is a draft year until its mileage notice is out: the draft is read the same way.
      const p = year === 2027 ? draftOrSupported(year) : federalParams(year);
      expect(p.mortgageDebt.value).toEqual({ normal: $(750_000), marriedSeparate: $(375_000) });
      expect(p.mortgageDebt.source).toMatch(
        /^https:\/\/www\.law\.cornell\.edu\/uscode\/text\/26\/163$/,
      );
      expect(p.mortgageDebt.checkedOn).toBe("2026-11-27");
    }
  });
});

describe("saltCap is the year's own", () => {
  it("is $40,000 in 2025 and $40,400 in 2026 for most people", () => {
    expect(saltCap(0, "single", 2025)).toBe($(40_000));
    expect(saltCap(0, "single", 2026)).toBe($(40_400));
  });

  it("cuts a separate return's cap by 15 cents a dollar over half the threshold (164(b)(7), (b)(6))", () => {
    // 2026 separate: cap 20,200, threshold 252,500; $262,000 is $9,500 over: 20,200 - 1,425 = 18,775.
    expect(saltCap($(262_000), "married_separate", 2026)).toBe($(18_775));
  });
});

// The home section and the estimate must not say two things: each is given the same loan, the same
// taxes paid and the same income, and the figure they put in the itemized deduction must match.
describe("the home section and the estimate agree", () => {
  const statuses: FilingStatus[] = [
    "single",
    "married_joint",
    "married_separate",
    "head_of_household",
  ];
  const home = (
    year: number,
    status: FilingStatus,
    agiCents: number,
    interestCents: number,
    balanceCents: number | null,
    taxesCents: number,
  ): HomeInput => ({
    year,
    status,
    agiCents,
    mortgage: { name: "Home loan", ytdInterestCents: interestCents, balanceCents, form1098: null },
    propertyTax: [{ id: "p", date: `${year}-04-10`, payee: "COUNTY TAX", cents: taxesCents }],
    stateIncomeTaxCents: 0,
    points: null,
    homeOfficeSqFt: null,
    energy: [],
    sale: null,
  });

  const cases: [string, number, number | null, number][] = [
    ["under the limit", $(12_000), $(400_000), $(8_000)],
    ["exactly at the limit", $(40_000), $(750_000), $(8_000)],
    ["over the limit", $(40_000), $(1_000_000), $(8_000)],
    ["a loan whose size is not known", $(40_000), null, $(8_000)],
    ["taxes over the cap", $(30_000), $(900_000), $(70_000)],
  ];

  for (const year of [2025, 2026] as const)
    for (const status of statuses)
      for (const [name, interest, balance, taxes] of cases)
        it(`${year}, ${status}, ${name}`, () => {
          const estimate = estimateTaxes(
            inputOf(
              year,
              status,
              { wagesCents: $(300_000) },
              {
                mortgageInterestCents: interest,
                mortgageBalanceCents: balance,
                otherStateLocalTaxCents: taxes,
              },
            ),
          );
          const section = homeTaxes(
            home(year, status, estimate.agiCents, interest, balance, taxes),
          );
          expect(section.mortgageInterest!.cents).toBe(
            estimate.deduction.itemized.mortgageInterestCents,
          );
          expect(section.salt.allowedCents).toBe(estimate.deduction.itemized.stateLocalTaxCents);
        });
});
