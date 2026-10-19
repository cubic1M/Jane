import {
  ESCROW_CHANGE_MIN_CENTS,
  MORTGAGE_EXTRA_SCENARIOS_CENTS,
  PMI_ASK_LTV,
  PMI_AUTO_LTV,
} from "@/config/debt";
import { formatCents } from "@/lib/money";
import { payoffPlan } from "./debt";

// The mortgage, watched (spec step 115): how much of the home's value the loan is (and
// whether PMI can come off), what extra principal each month would save, a refinance's
// break-even, and an escrow change in the payment. Pure; the payoff math is the debt
// planner's (./debt.ts).

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

// The loan as a share of the home's value; null without a value.
export const loanToValue = (balanceCents: number, homeValueCents: number | null) =>
  homeValueCents && homeValueCents > 0 ? balanceCents / homeValueCents : null;

export type PmiStatus =
  | { kind: "none" }
  // The bank doesn't say whether there's PMI, or there's no home value to compare with.
  | { kind: "unknown"; why: "no_value" | "not_reported" }
  | { kind: "not_yet"; ltv: number; balanceAtAskCents: number }
  | { kind: "can_ask"; ltv: number };

export function pmiStatus(
  hasPmi: boolean | null,
  balanceCents: number,
  homeValueCents: number | null,
): PmiStatus {
  if (hasPmi === false) return { kind: "none" };
  if (hasPmi === null) return { kind: "unknown", why: "not_reported" };
  const ltv = loanToValue(balanceCents, homeValueCents);
  if (ltv === null) return { kind: "unknown", why: "no_value" };
  return ltv < PMI_ASK_LTV
    ? { kind: "can_ask", ltv }
    : { kind: "not_yet", ltv, balanceAtAskCents: Math.floor(homeValueCents! * PMI_ASK_LTV) };
}

export const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

// The steps to take PMI off, with the rules as the CFPB explains them.
export const PMI_STEPS: readonly string[] = [
  "Check your PMI disclosure or annual statement from your servicer for the date you can ask and their rules for using today's value.",
  "Ask in writing (Jane drafts it for you). You'll need to be current on payments with a good history and have no second mortgage.",
  "Your servicer may ask for an appraisal to confirm the home's value.",
  `Even if you don't ask, PMI ends by itself when the balance reaches ${percent(PMI_AUTO_LTV)} of the original value.`,
];

// The letter Jane drafts for the person to send their servicer.
export function pmiLetter(input: {
  name: string;
  loanName: string;
  balanceCents: number;
  homeValueCents: number;
  ltv: number;
}): string {
  return [
    "To my mortgage servicer:",
    "",
    `I'm writing to ask you to cancel the private mortgage insurance on my loan (${input.loanName}). The principal balance is ${formatCents(input.balanceCents)}, which is ${percent(input.ltv)} of my home's current value of about ${formatCents(input.homeValueCents)}.`,
    "I'm current on my payments, and there is no second mortgage or other lien on the home. Please tell me what you need to process this, including whether you require an appraisal, and confirm in writing when PMI is removed from my payment.",
    "",
    "Thank you,",
    input.name || "[Your name]",
  ].join("\n");
}

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
