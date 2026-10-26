import { WITHDRAWAL_RATE } from "@/config/retirement";
import { formatCents } from "@/lib/money";
import type { Range, RetirementPlan } from "@/planning/retirement";

// Jane's words about retirement (spec step 132), shared by its message, its rule answer
// and its tool. Pure. Always a range, never a promise.

export const range = (r: Range) => `${formatCents(r.lowCents)} to ${formatCents(r.highCents)}`;

export function projectionLine(plan: RetirementPlan): string {
  // Past the age the projection runs to: nothing left to project, the money is there to draw.
  if (plan.years === 0)
    return `You're at or past ${plan.retirementAge}: your retirement accounts hold ${formatCents(plan.projection.lowCents)}, about ${formatCents(plan.yearlyIncome.lowCents)} a year if you draw a steady ${Math.round(WITHDRAWAL_RATE * 100)}%, and your retirement income page turns that into a monthly paycheck.`;
  const by = `By ${plan.retirementAge} your retirement accounts could be about ${range(plan.projection)} in today's dollars, depending on returns`;
  if (plan.targetCents === null) return `${by}.`;
  const target = formatCents(plan.targetCents);
  switch (plan.status) {
    case "on_track":
      return `${by}: on track for the target of ${target}, even at the low end.`;
    case "maybe":
      return `${by}: the target of ${target} is only in reach if returns are good.`;
    default:
      return `${by}, short of the target of ${target}.`;
  }
}

export function matchLine(plan: RetirementPlan): string | null {
  const m = plan.match;
  if (!m) return null;
  return m.captured
    ? "You get all of your employer's 401(k) match."
    : `You're leaving about ${formatCents(m.missedCents)} a year of your employer's match on the table: you put in ${Math.round(m.employeeRate * 1000) / 10}% of your pay, and they match up to ${Math.round(m.fullMatchRate * 1000) / 10}%.`;
}
