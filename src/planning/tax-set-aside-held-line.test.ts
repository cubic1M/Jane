import { describe, expect, it } from "vitest";
import { NO_INCOME, estimateTaxes, type EstimateIncome } from "./tax-estimate";
import { workOutSetAside, type SetAsideInput, type TaxLine } from "./tax-set-aside";

// CodeRabbit sweep 1b: "Held back from Safe to spend" (now "Held back for tax") showed the amount left after what is kept
// apart even when that was under the minimum and Safe to spend held $0. (Same helper as
// tax-set-aside.test.ts.)

const asked = (income: Partial<EstimateIncome>, withheldCents = 0, over = {}): SetAsideInput => {
  const input = {
    year: 2026,
    filingStatus: "single" as const,
    childrenUnder17: 0,
    otherDependants: 0,
    age: 40,
    state: "TX",
    income: { ...NO_INCOME, ...income },
    studentLoanInterestCents: 0,
    mortgageInterestCents: 0,
    charityCents: 0,
    medicalCents: 0,
    otherStateLocalTaxCents: 0,
    federalWithheldCents: withheldCents,
    federalEstimatedPaidCents: 0,
    stateWithheldCents: 0,
    stateEstimatedPaidCents: 0,
  };
  return {
    year: 2026,
    today: "2027-01-20",
    elapsed: 1,
    advice: false,
    estimate: estimateTaxes(input),
    input,
    withholdingKnown: true,
    incomeSoFarCents:
      (income.wagesCents ?? 0) + (income.selfEmploymentCents ?? 0) + (income.interestCents ?? 0),
    businessCostsCents: 0,
    businessCostsYearCents: 0,
    homeOfficeCents: 0,
    profitAssumed: false,
    federalWithheldCents: withheldCents,
    stateWithheldCents: 0,
    withheldFrom: withheldCents > 0 ? "pay_stub" : "none",
    withheldProjected: false,
    seenPaidCents: 0,
    toldPaidCents: 0,
    keptApart: { seenCents: 0, seenIn: [], toldCents: null },
    incomeMonths: 12,
    firstSeen: "2026-01-02",
    filingStatusKnown: true,
    corrected: { income: false, wages: false, selfEmployed: false },
    ...over,
  };
};

const line = (lines: readonly TaxLine[], key: string) => lines.find((l) => l.key === key)?.cents;

// Each section starts at an unsigned line; each "=" is the sum so far, exactly, in cents.
function expectToAddUp(lines: readonly TaxLine[]) {
  let running = 0;
  for (const l of lines) {
    if (l.cents === null) continue;
    if (l.sign === "") running = l.cents;
    else if (l.sign === "+") running += l.cents;
    else if (l.sign === "−") running -= l.cents;
    else {
      expect(l.cents, l.label).toBe(running);
    }
  }
}

const WAGES = (cents: number) => ({ wagesCents: cents, socialSecurityWagesCents: cents });

describe("the held line under the minimum", () => {
  it("does not say Safe to spend holds an amount it doesn't", () => {
    const out = workOutSetAside(
      asked(WAGES(8_000_000), 870_000, {
        keptApart: { seenCents: 3_000, seenIn: ["Tax savings"], toldCents: null },
      }),
    );
    expect(out.holdCents).toBe(0);
    const held = out.lines.find((l) => l.key === "held")!;
    expect(held.label).not.toMatch(/Held back for tax/);
    expect(held.cents).toBe(4_000);
  });
  it("still says it when the amount is held", () => {
    const out = workOutSetAside(
      asked({ selfEmploymentCents: 6_000_000 }, 0, {
        keptApart: { seenCents: 300_000, seenIn: ["Tax savings"], toldCents: null },
      }),
    );
    expect(out.holdCents).toBeGreaterThan(0);
    expect(out.lines.find((l) => l.key === "held")!.label).toBe("Held back for tax");
  });
});
