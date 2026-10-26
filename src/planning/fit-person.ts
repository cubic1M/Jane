import { FIT_CARD_PAYMENT_SHARE } from "@/config/fit";
import { liquidCents, monthlySpendCents } from "@/detectors/helpers";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { cashCushionCents } from "./emergency-fund";
import type { FitPerson } from "./fit";
import { DAY_MS } from "@/lib/dates";

// The person the fit engine (./fit.ts) works for, read from what the profile already holds:
// take-home pay, the debt payments seen in the last three months (and loans they co-signed),
// cash, and whether they are in debt trouble. The score is a pulled one when the caller has it. Pure.

const MONTHS = 3;

export function fitPersonFrom(input: ProfileInput, creditScore: number | null = null): FitPerson {
  const profile = buildProfile(input);
  const income = profile.facts.monthly_income.value;
  const since = new Date(Date.parse(`${input.today}T00:00:00Z`) - MONTHS * 31 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  // Debt service: loan payments seen, and a card's minimum, not the statement paid in full (a
  // card cleared each month is spending, not a debt payment a lender counts).
  const paid = input.transactions
    .filter(
      (t) =>
        (t.pfc ?? "").startsWith("LOAN_PAYMENTS_") &&
        t.pfc !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" &&
        t.amountCents > 0 &&
        t.date > since,
    )
    .reduce((s, t) => s + t.amountCents, 0);
  const cardMinimums = Math.round(
    input.accounts
      .filter((a) => a.type === "credit" && a.balanceCents > 0)
      .reduce((s, a) => s + a.balanceCents, 0) * FIT_CARD_PAYMENT_SHARE,
  );
  return {
    creditScore,
    incomeCents: typeof income === "number" && income > 0 ? income : null,
    // A loan co-signed for someone counts in full, as lenders count it (spec step 249).
    debtPaymentsCents:
      Math.round(paid / MONTHS) + cardMinimums + (input.familyCredit?.cosignedPaymentCents ?? 0),
    cashCents: liquidCents(input),
    spendCents: monthlySpendCents(input, profile.months),
    cushionCents: cashCushionCents({
      spendingCents: monthlySpendCents(input, profile.months),
      incomeCents: typeof income === "number" ? income : null,
      pattern:
        typeof profile.facts.income_pattern.value === "string"
          ? profile.facts.income_pattern.value
          : null,
      debtTrouble: profile.facts.debt_trouble.value === true,
    }),
    debtTrouble: profile.facts.debt_trouble.value === true,
  };
}
