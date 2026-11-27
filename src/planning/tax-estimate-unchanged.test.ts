import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FilingStatus } from "@/config/tax";
import { estimateTaxes, NO_INCOME, type EstimateInput } from "@/planning/tax-estimate";

// Tax T1 moved the federal figures into src/config/tax-params. The estimate for every person below
// was written to tax-estimate-unchanged.golden.json from origin/main BEFORE the move
// (GOLDEN_WRITE=1 writes it). This test proves the move changed nothing: the whole estimate of each
// person hashes the same, and the headline figures are the same to the cent.
const GOLDEN = join(__dirname, "tax-estimate-unchanged.golden.json");
const $ = (dollars: number) => Math.round(dollars * 100);

type Variant = { name: string; apply: (i: EstimateInput) => EstimateInput };
const withIncome = (i: EstimateInput, o: Partial<EstimateInput["income"]>): EstimateInput => ({
  ...i,
  income: { ...i.income, ...o },
});

const variants: Variant[] = [
  { name: "wages only", apply: (i) => i },
  { name: "two children", apply: (i) => ({ ...i, childrenUnder17: 2, otherDependants: 1 }) },
  { name: "freelance 40k", apply: (i) => withIncome(i, { selfEmploymentCents: $(40_000) }) },
  {
    name: "gains and dividends",
    apply: (i) =>
      withIncome(i, {
        longTermGainsCents: $(30_000),
        shortTermGainsCents: $(4_000),
        dividendsCents: $(6_000),
        qualifiedDividendsCents: $(5_000),
        interestCents: $(1_200),
      }),
  },
  {
    name: "itemizes",
    apply: (i) => ({
      ...i,
      mortgageInterestCents: $(22_000),
      charityCents: $(6_000),
      medicalCents: $(20_000),
      otherStateLocalTaxCents: $(14_000),
    }),
  },
  { name: "gifts, no itemizing", apply: (i) => ({ ...i, charityCents: $(1_500) }) },
  {
    name: "student loan, age 40, California",
    apply: (i) => ({ ...i, studentLoanInterestCents: $(2_500), age: 40, state: "CA" }),
  },
  {
    name: "ISO preference, New York",
    apply: (i) => ({ ...i, amtPreferenceCents: $(300_000), state: "NY" }),
  },
  {
    name: "retired, social security, 70",
    apply: (i) =>
      withIncome(
        { ...i, age: 70, state: "TX" },
        {
          socialSecurityBenefitsCents: $(30_000),
          retirementCents: $(25_000),
          unemploymentCents: $(2_000),
          rentalCents: $(6_000),
          otherCents: $(900),
        },
      ),
  },
  { name: "age 22, Illinois", apply: (i) => ({ ...i, age: 22, state: "IL" }) },
];

const statuses: FilingStatus[] = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
];
const wages = [0, 4_000, 18_000, 39_000, 85_632, 150_000, 262_000, 700_000];

function people(): { name: string; input: EstimateInput }[] {
  const out: { name: string; input: EstimateInput }[] = [];
  for (const filingStatus of statuses) {
    for (const w of wages) {
      for (const v of variants) {
        const base: EstimateInput = {
          year: 2026,
          filingStatus,
          childrenUnder17: 0,
          otherDependants: 0,
          state: null,
          income: { ...NO_INCOME, wagesCents: $(w), socialSecurityWagesCents: $(w) },
          studentLoanInterestCents: 0,
          mortgageInterestCents: 0,
          charityCents: 0,
          medicalCents: 0,
          otherStateLocalTaxCents: 0,
          federalWithheldCents: Math.round($(w) * 0.12),
          federalEstimatedPaidCents: 0,
          stateWithheldCents: Math.round($(w) * 0.04),
          stateEstimatedPaidCents: 0,
        };
        out.push({ name: `${filingStatus} ${w} ${v.name}`, input: v.apply(base) });
      }
    }
  }
  return out;
}

const run = () =>
  people().map(({ name, input }) => {
    const e = estimateTaxes(input);
    return {
      name,
      agi: e.agiCents,
      taxable: e.taxableCents,
      total: e.totalTaxCents,
      refund: e.refundCents,
      state: e.state ? e.state.taxCents : null,
      sha: createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 16),
    };
  });

describe("the estimate is unchanged by the move to tax-params (Tax T1)", () => {
  const now = run();
  if (process.env.GOLDEN_WRITE === "1" && !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(now).replace(/},/g, "},\n") + "\n");
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as ReturnType<typeof run>;

  it("covers 320 people", () => {
    expect(golden).toHaveLength(320);
    expect(now).toHaveLength(320);
  });

  it("headline figures are the same to the cent for every person", () => {
    const strip = (r: ReturnType<typeof run>) => r.map(({ sha: _sha, ...rest }) => rest);
    expect(strip(now)).toEqual(strip(golden));
  });

  it("the whole estimate, line by line, is the same for every person", () => {
    expect(now.map((r) => r.sha)).toEqual(golden.map((r) => r.sha));
  });
});
