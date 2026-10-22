import type { PersonId } from "@/config/people";

// The sample people's workplace 401(k) plans (spec step 266), standing in for the plan's own
// records like the original demo bank's (demo-holdings.ts): pay before deductions, the match
// rules and the share of pay each person puts in. The demo bank reports their contributions
// from these, and the employer-plan stand-in (src/lib/investments/employer-plan.ts) gives the
// plan, so the brief, the retirement accounts page and the chat all work from the same figures.
// People without an employer 401(k) have none. Pay is grossed up from their payroll deposits.

export type SamplePlan = {
  payCents: number;
  matchRate: number;
  matchUpTo: number;
  employeeRate: number;
};

export const SAMPLE_EMPLOYER_PLANS: Readonly<Partial<Record<PersonId, SamplePlan>>> = {
  // Maya puts in 2%: half of the match goes unclaimed.
  renter: { payCents: 5_040_000, matchRate: 0.5, matchUpTo: 0.06, employeeRate: 0.02 },
  // The Reyes (the hospital job's plan) put in the 6% that gets all of it.
  family: { payCents: 9_360_000, matchRate: 0.5, matchUpTo: 0.06, employeeRate: 0.06 },
  // Priya puts in 10%, past the 4% her employer matches in full.
  equity: { payCents: 18_000_000, matchRate: 1, matchUpTo: 0.04, employeeRate: 0.1 },
  // Dan puts in 15% as retirement nears.
  preretire: { payCents: 10_080_000, matchRate: 0.5, matchUpTo: 0.06, employeeRate: 0.15 },
};

export const PLAN_PAYDAYS = 24;

// One payday's contribution from the person and the employer's match of it, in dollars.
export function paydayContribution(plan: SamplePlan): { employee: number; match: number } {
  const gross = plan.payCents / 100 / PLAN_PAYDAYS;
  const employee = Number((gross * plan.employeeRate).toFixed(2));
  const matched = Math.min(plan.employeeRate, plan.matchUpTo) * gross * plan.matchRate;
  return { employee, match: Number(matched.toFixed(2)) };
}
