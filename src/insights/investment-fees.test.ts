import { describe, expect, it } from "vitest";
import { HIGH_FEE_BPS, RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import { demoFeeTransactions, demoInvestments } from "@/lib/investments/__fixtures__/demo";
import {
  equivalentFor,
  equivalentsSaving,
  feeSummary,
  flatFeeCost,
  percentFeeCost,
} from "./investment-fees";

// Spec step 130: what investing costs, from the holdings data only.

describe("30-year math", () => {
  it("costs a percentage fee as the growth it takes away", () => {
    // $10,000 at 1% a year for 30 years: 10,000 × (1.07³⁰ − 1.06³⁰) at 7% growth.
    expect(percentFeeCost(1_000_000, 0.01, 30, 0.07)).toBe(1_868_764);
    expect(percentFeeCost(1_000_000, 0.01, 30, 0.04)).toBe(816_135);
    expect(percentFeeCost(1_000_000, 0, 30, 0.07)).toBe(0);
    // With no growth, it's the fee on a shrinking balance.
    expect(percentFeeCost(1_000_000, 0.01, 1, 0)).toBe(10_000);
  });

  it("costs a flat yearly fee as the fees plus what they'd have grown to", () => {
    expect(flatFeeCost(10_000, 30, 0.07)).toBe(944_608);
    expect(flatFeeCost(10_000, 30, 0.04)).toBe(560_849);
    expect(flatFeeCost(10_000, 30, 0)).toBe(300_000);
  });
});

describe("feeSummary on the demo bank", () => {
  const data = demoInvestments();
  const fees = feeSummary(data.accounts, demoFeeTransactions());
  const holdings = data.accounts.flatMap((a) => a.holdings);

  it("costs every fund from its value and expense ratio", () => {
    for (const f of fees.funds) {
      expect(f.yearlyCents).toBe(Math.round((f.holding.valueCents * f.expenseRatioBps) / 10_000));
    }
    expect(fees.funds[0].holding.name).toBe("Northstar Target 2055 Fund");
    // Shares of one company and plain cash have no yearly cost; nothing is unknown.
    expect(fees.funds.map((f) => f.holding.ticker)).not.toContain("ACME");
    expect(fees.unknown).toEqual([]);
    expect(fees.fundsYearlyCents).toBe(fees.funds.reduce((s, f) => s + f.yearlyCents, 0));
  });

  it("adds advisory and account fees from the last 12 months of fee records", () => {
    expect(fees.advisoryCents).toBe(4 * 3_120);
    expect(fees.accountFeesCents).toBe(4 * 1_250);
    expect(fees.totalYearlyCents).toBe(fees.fundsYearlyCents + 12_480 + 5_000);
  });

  it("gives 30 years as a range from the low to the high return", () => {
    const expected = (growth: number) =>
      fees.funds.reduce(
        (s, f) => s + percentFeeCost(f.holding.valueCents, f.expenseRatioBps / 10_000, 30, growth),
        0,
      ) + flatFeeCost(17_480, 30, growth);
    expect(fees.overYears).toEqual({
      lowCents: expected(RETURN_LOW.value),
      highCents: expected(RETURN_HIGH.value),
    });
    expect(fees.overYears.lowCents).toBeLessThan(fees.overYears.highCents);
  });

  it("finds a lower-cost equivalent for each costly fund, on the plan's menu in a 401(k)", () => {
    expect(fees.equivalents.map((e) => [e.holding.ticker, e.ticker, e.inPlanMenu])).toEqual([
      ["NSTDX", "KTRGX", true],
      ["SLGFX", "KTSIX", true],
      ["PDIFX", "KDVX", false],
    ]);
    const slgfx = fees.equivalents.find((e) => e.holding.ticker === "SLGFX")!;
    expect(slgfx.yearlySavingCents).toBe(Math.round((slgfx.holding.valueCents * 99) / 10_000));
    // The saving is the difference in fees: the new fund's own fee still counts.
    expect(slgfx.overYears.highCents).toBe(
      percentFeeCost(slgfx.holding.valueCents, 0.0102, 30, RETURN_HIGH.value) -
        percentFeeCost(slgfx.holding.valueCents, 0.0003, 30, RETURN_HIGH.value),
    );
    const total = equivalentsSaving(fees.equivalents);
    expect(total.yearlyCents).toBe(fees.equivalents.reduce((s, e) => s + e.yearlySavingCents, 0));
  });

  it("leaves cheap funds alone and never suggests a dearer one", () => {
    const cheap = holdings.find((h) => h.ticker === "KTSIX")!;
    expect(cheap.expenseRatioBps).toBeLessThanOrEqual(HIGH_FEE_BPS);
    expect(equivalentFor(cheap, { subtype: "brokerage" })).toBeNull();
    const slgfx = holdings.find((h) => h.ticker === "SLGFX")!;
    // Outside a plan, the best one; inside, only what the plan offers.
    expect(equivalentFor(slgfx, { subtype: "ira" })?.ticker).toBe("KLCX");
    expect(equivalentFor(slgfx, { subtype: "401k" })?.ticker).toBe("KTSIX");
    expect(equivalentFor({ ...slgfx, ticker: "ZZZZ" }, { subtype: "ira" })).toBeNull();
  });

  it("is empty without holdings or fees", () => {
    expect(feeSummary([], [])).toMatchObject({
      funds: [],
      totalYearlyCents: 0,
      overYears: { lowCents: 0, highCents: 0 },
      equivalents: [],
    });
  });
});
