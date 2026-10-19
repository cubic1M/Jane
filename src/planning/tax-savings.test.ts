import { describe, expect, it } from "vitest";
import { CONTRIBUTION_LIMITS, PAYROLL_TAX } from "@/config/tax-rates";
import { savingMessage } from "@/lib/jane-agent/tax-saving-message";
import { NO_INCOME, estimateTaxes, type EstimateInput } from "./tax-estimate";
import { findTaxSavings, type SavingsInput } from "./tax-savings";

// Spec step 122: every way to pay less, each estimated with the config rates by running the
// estimate again with the change.

const $ = (d: number) => Math.round(d * 100);
const input = (o: Partial<EstimateInput> = {}): EstimateInput => ({
  year: 2026,
  filingStatus: "single",
  childrenUnder17: 0,
  otherDependants: 0,
  state: "IL",
  income: { ...NO_INCOME, wagesCents: $(85_000), socialSecurityWagesCents: $(90_000) },
  studentLoanInterestCents: 0,
  mortgageInterestCents: 0,
  charityCents: 0,
  medicalCents: 0,
  otherStateLocalTaxCents: 0,
  federalWithheldCents: $(12_000),
  federalEstimatedPaidCents: 0,
  stateWithheldCents: $(4_000),
  stateEstimatedPaidCents: 0,
  ...o,
});
const savings = (i: EstimateInput, o: Partial<SavingsInput> = {}) =>
  findTaxSavings({
    year: 2026,
    today: "2026-10-18",
    input: i,
    estimate: estimateTaxes(i),
    pay: {
      hasPlan: false,
      projectedRetirementCents: 0,
      paychecksLeft: 4,
      grossPerPaycheckCents: $(3_950),
    },
    hasHsa: false,
    medicalCents: 0,
    childcareCents: 0,
    tuition: [],
    energyLastYear: [],
    ...o,
  });
const total = (i: EstimateInput) => {
  const e = estimateTaxes(i);
  return e.totalTaxCents + (e.state?.taxCents ?? 0);
};

describe("findTaxSavings", () => {
  it("401(k) room: the saving is the estimate run again with less taxable pay", () => {
    const i = input();
    const [s] = savings(i, {
      pay: {
        hasPlan: true,
        projectedRetirementCents: $(5_688),
        paychecksLeft: 4,
        grossPerPaycheckCents: $(3_950),
      },
    });
    expect(s.key).toBe("retirement");
    // Half of each of the last 4 paychecks, under the room.
    const extra = 4 * $(1_975);
    expect(s.estimateCents).toBe(
      total(i) - total({ ...i, income: { ...i.income, wagesCents: i.income.wagesCents - extra } }),
    );
    expect(s.title).toBe("Put about $1,975 more a paycheck into your 401(k)");
    expect(s.action).toMatchObject({ kind: "task", dueOn: "2026-10-25" });
  });

  it("no workplace plan: an IRA, as a goal by the filing deadline", () => {
    const [s] = savings(
      input({
        income: { ...NO_INCOME, wagesCents: $(60_000), socialSecurityWagesCents: $(60_000) },
      }),
    );
    expect(s).toMatchObject({
      key: "ira",
      action: {
        kind: "goal",
        name: "IRA for 2026",
        targetCents: CONTRIBUTION_LIMITS.ira,
        targetDate: "2027-04-01",
      },
    });
  });

  it("a health FSA counts payroll tax too", () => {
    const i = input();
    const s = savings(i, {
      pay: {
        hasPlan: true,
        projectedRetirementCents: $(24_500),
        paychecksLeft: 4,
        grossPerPaycheckCents: 1,
      },
      medicalCents: $(2_000),
    }).find((x) => x.key === "health_fsa")!;
    const income =
      total(i) -
      total({ ...i, income: { ...i.income, wagesCents: i.income.wagesCents - $(2_000) } });
    expect(s.estimateCents).toBe(
      income + Math.round($(2_000) * (PAYROLL_TAX.medicareRate + PAYROLL_TAX.socialSecurityRate)),
    );
    expect(s.action).toMatchObject({ kind: "task", dueOn: "2026-11-30" });
  });

  it("dependent care: the FSA or the credit, whichever is worth more", () => {
    const s = savings(input({ childrenUnder17: 1 }), { childcareCents: $(9_000) }).find(
      (x) => x.key === "dependent_care",
    )!;
    expect(s.title).toBe("Pay childcare through a dependent care FSA");
    expect(s.estimateCents).toBeGreaterThan(0);
  });

  it("itemizing, bunching gifts and student loan interest", () => {
    expect(
      savings(input({ mortgageInterestCents: $(14_000) })).find((x) => x.key === "itemize")
        ?.estimateCents,
    ).toBe(Math.round(($(14_000) + $(4_000) - $(16_100)) * 0.22));
    const bunch = savings(input({ mortgageInterestCents: $(8_000), charityCents: $(4_000) })).find(
      (x) => x.key === "bunch_gifts",
    );
    expect(bunch?.action).toMatchObject({ kind: "task", dueOn: "2026-12-15" });
    expect(
      savings(input({ studentLoanInterestCents: $(800) })).find((x) => x.key === "student_loan")
        ?.estimateCents,
    ).toBeGreaterThan(0);
  });

  it("tuition seen: the education credit; energy work last year: its credit, capped", () => {
    const all = savings(input(), {
      tuition: [{ payee: "STATE UNIVERSITY BURSAR", cents: $(6_000) }],
      energyLastYear: [
        { payee: "Bay Insulation", cents: $(8_000), uncapped: false },
        { payee: "Sunrun Solar", cents: $(20_000), uncapped: true },
      ],
    });
    // 20% of $6,000, halved: $85,000 is halfway through the $80,000–$90,000 phase-out.
    expect(all.find((x) => x.key === "education_credit")?.estimateCents).toBe($(600));
    const energy = all.filter((x) => x.key === "energy_credit").map((x) => x.estimateCents);
    expect(energy.sort((a, b) => a - b)).toEqual([$(1_200), $(6_000)]);
  });

  it("leaves out savings too small to matter, and lists the biggest first", () => {
    const all = savings(input({ studentLoanInterestCents: $(50) }));
    expect(all.find((x) => x.key === "student_loan")).toBeUndefined();
    const list = savings(input({ mortgageInterestCents: $(14_000) }), { medicalCents: $(3_000) });
    expect(list.map((s) => s.estimateCents)).toEqual(
      [...list.map((s) => s.estimateCents)].sort((a, b) => b - a),
    );
  });

  it("says each one as an estimate, with demo advice on", () => {
    const s = savings(input({ mortgageInterestCents: $(14_000) })).find(
      (x) => x.key === "itemize",
    )!;
    const m = savingMessage(s, 2026);
    expect(m.body).toMatch(/By my estimate that's about \$[\d,]+ less tax for 2026\.$/);
    expect(m.refs).toMatchObject({ advice: true, taxSaving: "itemize", taxYear: 2026 });
  });
});
