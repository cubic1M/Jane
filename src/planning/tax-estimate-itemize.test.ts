import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { estimateTaxes } from "@/planning/tax-estimate";
import { inputOf } from "@/tax-bench/serialize";

// Tax T6: the choice between itemizing and the standard deduction compares like with like. A person
// who does not itemize takes the full standard deduction AND up to $1,000 ($2,000 joint) of cash gifts
// (26 USC 170(p), from 2026), so itemizing has to beat both together (audit 4.5.3). Hand figures are
// worked in the comments; sources: Rev. Proc. 2025-32 section 4.14(1) (standard deduction $16,100
// single, 2026), 26 USC 170(b)(1)(I) (0.5 percent floor), 26 USC 63(c)(6)(A).
const $ = (dollars: number) => Math.round(dollars * 100);

const single = (rest: Parameters<typeof inputOf>[3], wages = $(100_000), year = 2026) =>
  estimateTaxes(inputOf(year, "single", { wagesCents: wages }, rest));

describe("itemized against the standard deduction plus the non-itemizer gift", () => {
  it("HE-4: itemized $16,500 against $16,100 + $1,000 of gifts takes $17,100", () => {
    // Itemized: $16,000 of mortgage interest + ($1,000 of gifts - 0.5% x $100,000 = $500) = $16,500.
    const e = single({ mortgageInterestCents: $(16_000), charityCents: $(1_000) });
    expect(e.deduction.itemizedCents).toBe($(16_500));
    expect(e.deduction.standardCents).toBe($(16_100));
    expect(e.deduction.kind).toBe("standard");
    expect(e.deduction.nonItemizerCharityCents).toBe($(1_000));
    // AGI $100,000 - $17,100 = $82,900.
    expect(e.taxableCents).toBe($(82_900));
  });

  it("itemizes when the itemized total is larger than the standard deduction plus the gifts", () => {
    // $17,000 + $500 = $17,500 > $17,100: itemizes, and the gift is counted once, inside the total.
    const e = single({ mortgageInterestCents: $(17_000), charityCents: $(1_000) });
    expect(e.deduction.kind).toBe("itemized");
    expect(e.deduction.nonItemizerCharityCents).toBe(0);
    expect(e.taxableCents).toBe($(82_500));
  });

  it("takes the standard path on a tie, and the same taxable income either way", () => {
    // $16,600 + $500 = $17,100 = $16,100 + $1,000.
    const e = single({ mortgageInterestCents: $(16_600), charityCents: $(1_000) });
    expect(e.deduction.kind).toBe("standard");
    expect(e.taxableCents).toBe($(82_900));
  });

  it("gives a married couple filing jointly up to $2,000 of gifts beside the standard deduction", () => {
    // 2026 joint standard deduction $32,200 + $2,000 = $34,200; itemized $30,000 + $4,000 - 0.5% x
    // $200,000 ($1,000) = $33,000 is smaller, so the standard path: taxable $200,000 - $34,200.
    const e = estimateTaxes(
      inputOf(
        2026,
        "married_joint",
        { wagesCents: $(200_000) },
        { mortgageInterestCents: $(30_000), charityCents: $(4_000) },
      ),
    );
    expect(e.deduction.itemizedCents).toBe($(33_000));
    expect(e.deduction.nonItemizerCharityCents).toBe($(2_000));
    expect(e.taxableCents).toBe($(165_800));
  });

  it("adds no gift to the standard deduction in 2025 (the deduction starts in 2026)", () => {
    // 2025 single standard $15,750, no gift deduction, no 0.5% floor: $16,000 + $1,000 = $17,000.
    const e = single(
      { mortgageInterestCents: $(16_000), charityCents: $(1_000) },
      $(100_000),
      2025,
    );
    expect(e.deduction.kind).toBe("itemized");
    expect(e.deduction.nonItemizerCharityCents).toBe(0);
    expect(e.taxableCents).toBe($(83_000));
  });

  it("never takes a smaller deduction than either path gives, for anyone", () => {
    const statuses: FilingStatus[] = [
      "single",
      "married_joint",
      "married_separate",
      "head_of_household",
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...statuses),
        fc.constantFrom(2025, 2026),
        fc.integer({ min: 0, max: $(400_000) }),
        fc.integer({ min: 0, max: $(60_000) }),
        fc.integer({ min: 0, max: $(20_000) }),
        (status, year, wages, mortgage, gifts) => {
          const e = estimateTaxes(
            inputOf(
              year,
              status,
              { wagesCents: wages },
              { mortgageInterestCents: mortgage, charityCents: gifts },
            ),
          );
          const taken =
            e.deduction.kind === "itemized"
              ? e.deduction.itemizedCents
              : e.deduction.standardCents + e.deduction.nonItemizerCharityCents;
          const standardPath =
            e.deduction.standardCents +
            (year === 2025 ? 0 : Math.min(gifts, status === "married_joint" ? $(2_000) : $(1_000)));
          expect(taken).toBeGreaterThanOrEqual(Math.max(e.deduction.itemizedCents, standardPath));
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("married filing separately from a spouse who itemizes", () => {
  const mfs = (spouseItemizes: boolean | null | undefined, interest: number) =>
    estimateTaxes(
      inputOf(
        2026,
        "married_separate",
        { wagesCents: $(100_000) },
        {
          mortgageInterestCents: interest,
          ...(spouseItemizes === undefined ? {} : { spouseItemizes }),
        },
      ),
    );

  it("has no standard deduction and itemizes whatever it comes to (63(c)(6)(A))", () => {
    const e = mfs(true, $(9_000));
    expect(e.deduction.standardCents).toBe(0);
    expect(e.deduction.kind).toBe("itemized");
    expect(e.taxableCents).toBe($(91_000));
  });

  it("takes the better of the two for a spouse who does not itemize, or who has not said", () => {
    for (const said of [false, null, undefined] as const) {
      const e = mfs(said, $(9_000));
      expect(e.deduction.standardCents).toBe($(16_100));
      expect(e.deduction.kind).toBe("standard");
      expect(e.taxableCents).toBe($(83_900));
    }
  });

  it("is ignored for anyone who does not file separately", () => {
    const e = estimateTaxes(
      inputOf(2026, "single", { wagesCents: $(100_000) }, { spouseItemizes: true }),
    );
    expect(e.deduction.standardCents).toBe($(16_100));
  });
});
