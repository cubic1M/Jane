import type { FilingStatus } from "@/config/tax";
import { OBBBA_DEDUCTIONS as O, ROTH_CATCH_UP } from "@/config/tax-rates";

// The 2025-2028 deductions for tips, overtime, car-loan interest and people 65 or older
// (src/config/tax-rates.ts OBBBA_DEDUCTIONS), worked out by code with the rule each comes from, so
// Claude only ever explains a figure the code made (connectors roadmap round 16). FOR REVIEW like
// the figures: how a part-$1,000 over the line is counted is read as whole thousands only. Pure.

export type Deduction = { cents: number; rule: string; why: string };

type Kind = "tips" | "overtime" | "carLoanInterest";

const joint = (status: FilingStatus) => status === "married_joint";
const inYears = (year: number) => year >= O.firstYear && year <= O.lastYear;

// Tips, overtime or car-loan interest: what can be deducted of `claimedCents`.
export function obbbaDeduction(
  kind: Kind,
  input: { claimedCents: number; magiCents: number; status: FilingStatus; taxYear: number },
): Deduction {
  const rule = O[kind];
  const none = (why: string): Deduction => ({ cents: 0, rule: rule.rule, why });
  if (!inYears(input.taxYear)) return none(`only for ${O.firstYear} to ${O.lastYear}`);
  if (rule.joint && input.status === "married_separate") return none("needs a joint return");
  const max = joint(input.status) ? rule.max.marriedJoint : rule.max.normal;
  const from = joint(input.status) ? rule.phaseOutFrom.marriedJoint : rule.phaseOutFrom.normal;
  const steps = Math.floor(Math.max(0, input.magiCents - from) / O.step);
  const cap = Math.max(0, max - steps * rule.cutPerStep);
  const cents = Math.min(Math.max(0, input.claimedCents), cap);
  return {
    cents,
    rule: rule.rule,
    why: steps > 0 ? "cut for income over the line" : "in full, up to the cap",
  };
}

// The senior deduction: for each person on the return who's 65 or older by the year's end.
export function seniorDeduction(input: {
  peopleAge65: number;
  magiCents: number;
  status: FilingStatus;
  taxYear: number;
}): Deduction {
  const rule = O.senior.rule;
  if (!inYears(input.taxYear))
    return { cents: 0, rule, why: `only for ${O.firstYear} to ${O.lastYear}` };
  if (input.status === "married_separate") return { cents: 0, rule, why: "needs a joint return" };
  const people = Math.min(Math.max(0, Math.floor(input.peopleAge65)), joint(input.status) ? 2 : 1);
  const from = joint(input.status)
    ? O.senior.phaseOutFrom.marriedJoint
    : O.senior.phaseOutFrom.normal;
  const cut = Math.round(Math.max(0, input.magiCents - from) * O.senior.phaseOutRate);
  const each = Math.max(0, O.senior.perPerson - cut);
  return { cents: each * people, rule, why: cut > 0 ? "cut for income over the line" : "in full" };
}

// Whether this year's catch-up contributions must go to Roth.
export function catchUpMustBeRoth(input: {
  priorYearFicaWagesCents: number;
  taxYear: number;
}): boolean {
  return (
    input.taxYear >= ROTH_CATCH_UP.requiredFrom &&
    input.priorYearFicaWagesCents > ROTH_CATCH_UP.priorYearFicaWagesOver
  );
}
