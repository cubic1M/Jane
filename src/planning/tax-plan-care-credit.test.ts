import { describe, expect, it } from "vitest";
import { taxPlan, type PlanFacts } from "./tax-plan";
import { findTaxSavings } from "./tax-savings";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";

// CodeRabbit sweep 1c, pl-09 #4: the child and dependent care credit is not an FSA sign-up.

const facts = (savings: PlanFacts["savings"]): PlanFacts => ({
  year: 2026,
  today: "2026-10-18",
  advice: true,
  savings,
  estimated: [],
  harvest: null,
  donationsCents: 0,
  lifeEvents: [],
  filed: false,
});

describe("fsa_enroll and the dependent care credit", () => {
  it("is not offered for the credit variant", () => {
    const moves = taxPlan(
      facts([
        {
          key: "dependent_care",
          title: "Claim the child and dependent care credit",
          estimateCents: 60_000,
          action: { kind: "link" },
        },
      ]),
    );
    expect(moves.some((m) => m.key === "fsa_enroll")).toBe(false);
  });

  it("is offered for the FSA variant", () => {
    const moves = taxPlan(
      facts([
        {
          key: "dependent_care",
          title: "Pay childcare through a dependent care FSA",
          estimateCents: 60_000,
          action: { kind: "task" },
        },
      ]),
    );
    expect(moves.find((m) => m.key === "fsa_enroll")?.detail).toContain("dependent care FSA");
  });

  it("works from what findTaxSavings returns for a low earner (the credit wins)", () => {
    const input: EstimateInput = {
      year: 2026,
      filingStatus: "single",
      childrenUnder17: 1,
      otherDependants: 0,
      state: "IL",
      income: { ...NO_INCOME, wagesCents: 1_800_000, socialSecurityWagesCents: 1_800_000 },
      studentLoanInterestCents: 0,
      mortgageInterestCents: 0,
      charityCents: 0,
      medicalCents: 0,
      otherStateLocalTaxCents: 0,
      federalWithheldCents: 100_000,
      federalEstimatedPaidCents: 0,
      stateWithheldCents: 0,
      stateEstimatedPaidCents: 0,
    };
    const found = findTaxSavings({
      year: 2026,
      today: "2026-10-18",
      input,
      estimate: estimateTaxes(input),
      pay: {
        hasPlan: false,
        projectedRetirementCents: 0,
        paychecksLeft: 4,
        grossPerPaycheckCents: 0,
      },
      hasHsa: false,
      medicalCents: 0,
      childcareCents: 600_000,
      tuition: [],
      energyLastYear: [],
    });
    const care = found.find((s) => s.key === "dependent_care");
    const moves = taxPlan(facts(found));
    expect(moves.some((m) => m.key === "fsa_enroll")).toBe(care?.action.kind === "task");
  });
});
