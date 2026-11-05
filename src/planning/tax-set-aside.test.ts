import { describe, expect, it } from "vitest";
import { checkGuardrails } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { NO_INCOME, estimateTaxes, type EstimateIncome } from "./tax-estimate";
import { leftLabel, workOutSetAside, type SetAsideInput, type TaxLine } from "./tax-set-aside";

// The tax left to cover, checked by hand. Every expected figure below was worked out on paper from
// the 2026 single-filer numbers: a $16,100 standard deduction; 10% to $12,400, 12% to $50,400, 22%
// above; self-employment tax at 15.3% on 92.35% of net earnings. All people here are made up.

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

describe("three known answers, by hand", () => {
  // $80,000 less $16,100 is $63,900 taxable: $1,240 + $4,560 + $2,970 = $8,770.
  it("a salaried person with withholding that falls short", () => {
    const out = workOutSetAside(asked(WAGES(8_000_000), 800_000));
    expect(line(out.lines, "taxable")).toBe(6_390_000);
    expect(line(out.lines, "tax_year")).toBe(877_000);
    expect(line(out.lines, "withheld")).toBe(800_000);
    expect(line(out.lines, "left")).toBe(77_000);
    expect(out.status).toBe("needed");
    expect(out.holdCents).toBe(77_000);
    expectToAddUp(out.lines);
  });

  it("a salaried person with enough withheld has nothing to hold back", () => {
    const out = workOutSetAside(asked(WAGES(8_000_000), 900_000));
    expect(line(out.lines, "ahead")).toBe(23_000);
    expect(line(out.lines, "left")).toBe(0);
    expect(out.status).toBe("covered");
    expect(out.holdCents).toBe(0);
    expectToAddUp(out.lines);
  });

  // SE tax: $60,000 x 0.9235 x 0.153 = $8,477.73; half is $4,238.87. After the standard deduction,
  // $39,661.13; QBI is 20% of that, $7,932.23, leaving $31,728.90 taxable. Income tax: $1,240 + 12%
  // of $19,328.90 = $3,559.47. In all, $12,037.20.
  it("a freelancer with nothing withheld", () => {
    const out = workOutSetAside(asked({ selfEmploymentCents: 6_000_000 }));
    expect(line(out.lines, "half_se")).toBe(423_887);
    expect(line(out.lines, "qbi")).toBe(793_223);
    expect(line(out.lines, "taxable")).toBe(3_172_890);
    expect(line(out.lines, "income_tax")).toBe(355_947);
    expect(line(out.lines, "se_tax")).toBe(847_773);
    expect(line(out.lines, "left")).toBe(1_203_720);
    expect(out.holdCents).toBe(1_203_720);
    expectToAddUp(out.lines);
  });

  it("the same freelancer halfway through the year, with a payment made", () => {
    const out = workOutSetAside(
      asked({ selfEmploymentCents: 6_000_000 }, 0, {
        today: "2026-07-02",
        elapsed: 0.5,
        incomeSoFarCents: 3_000_000,
        seenPaidCents: 200_000,
      }),
    );
    expect(line(out.lines, "income_seen")).toBe(3_000_000);
    expect(line(out.lines, "income_rest")).toBe(3_000_000);
    expect(line(out.lines, "tax_so_far")).toBe(601_860);
    expect(line(out.lines, "left")).toBe(401_860);
    expectToAddUp(out.lines);
  });

  // SE tax: $20,000 x 0.9235 x 0.153 = $2,825.91; half is $1,412.96. $70,000 less that and $16,100 is
  // $52,487.04; QBI is 20% of $18,587.04, $3,717.41, leaving $48,769.63. Income tax: $1,240 + 12% of
  // $36,369.63 = $5,604.36. In all $8,430.27, less $4,000 withheld.
  it("someone with both a salary and freelance work", () => {
    const out = workOutSetAside(
      asked({ ...WAGES(5_000_000), selfEmploymentCents: 2_000_000 }, 400_000),
    );
    expect(line(out.lines, "taxable")).toBe(4_876_963);
    expect(line(out.lines, "tax_year")).toBe(843_027);
    expect(line(out.lines, "left")).toBe(443_027);
    expectToAddUp(out.lines);
  });
});

describe("the lines", () => {
  it("add up when costs, gains and credits are all in play", () => {
    const out = workOutSetAside(
      asked(
        {
          ...WAGES(3_000_000),
          selfEmploymentCents: 900_000,
          interestCents: 40_000,
          shortTermGainsCents: 150_000,
        },
        300_000,
        {
          elapsed: 0.8,
          businessCostsCents: 80_000,
          businessCostsYearCents: 100_000,
          homeOfficeCents: 50_000,
          incomeSoFarCents: 3_100_000,
          seenPaidCents: 10_000,
          toldPaidCents: 20_000,
        },
      ),
    );
    expectToAddUp(out.lines);
  });

  it("says where each line came from, and how it knows", () => {
    const out = workOutSetAside(asked({ selfEmploymentCents: 6_000_000 }));
    for (const l of out.lines) {
      expect(l.from.length, l.key).toBeGreaterThan(0);
      expect(["seen", "estimated", "assumed", "told"]).toContain(l.source);
    }
    expect(out.lines.find((l) => l.key === "deduction")?.source).toBe("assumed");
    expect(out.lines.find((l) => l.key === "income_seen")?.source).toBe("seen");
  });

  it("add up when deductions are more than the income", () => {
    const out = workOutSetAside(asked(WAGES(500_000)));
    expect(line(out.lines, "taxable")).toBe(0);
    expectToAddUp(out.lines);
  });
});

describe("what Jane doesn't know", () => {
  it("never reads unknown withholding on wages as $0", () => {
    const out = workOutSetAside(
      asked(WAGES(8_000_000), 0, { withholdingKnown: false, withheldFrom: "none" }),
    );
    expect(out.status).toBe("unknown");
    expect(out.notYetPaidCents).toBeNull();
    expect(out.holdCents).toBe(0);
    expect(out.confidence.percent).toBeLessThanOrEqual(50);
    expect(out.unknowns.join(" ")).toMatch(/not all that's withheld/);
    expect(out.lines.find((l) => l.key === "withheld")?.source).toBe("assumed");
  });

  it("with wages it can't see into, still counts the freelance tax, at low confidence", () => {
    const both = { ...WAGES(5_000_000), selfEmploymentCents: 2_000_000 };
    const out = workOutSetAside(asked(both, 0, { withholdingKnown: false, withheldFrom: "none" }));
    // The wages alone: $50,000 less $16,100 is $33,900: $1,240 + 12% of $21,500 = $3,820.
    expect(line(out.lines, "withheld")).toBe(382_000);
    expect(out.holdCents).toBe(843_027 - 382_000);
    expect(out.status).toBe("needed");
    expect(out.confidence.percent).toBeLessThanOrEqual(50);
    expectToAddUp(out.lines);
  });

  // Found on the sample retiree: "nothing is withheld" on a pension Jane can't see into.
  it.each([
    ["a pension", { retirementCents: 3_000_000 }],
    ["unemployment", { unemploymentCents: 3_000_000 }],
    ["Social Security", { socialSecurityBenefitsCents: 5_000_000, retirementCents: 3_000_000 }],
  ])("never reads %s with nothing seen withheld as $0 withheld", (_name, income) => {
    const out = workOutSetAside(asked(income));
    expect(out.withholdingKnown).toBe(false);
    expect(out.status).toBe("unknown");
    expect(out.notYetPaidCents).toBeNull();
    expect(out.holdCents).toBe(0);
    expect(out.confidence.percent).toBeLessThanOrEqual(50);
    expect(out.lines.find((l) => l.key === "withheld")?.source).toBe("assumed");
    expectToAddUp(out.lines);
  });

  it("with a pension, still counts the tax on freelance work beside it", () => {
    const out = workOutSetAside(
      asked({ retirementCents: 3_000_000, selfEmploymentCents: 2_000_000 }),
    );
    expect(out.status).toBe("needed");
    expect(out.holdCents).toBeGreaterThan(0);
    expect(out.confidence.percent).toBeLessThanOrEqual(50);
    expectToAddUp(out.lines);
  });

  it("their own withholding figure settles a pension", () => {
    const out = workOutSetAside(
      asked({ retirementCents: 3_000_000 }, 100_000, { withheldFrom: "told" }),
    );
    expect(out.withholdingKnown).toBe(true);
    expect(out.lines.find((l) => l.key === "withheld")?.source).toBe("told");
  });

  it.each([
    [2, 40],
    [5, 55],
    [8, 70],
    [12, 85],
  ])("%i months of income seen caps it at %i%%", (incomeMonths, percent) => {
    const out = workOutSetAside(asked({ selfEmploymentCents: 6_000_000 }, 0, { incomeMonths }));
    expect(out.confidence.percent).toBe(percent);
  });

  it("a part-year file lowers it and says so", () => {
    const out = workOutSetAside(
      asked({ selfEmploymentCents: 6_000_000 }, 0, { firstSeen: "2026-08-03" }),
    );
    expect(out.confidence.percent).toBeLessThanOrEqual(60);
    expect(out.unknowns.join(" ")).toMatch(/start on Aug 3, 2026/);
  });

  it("an unknown state isn't $0 of state tax", () => {
    const base = asked({ selfEmploymentCents: 6_000_000 });
    const input = { ...base.input, state: null };
    const out = workOutSetAside({ ...base, input, estimate: estimateTaxes(input) });
    expect(out.lines.find((l) => l.key === "state")?.cents).toBeNull();
    expect(out.confidence.percent).toBeLessThanOrEqual(65);
  });

  it("an assumed filing status and assumed profit are both said", () => {
    const out = workOutSetAside(
      asked({ selfEmploymentCents: 6_000_000 }, 0, {
        filingStatusKnown: false,
        profitAssumed: true,
      }),
    );
    expect(out.unknowns).toHaveLength(2);
    expect(out.confidence.percent).toBe(65);
  });
});

describe("when there's nothing to bring up", () => {
  it("no income is not a figure", () => {
    const out = workOutSetAside(asked({}));
    expect(out.status).toBe("no_income");
    expect(out.holdCents).toBe(0);
  });

  it("under the minimum is not held back", () => {
    const out = workOutSetAside(asked(WAGES(8_000_000), 870_000));
    expect(line(out.lines, "left")).toBe(7_000);
    expect(out.status).toBe("covered");
    expect(out.holdCents).toBe(0);
  });
});

describe("money already kept apart", () => {
  it("comes off what's held back, and a told figure counts", () => {
    const out = workOutSetAside(
      asked({ selfEmploymentCents: 6_000_000 }, 0, {
        keptApart: { seenCents: 300_000, seenIn: ["Tax savings"], toldCents: 100_000 },
      }),
    );
    expect(line(out.lines, "left")).toBe(1_203_720);
    expect(line(out.lines, "kept_apart")).toBe(400_000);
    expect(line(out.lines, "held")).toBe(803_720);
    expect(out.holdCents).toBe(803_720);
    expectToAddUp(out.lines);
  });

  it("more kept apart than the tax holds nothing back", () => {
    const out = workOutSetAside(
      asked(WAGES(8_000_000), 800_000, {
        keptApart: { seenCents: 900_000, seenIn: ["Tax savings"], toldCents: null },
      }),
    );
    expect(out.holdCents).toBe(0);
    expect(out.status).toBe("covered");
    expectToAddUp(out.lines);
  });
});

describe("the words, by who may read them", () => {
  it("is a fact for real accounts and a move only in demo advice", () => {
    expect(leftLabel(false)).toBe("Not yet withheld or paid");
    expect(leftLabel(true)).toBe("Left to set aside");
  });

  it("no line a real account reads tells it what to do, or says set aside", () => {
    const out = workOutSetAside(
      asked({ ...WAGES(5_000_000), selfEmploymentCents: 2_000_000 }, 400_000, {
        businessCostsCents: 80_000,
        businessCostsYearCents: 80_000,
        homeOfficeCents: 50_000,
        keptApart: { seenCents: 10_000, seenIn: ["Tax savings"], toldCents: null },
      }),
    );
    const text = [
      ...out.lines.flatMap((l) => [l.label, l.from]),
      ...out.unknowns,
      out.confidence.reason,
    ];
    for (const t of text) {
      expect(tellsThemToAct(t), t).toBe(false);
      expect(t, t).not.toMatch(/\bset(?:ting)? aside\b/i);
      expect(t, t).not.toMatch(/\b(?:you should|claim)\b/i);
    }
  });

  it("deductions are only ever what might apply", () => {
    const out = workOutSetAside(asked({ selfEmploymentCents: 6_000_000 }));
    expect(out.lines.find((l) => l.key === "qbi")?.from).toMatch(
      /might be able to deduct it; check with a tax professional/,
    );
  });

  it("the plain sentences pass the standard guardrail", () => {
    const check = checkGuardrails(
      "Your 2026 tax so far isn't all withheld yet: about $8,430.27, as an estimate.",
      [843_027],
    );
    expect(check).toEqual({ ok: true });
  });
});
