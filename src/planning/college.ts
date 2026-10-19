import {
  COLLEGE_COST_GROWTH,
  COLLEGE_COST_PER_YEAR_CENTS,
  COLLEGE_RETURN,
  COLLEGE_START_AGE,
  COLLEGE_YEARS,
  PLANS_529,
  STATE_529,
  STATE_RATE_DEFAULT_INCOME_CENTS,
  type CollegeType,
  type Plan529,
} from "@/config/college";
import type { FilingStatus } from "@/config/tax";
import { STATE_TAX } from "@/config/tax-rates";
import { marginalRateOf } from "./tax-estimate";

// College savings (spec step 158, demo advice). Pure. What four years will cost when the
// child starts, as a range (prices growing slower or faster), what to put aside a month to
// get there (returns lower or higher), and which 529 plan comes out ahead once fees and the
// state's tax break (from the tax profile's state) are counted. Ranges, never promises.

export type Range = { lowCents: number; highCents: number };

export const yearsUntilCollege = (childAge: number) => Math.max(0, COLLEGE_START_AGE - childAge);

// Four years of college starting `years` from now, at a yearly growth rate.
export function collegeCost(type: CollegeType, years: number, growth: number): number {
  const today = COLLEGE_COST_PER_YEAR_CENTS[type];
  let total = 0;
  for (let k = 0; k < COLLEGE_YEARS; k += 1) total += today * (1 + growth) ** (years + k);
  return Math.round(total);
}

export function costRange(type: CollegeType, childAge: number): Range {
  const years = yearsUntilCollege(childAge);
  return {
    lowCents: collegeCost(type, years, COLLEGE_COST_GROWTH.low),
    highCents: collegeCost(type, years, COLLEGE_COST_GROWTH.high),
  };
}

// The monthly amount that grows to `target` in `months` at a yearly return.
export function monthlyToReach(target: number, months: number, yearly: number): number {
  if (months <= 0) return target;
  const r = (1 + yearly) ** (1 / 12) - 1;
  if (r === 0) return Math.ceil(target / months);
  return Math.ceil((target * r) / ((1 + r) ** months - 1));
}

// From the lowest (cheaper college, better returns) to the highest (dearer, weaker).
export function monthlyRange(type: CollegeType, childAge: number, savedCents = 0): Range {
  const cost = costRange(type, childAge);
  const months = yearsUntilCollege(childAge) * 12;
  const grownSaved = (yearly: number) => savedCents * (1 + yearly) ** (months / 12);
  return {
    lowCents: monthlyToReach(
      Math.max(0, cost.lowCents - grownSaved(COLLEGE_RETURN.high)),
      months,
      COLLEGE_RETURN.high,
    ),
    highCents: monthlyToReach(
      Math.max(0, cost.highCents - grownSaved(COLLEGE_RETURN.low)),
      months,
      COLLEGE_RETURN.low,
    ),
  };
}

// The state's tax rate on the next dollar, for the 529 deduction.
export function stateRate(
  state: string | null,
  filing: FilingStatus | null,
  incomeCents = STATE_RATE_DEFAULT_INCOME_CENTS,
): number {
  const tax = state ? STATE_TAX[state] : undefined;
  if (!tax || tax.kind === "none") return 0;
  if (tax.kind === "flat" || tax.kind === "approximate") return tax.rate;
  return marginalRateOf(incomeCents, tax.brackets[filing ?? "single"]);
}

// What a year's contributions save in state tax with this plan.
export function stateBenefit(
  plan: Plan529,
  state: string | null,
  filing: FilingStatus | null,
  yearlyCents: number,
): number {
  const rule = state ? STATE_529[state] : undefined;
  if (!rule || (!plan.homeState && !rule.anyPlan)) return 0;
  if (rule.creditRate !== undefined) {
    return Math.min(Math.round(yearlyCents * rule.creditRate), rule.creditCapCents ?? Infinity);
  }
  const cap =
    filing === "married_joint"
      ? (rule.jointDeductionCents ?? rule.deductionCents ?? 0)
      : (rule.deductionCents ?? 0);
  return Math.round(Math.min(yearlyCents, cap) * stateRate(state, filing));
}

export type PlanComparison = {
  plan: Plan529;
  // A year, on the balance halfway to the goal (an average over the years).
  feeCents: number;
  benefitCents: number;
  netCents: number;
};

// Best first: the state's break minus the fees, a year.
export function comparePlans(
  state: string | null,
  filing: FilingStatus | null,
  yearlyCents: number,
  targetCents: number,
): PlanComparison[] {
  return PLANS_529.map((plan) => {
    const feeCents = Math.round(((targetCents / 2) * plan.feeBps) / 10_000);
    const benefitCents = stateBenefit(plan, state, filing, yearlyCents);
    return { plan, feeCents, benefitCents, netCents: benefitCents - feeCents };
  }).sort((a, b) => b.netCents - a.netCents || a.plan.feeBps - b.plan.feeBps);
}

// The goal it becomes: the middle of the cost range, by the start of the first year.
export function collegeGoal(childName: string, type: CollegeType, childAge: number, asOf: string) {
  const cost = costRange(type, childAge);
  const startYear = Number(asOf.slice(0, 4)) + Math.max(1, yearsUntilCollege(childAge));
  return {
    name: `College for ${childName}`,
    targetCents: Math.round((cost.lowCents + cost.highCents) / 2),
    targetDate: `${startYear}-09-01`,
  };
}
