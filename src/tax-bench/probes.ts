import type { FilingStatus } from "@/config/tax";
import { federalParams } from "@/config/tax-params";
import { amt } from "@/planning/equity-tax";
import {
  estimateTaxes,
  incomeTax,
  selfEmploymentTax,
  type EstimateIncome,
  type EstimateInput,
} from "@/planning/tax-estimate";
import { inputOf } from "./serialize";

// Boundary probes (Tax T2): for every threshold the estimate reads, the figure one dollar before,
// at and one dollar after it, and the shape the law says it has there. The thresholds are read from
// the year's parameter file, so a changed figure moves its probe with it.

// What the figure does across the threshold, by its slope before (d1) and after (d2):
export type Kind =
  | "slope_up" // d2 > d1 (a bracket starts)
  | "slope_down" // d2 < d1 (a base is used up)
  | "flat_then_falls" // d1 = 0, d2 < 0 (a phase-out starts)
  | "rises_then_flat" // d1 > 0, d2 = 0 (a cap is reached)
  | "falls_then_flat" // d1 < 0, d2 = 0 (a floor is reached)
  | "falls_to_zero" // positive just before, zero just after and well after (a phase-out ends)
  | "step_up" // jumps up across it
  | "step_down"; // jumps down across it

export type Probe = Readonly<{
  param: string; // the path inside the group's value, as the completeness walk names it
  points: readonly [number, number, number]; // before, at, after (cents; ages for the age probes)
  f: (x: number) => number;
  kind: Kind;
}>;

export type GroupPlan =
  | Readonly<{ probes: readonly Probe[]; amounts?: readonly RegExp[]; amountsReason?: string }>
  // Not read by estimateTaxes: why, and the roadmap step that brings it in ("none" when none will).
  | Readonly<{ exempt: string; step: string }>;

const STATUSES = ["single", "married_joint", "married_separate", "head_of_household"] as const;
const around = (at: number, d = 100): [number, number, number] => [at - d, at, at + d];

export function judge(p: Probe): { ok: boolean; seen: string } {
  const [a, b, c] = p.points;
  const [fa, fb, fc] = [p.f(a), p.f(b), p.f(c)];
  const [d1, d2] = [fb - fa, fc - fb];
  const ok = {
    slope_up: d2 > d1,
    slope_down: d2 < d1,
    flat_then_falls: d1 === 0 && d2 < 0,
    rises_then_flat: d1 > 0 && d2 === 0,
    falls_then_flat: d1 < 0 && d2 === 0,
    falls_to_zero: fa > 0 && fc === 0 && p.f(c + 10 * (c - b)) === 0,
    step_up: fc - fa > 3 * (c - a),
    step_down: fa - fc > 3 * (c - a),
  }[p.kind];
  return { ok, seen: `${p.kind} at ${b}: f(${a})=${fa}, f(${b})=${fb}, f(${c})=${fc}` };
}

export function probePlan(year: number): Record<string, GroupPlan> {
  const p = federalParams(year);
  const std = p.standardDeduction.value;
  const est = (
    status: FilingStatus,
    income: Partial<EstimateIncome>,
    rest: Partial<EstimateInput> = {},
  ) => estimateTaxes(inputOf(year, status, income, rest));
  const wages =
    (status: FilingStatus, rest: Partial<EstimateInput> = {}) =>
    (x: number) =>
      est(status, { wagesCents: x }, rest);
  const each = <T>(make: (s: FilingStatus) => T[]) => STATUSES.flatMap(make);

  const eitc = p.eitc.value;
  const eitcOf = (status: FilingStatus, n: number) => (x: number) =>
    wages(status, { childrenUnder17: n, age: 30 })(x).credits.earnedIncomeCreditCents;
  const eitcProbes = ([0, 1, 2, 3] as const).flatMap((n) => {
    const max = eitc.maxCredit[n];
    return [
      {
        param: `maxCredit[${n}]`,
        points: around(Math.round(max / eitc.phaseInRate[n])),
        f: eitcOf("single", n),
        kind: "rises_then_flat" as const,
      },
      ...(["single", "married_joint"] as const).flatMap((s) => {
        const from = eitc.phaseOutFrom[s][n];
        return [
          {
            param: `phaseOutFrom.${s}[${n}]`,
            points: around(from),
            f: eitcOf(s, n),
            kind: "flat_then_falls" as const,
          },
          {
            param: `end.${s}[${n}]`,
            points: around(from + Math.round(max / eitc.phaseOutRate[n])),
            f: eitcOf(s, n),
            kind: "falls_to_zero" as const,
          },
        ];
      }),
    ];
  });
  const eitcAge = (age: number) =>
    est("single", { wagesCents: 900_000 }, { age }).credits.earnedIncomeCreditCents;

  const ctc = p.ctc.value;
  const actc = (status: FilingStatus) => (x: number) =>
    wages(status, { childrenUnder17: 1 })(x).credits.additionalChildTaxCreditCents;

  const se = p.selfEmployment.value;
  const qbi = p.qbi.value;
  const qbiProbe = (s: FilingStatus): Probe => {
    // Self-employment income fixed, wages move: after the standard deduction the income is wages + c0.
    const income = (w: number): Partial<EstimateIncome> => ({
      wagesCents: w,
      socialSecurityWagesCents: 0,
      selfEmploymentCents: 5_000_000,
    });
    const c0 = est(s, income(0)).agiCents - std[s];
    return {
      param: `threshold.${s}`,
      points: around(qbi.threshold[s]),
      f: (x) => est(s, income(x - c0)).qbiCents,
      kind: "step_down",
    };
  };

  const sli = p.studentLoanInterest.value;
  const sliOf = (s: FilingStatus) => (x: number) =>
    est(s, { wagesCents: x }, { studentLoanInterestCents: sli.max }).adjustments
      .studentLoanInterestCents;
  const salt = p.salt.value;
  const saltOf = (s: FilingStatus) => (x: number) =>
    est(s, { wagesCents: x }, { otherStateLocalTaxCents: 6_000_000 }).deduction.itemized
      .stateLocalTaxCents;
  const saltSeen = (s: FilingStatus) => (x: number) =>
    est(s, { wagesCents: 10_000_000 }, { otherStateLocalTaxCents: x }).deduction.itemized
      .stateLocalTaxCents;
  const saltKinds = [
    ["normal", "single"],
    ["marriedSeparate", "married_separate"],
  ] as const;

  const a = p.amt.value;
  const tentative = (s: FilingStatus) => (x: number) =>
    amt({
      status: s,
      taxableCents: x,
      addBackCents: 0,
      preferenceCents: 0,
      regularTaxCents: 0,
      year,
    }).tentativeCents;
  const charity = p.charity.value;

  return {
    brackets: {
      probes: each((s) =>
        p.brackets.value[s].flatMap((b, i) =>
          b.over === 0
            ? []
            : [
                {
                  param: `${s}[${i}].over`,
                  points: around(b.over),
                  f: (x: number) => wages(s)(x + std[s]).incomeTaxCents,
                  kind: "slope_up" as const,
                },
              ],
        ),
      ),
    },
    capitalGains: {
      probes: each((s) =>
        p.capitalGains.value[s].flatMap((b, i) =>
          b.over === 0
            ? []
            : [
                {
                  param: `${s}[${i}].over`,
                  points: around(b.over),
                  f: (x: number) => incomeTax(x, x, s, year),
                  kind: "slope_up" as const,
                },
              ],
        ),
      ),
    },
    standardDeduction: {
      probes: each((s) => [
        {
          param: s,
          points: around(std[s]),
          f: (x: number) => wages(s)(x).taxableCents,
          kind: "slope_up" as const,
        },
      ]),
    },
    additionalStandard: {
      exempt: "Not read by estimateTaxes: the 65-and-over and blind amounts are not added.",
      step: "T5",
    },
    capitalLoss: {
      probes: saltKinds.map(([key, s]) => ({
        param: key,
        points: around(p.capitalLoss.value[key]),
        f: (x: number) => -est(s, { shortTermGainsCents: -x }).agiCents,
        kind: "rises_then_flat" as const,
      })),
    },
    ctc: {
      probes: [
        ...each((s) => [
          {
            param: `phaseOutFrom.${s}`,
            points: around(ctc.phaseOutFrom[s]),
            f: (x: number) => {
              const e = wages(s, { childrenUnder17: 2 })(x).credits;
              return e.childTaxCreditCents + e.additionalChildTaxCreditCents;
            },
            kind: "flat_then_falls" as const,
          },
        ]),
        {
          param: "earnedIncomeFloor",
          points: around(ctc.earnedIncomeFloor),
          f: actc("single"),
          kind: "slope_up" as const,
        },
        {
          param: "refundablePerChild",
          points: around(
            ctc.earnedIncomeFloor + Math.round(ctc.refundablePerChild / ctc.refundableRate),
          ),
          f: actc("single"),
          kind: "rises_then_flat" as const,
        },
      ],
      amounts: [/^(perChild|otherDependant|phaseOutStep|phaseOutPerStep)$/],
      amountsReason:
        "Amounts, not thresholds: the cases joint-two-children, hoh-two-children-credits and other-dependant-credit check them.",
    },
    eitc: {
      probes: [
        ...eitcProbes,
        {
          param: "investmentIncomeLimit",
          points: around(eitc.investmentIncomeLimit),
          f: (x: number) =>
            est("single", { wagesCents: 1_500_000, interestCents: x }, { childrenUnder17: 1 })
              .credits.earnedIncomeCreditCents,
          kind: "step_down" as const,
        },
        {
          param: "childlessMinAge",
          points: [eitc.childlessMinAge - 1, eitc.childlessMinAge, eitc.childlessMinAge + 1],
          f: eitcAge,
          kind: "rises_then_flat" as const,
        },
        {
          param: "childlessMaxAge",
          points: [eitc.childlessMaxAge - 1, eitc.childlessMaxAge, eitc.childlessMaxAge + 1],
          f: eitcAge,
          kind: "flat_then_falls" as const,
        },
      ],
    },
    selfEmployment: {
      probes: [
        {
          param: "wageBase",
          points: around(Math.round(se.wageBase / se.netEarningsShare)),
          f: (x: number) => selfEmploymentTax(x, 0, year),
          kind: "slope_down" as const,
        },
        {
          param: "minimumNetEarnings",
          points: around(Math.round(se.minimumNetEarnings / se.netEarningsShare)),
          f: (x: number) => selfEmploymentTax(x, 0, year),
          kind: "step_up" as const,
        },
      ],
    },
    payroll: {
      exempt:
        "Rates only (employee FICA is withheld by the employer and is not a line of the estimate).",
      step: "none",
    },
    additionalMedicare: {
      probes: each((s) => [
        {
          param: `threshold.${s}`,
          points: around(p.additionalMedicare.value.threshold[s]),
          f: (x: number) => wages(s)(x).additionalMedicareCents,
          kind: "slope_up" as const,
        },
      ]),
    },
    netInvestmentIncomeTax: {
      probes: each((s) => [
        {
          param: `threshold.${s}`,
          points: around(p.netInvestmentIncomeTax.value.threshold[s]),
          f: (x: number) => est(s, { interestCents: x }).netInvestmentIncomeTaxCents,
          kind: "slope_up" as const,
        },
      ]),
    },
    qbi: { probes: each((s) => [qbiProbe(s)]) },
    obbba: {
      exempt: "Tips, overtime, car loan interest and the senior deduction are not in the estimate.",
      step: "T19",
    },
    savers: { exempt: "The saver's credit is not in the estimate.", step: "T15" },
    saversMatch: {
      exempt: "The saver's match (from 2027, proposed) is not in the estimate.",
      step: "T15",
    },
    rothCatchUp: {
      exempt: "Read by no estimate; the 2027 wage threshold is flagged WRONG TODAY in us-2026.ts.",
      step: "none",
    },
    studentLoanInterest: {
      probes: [
        {
          param: "max",
          points: around(sli.max),
          f: (x: number) =>
            est("single", { wagesCents: 5_000_000 }, { studentLoanInterestCents: x }).adjustments
              .studentLoanInterestCents,
          kind: "rises_then_flat" as const,
        },
        ...(["single", "married_joint", "head_of_household"] as const).flatMap((s) => [
          {
            param: `phaseOut.${s}[0]`,
            points: around(sli.phaseOut[s]![0]),
            f: sliOf(s),
            kind: "flat_then_falls" as const,
          },
          {
            param: `phaseOut.${s}[1]`,
            points: around(sli.phaseOut[s]![1]),
            f: sliOf(s),
            kind: "falls_to_zero" as const,
          },
        ]),
      ],
    },
    salt: {
      probes: saltKinds.flatMap(([key, s]) => [
        {
          param: `cap.${key}`,
          points: around(salt.cap[key]),
          f: saltSeen(s),
          kind: "rises_then_flat" as const,
        },
        {
          param: `phaseDownFrom.${key}`,
          points: around(salt.phaseDownFrom[key]),
          f: saltOf(s),
          kind: "flat_then_falls" as const,
        },
        {
          param: `floor.${key}`,
          points: around(
            salt.phaseDownFrom[key] +
              Math.round((salt.cap[key] - salt.floor[key]) / salt.phaseDownRate),
          ),
          f: saltOf(s),
          kind: "falls_then_flat" as const,
        },
      ]),
    },
    charity: {
      probes: [
        {
          param: "floorShare",
          points: around(Math.round(10_000_000 * charity.floorShare)),
          f: (x: number) =>
            est("single", { wagesCents: 10_000_000 }, { charityCents: x }).deduction.itemized
              .charityCents,
          kind: "slope_up" as const,
        },
        {
          param: "nonItemizer.normal",
          points: around(charity.nonItemizer.normal),
          f: (x: number) =>
            est("single", { wagesCents: 5_000_000 }, { charityCents: x }).deduction
              .nonItemizerCharityCents,
          kind: "rises_then_flat" as const,
        },
        {
          param: "nonItemizer.marriedJoint",
          points: around(charity.nonItemizer.marriedJoint),
          f: (x: number) =>
            est("married_joint", { wagesCents: 5_000_000 }, { charityCents: x }).deduction
              .nonItemizerCharityCents,
          kind: "rises_then_flat" as const,
        },
      ],
    },
    medical: {
      probes: [
        {
          param: "floorShare",
          points: around(Math.round(10_000_000 * p.medical.value.floorShare)),
          f: (x: number) =>
            est("single", { wagesCents: 10_000_000 }, { medicalCents: x }).deduction.itemized
              .medicalCents,
          kind: "slope_up" as const,
        },
      ],
    },
    contributionLimits: {
      exempt:
        "Read by the savings and retirement planners, not by estimateTaxes; their tests check them.",
      step: "none",
    },
    dependentCare: {
      exempt: "The child and dependent care credit is not in the estimate.",
      step: "T17",
    },
    education: { exempt: "The education credits are not in the estimate.", step: "T14" },
    energy: {
      exempt:
        "Tax year 2025 figures kept on the 2026 record until T3 moves them; no estimate reads them.",
      step: "T3",
    },
    amt: {
      probes: each((s) => [
        {
          param: `exemption.${s}`,
          points: around(a.exemption[s]),
          f: tentative(s),
          kind: "slope_up" as const,
        },
        {
          param: `phaseOutStart.${s}`,
          points: around(a.phaseOutStart[s]),
          f: tentative(s),
          kind: "slope_up" as const,
        },
        {
          param: `highRateFrom.${s}`,
          points: around(a.highRateFrom[s] + a.exemption[s]),
          f: tentative(s),
          kind: "slope_up" as const,
        },
      ]),
    },
    mileage: {
      exempt: "Read by the self-employed planner, not by estimateTaxes; its tests check it.",
      step: "none",
    },
    homeOffice: {
      exempt: "Read by the self-employed planner, not by estimateTaxes; its tests check it.",
      step: "none",
    },
  };
}
