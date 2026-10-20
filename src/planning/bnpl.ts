import {
  INSTALLMENT_MATCH_CENTS,
  INSTALLMENT_MATCH_DAYS,
  NEW_PLAN_EVERY_DAYS,
  NEW_PLAN_INSTALLMENTS,
} from "@/config/bnpl";
import { LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";

// Buy now, pay later under control (spec step 176). Pure: each plan's next installments
// from its own schedule, which of them the forecast already counts, and what a new plan
// would do to the checking forecast.

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const addDays = (day: string, days: number) =>
  new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
const addMonths = (day: string, months: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

export type PlanSchedule = {
  key: string;
  name: string;
  paymentCents: number;
  every: "month" | "two_weeks";
  nextDue: string | null;
  // Known for a Pay in 4 plan (its payments are fixed); otherwise null.
  balanceCents: number | null;
};

export type Installment = { date: string; planKey: string; name: string; cents: number };

// The installments from `asOf` to `until`, from each plan's schedule: a Pay in 4 plan's
// remaining payments (its balance over its payment), a monthly plan's every month.
export function installments(plans: readonly PlanSchedule[], asOf: string, until: string) {
  const out: Installment[] = [];
  for (const p of plans) {
    if (!p.nextDue || p.paymentCents <= 0) continue;
    const left =
      p.every === "two_weeks" && p.balanceCents !== null
        ? Math.ceil(p.balanceCents / p.paymentCents)
        : Infinity;
    for (let i = 0; i < Math.min(left, 12); i += 1) {
      const date = p.every === "two_weeks" ? addDays(p.nextDue, 14 * i) : addMonths(p.nextDue, i);
      if (date > until) break;
      if (date >= asOf) out.push({ date, planKey: p.key, name: p.name, cents: p.paymentCents });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.planKey.localeCompare(b.planKey));
}

// The installments the forecast's bills don't already include.
export function notInForecast(
  list: readonly Installment[],
  forecastBills: readonly { date: string; amountCents: number }[],
): Installment[] {
  const used = new Set<number>();
  return list.filter((inst) => {
    const at = forecastBills.findIndex(
      (b, i) =>
        !used.has(i) &&
        Math.abs(b.amountCents - inst.cents) <= INSTALLMENT_MATCH_CENTS &&
        Math.abs(dayNumber(b.date) - dayNumber(inst.date)) <= INSTALLMENT_MATCH_DAYS,
    );
    if (at >= 0) used.add(at);
    return at < 0;
  });
}

export type Strain = {
  strained: boolean;
  // Checking's lowest balance in the window with and without the new plan.
  lowestWithout: { date: string; balanceCents: number };
  lowestWith: { date: string; balanceCents: number };
  // How far under the cushion it goes with the plan; 0 when it doesn't.
  shortCents: number;
  installments: Installment[];
};

// A new plan's installments taken off the checking forecast's day-by-day balances.
export function newPlanStrain(
  days: readonly { date: string; balanceCents: number }[],
  plan: { totalCents: number; installments: number; everyDays: number; firstDate: string },
): Strain | null {
  if (days.length === 0 || plan.totalCents <= 0) return null;
  const each = Math.ceil(plan.totalCents / plan.installments);
  const list: Installment[] = Array.from({ length: plan.installments }, (_, i) => ({
    date: addDays(plan.firstDate, plan.everyDays * i),
    planKey: "new",
    name: "New plan",
    cents: each,
  }));
  const lowest = (series: { date: string; balanceCents: number }[]) =>
    series.reduce((low, d) => (d.balanceCents < low.balanceCents ? d : low));
  const withPlan = days.map((d) => ({
    date: d.date,
    balanceCents:
      d.balanceCents - list.filter((inst) => inst.date <= d.date).reduce((s, i) => s + i.cents, 0),
  }));
  const without = lowest([...days]);
  const withIt = lowest(withPlan);
  const short = Math.max(0, LOW_BALANCE_CUSHION_CENTS - withIt.balanceCents);
  return {
    strained:
      withIt.balanceCents < LOW_BALANCE_CUSHION_CENTS && withIt.balanceCents < without.balanceCents,
    lowestWithout: without,
    lowestWith: withIt,
    shortCents: short,
    installments: list,
  };
}

// A new Pay in 4 plan of `totalCents` against the checking forecast's days, the first
// payment today.
export function warnNewPlan(
  data: { forecastDays: readonly { date: string; balanceCents: number }[]; asOf: string },
  totalCents: number,
): Strain | null {
  return newPlanStrain(data.forecastDays, {
    totalCents,
    installments: NEW_PLAN_INSTALLMENTS,
    everyDays: NEW_PLAN_EVERY_DAYS,
    firstDate: data.asOf,
  });
}

// Whether paying a plan off now is free: a Pay in 4 plan charges no interest or fee, so
// paying early costs nothing and clears the installments. Other plans' early-payoff terms
// aren't known, so they're never called free.
export function freePayoff(plan: {
  every: "month" | "two_weeks";
  balanceCents: number | null;
  aprBps: number | null;
}): boolean {
  return (
    plan.every === "two_weeks" &&
    plan.balanceCents !== null &&
    plan.balanceCents > 0 &&
    (plan.aprBps ?? 0) === 0
  );
}
