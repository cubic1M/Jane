import { describe, expect, it } from "vitest";
import { GIVING } from "@/config/giving";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { givingOptions, needsReceipt } from "./giving";

// Spec step 168: each giving option shows the tax with it and without it, from the same
// estimate engine.

const input = (over: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "TX",
  income: { ...NO_INCOME, wagesCents: 15_000_000, socialSecurityWagesCents: 15_000_000 },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 900_000,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 300_000,
  federalWithheldCents: 0,
  federalEstimatedPaidCents: 0,
  stateWithheldCents: 0,
  stateEstimatedPaidCents: 0,
  ...over,
});

const tax = (i: EstimateInput, charity: number, longTerm = 0) =>
  estimateTaxes({
    ...i,
    charityCents: charity,
    income: { ...i.income, longTermGainsCents: i.income.longTermGainsCents + longTerm },
  }).totalTaxCents;

describe("giving, done smart", () => {
  it("shows bunching as the tax with it and without it over two years", () => {
    const i = input();
    const [bunch, fund] = givingOptions({ input: i, yearlyCents: 500_000, shares: [] });
    expect(bunch.key).toBe("bunch");
    expect(bunch.withoutCents).toBe(tax(i, 500_000) * 2);
    expect(bunch.withCents).toBe(tax(i, 1_000_000) + tax(i, 0));
    expect(bunch.savesCents).toBe(bunch.withoutCents - bunch.withCents);
    // Mortgage interest and state tax of $12,000 don't clear the $16,100 standard deduction;
    // $10,000 of gifts in one year does, $5,000 a year doesn't.
    expect(bunch.savesCents).toBeGreaterThan(0);
    // A donor-advised fund is the same bunching, with grants each year.
    expect(fund).toMatchObject({
      key: "fund",
      withCents: bunch.withCents,
      withoutCents: bunch.withoutCents,
    });
  });

  it("shows giving shares as the tax with the gain never taxed, and without (sold first)", () => {
    const i = input();
    const options = givingOptions({
      input: i,
      yearlyCents: 500_000,
      shares: [
        { name: "BOND", valueCents: 1_000_000, longTermGainCents: 50_000 },
        { name: "VTI", valueCents: 2_000_000, longTermGainCents: 1_200_000 },
      ],
    });
    const shares = options.find((o) => o.key === "shares")!;
    // The most gain for each dollar given: VTI, 60% gain; $5,000 of it carries $3,000.
    expect(shares.title).toBe("Give $5,000 of VTI shares instead of cash");
    expect(shares.withCents).toBe(tax(i, 500_000));
    expect(shares.withoutCents).toBe(tax(i, 500_000, 300_000));
    // 15% on the $3,000 gain, and a little more: the gain raises income, and with it the
    // 0.5% floor on the charity deduction ($15 at 24%).
    expect(shares.savesCents).toBe(45_000 + 360);
  });

  it("leaves out shares with no long-term gain, and small giving", () => {
    expect(
      givingOptions({
        input: input(),
        yearlyCents: 500_000,
        shares: [{ name: "LOSS", valueCents: 100_000, longTermGainCents: -5_000 }],
      }).map((o) => o.key),
    ).toEqual(["bunch", "fund"]);
    expect(
      givingOptions({ input: input(), yearlyCents: GIVING.minYearlyCents - 1, shares: [] }),
    ).toEqual([]);
  });

  it("asks for a receipt from $250", () => {
    expect(needsReceipt(24_999)).toBe(false);
    expect(needsReceipt(25_000)).toBe(true);
  });
});
