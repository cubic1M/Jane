import { HEALTH_DEFAULT_SPEND_CENTS, OPEN_ENROLLMENT } from "@/config/insurance";
import type { Coverage } from "./coverage";
import type { Household } from "./household";

// Health plans by what they'd cost in a year (spec step 149): the premium plus what the
// person would likely pay for care under the plan. Pure.

// What someone usually spends on care in a year: their own medical spending, or a typical
// amount when the accounts don't say.
export const expectedSpend = (household: Pick<Household, "signals">) =>
  household.signals.medicalCents ?? HEALTH_DEFAULT_SPEND_CENTS;

// What they'd pay themselves for `spendCents` of care: everything up to the deductible, then
// their share, never more than the plan's yearly most. Null when the plan's terms aren't known.
export function expectedOutOfPocket(
  plan: { deductibleCents: number | null; coverage: Coverage },
  spendCents: number,
): number | null {
  const share = plan.coverage.coinsurance;
  const most = plan.coverage.outOfPocketMax;
  if (plan.deductibleCents === null || typeof share !== "number") return null;
  const paid =
    Math.min(spendCents, plan.deductibleCents) +
    Math.round((Math.max(0, spendCents - plan.deductibleCents) * share) / 100);
  return typeof most === "number" ? Math.min(paid, most) : paid;
}

// A year's premium plus expected out of pocket, or null when either isn't known.
export function expectedYearlyCost(
  plan: { deductibleCents: number | null; coverage: Coverage },
  annualPremiumCents: number | null,
  spendCents: number,
): number | null {
  const oop = expectedOutOfPocket(plan, spendCents);
  return annualPremiumCents === null || oop === null ? null : annualPremiumCents + oop;
}

// The next marketplace open enrollment on or after asOf (YYYY-MM-DD): when it opens (if
// still ahead) and its last day, for the plan year it's for.
export function openEnrollmentDates(
  asOf: string,
): { date: string; what: "start" | "end"; year: number }[] {
  const year = Number(asOf.slice(0, 4));
  const endYear = asOf <= `${year}-${OPEN_ENROLLMENT.end}` ? year : year + 1;
  const start = `${endYear - 1}-${OPEN_ENROLLMENT.start}`;
  const end = `${endYear}-${OPEN_ENROLLMENT.end}`;
  return [
    ...(start >= asOf ? [{ date: start, what: "start" as const, year: endYear }] : []),
    { date: end, what: "end" as const, year: endYear },
  ];
}
