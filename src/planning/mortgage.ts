import { ESCROW_CHANGE_MIN_CENTS, MORTGAGE_EXTRA_SCENARIOS_CENTS } from "@/config/debt";
import { payoffPlan } from "./debt";

// The mortgage, watched (spec step 115): what extra principal each month would save, a
// refinance's break-even, and an escrow change in the payment. Pure; the payoff math is the
// debt planner's (./debt.ts). PMI is ./home-equity.ts's, against the home's original value.

// Months until a refinance's monthly saving has paid back its closing costs. Null when it
// saves nothing a month (it never pays back).
export function breakEvenMonths(
  closingCostsCents: number,
  monthlySavingCents: number,
): number | null {
  if (monthlySavingCents <= 0) return null;
  if (closingCostsCents <= 0) return 0;
  return Math.ceil(closingCostsCents / monthlySavingCents);
}

export const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

export type ExtraScenario = {
  extraCents: number;
  monthsSaved: number;
  interestSavedCents: number;
};

// Paying extra principal each month: the months and interest saved against the payment now.
export function extraPrincipal(
  balanceCents: number,
  aprBps: number,
  paymentCents: number,
  extras: readonly number[] = MORTGAGE_EXTRA_SCENARIOS_CENTS,
): { baseMonths: number; baseInterestCents: number; scenarios: ExtraScenario[] } | null {
  const plan = (payment: number) =>
    payoffPlan(
      [{ id: "m", name: "m", balanceCents, aprBps, minimumCents: payment }],
      payment,
      "avalanche",
    );
  const base = plan(paymentCents);
  if (!base.ok) return null;
  return {
    baseMonths: base.months,
    baseInterestCents: base.totalInterestCents,
    scenarios: extras.flatMap((extraCents) => {
      const p = plan(paymentCents + extraCents);
      return p.ok
        ? [
            {
              extraCents,
              monthsSaved: base.months - p.months,
              interestSavedCents: base.totalInterestCents - p.totalInterestCents,
            },
          ]
        : [];
    }),
  };
}

export type EscrowChange = { fromCents: number; toCents: number; changeCents: number; on: string };

// The latest mortgage payment against the ones before it: a move of at least
// ESCROW_CHANGE_MIN_CENTS on a fixed-rate loan is escrow (taxes or insurance). Payments are
// [date YYYY-MM-DD, cents].
export function escrowChange(
  payments: readonly { date: string; cents: number }[],
): EscrowChange | null {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const last = sorted.at(-1)!;
  const before = sorted
    .slice(-4, -1)
    .map((p) => p.cents)
    .sort((a, b) => a - b);
  const usual = before[Math.floor(before.length / 2)];
  const changeCents = last.cents - usual;
  return Math.abs(changeCents) >= ESCROW_CHANGE_MIN_CENTS
    ? { fromCents: usual, toCents: last.cents, changeCents, on: last.date }
    : null;
}
