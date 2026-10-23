import {
  EMERGENCY_FUND_GAP_MONTHS,
  EMERGENCY_FUND_MONTHS,
  EMERGENCY_FUND_MONTHS_UNEVEN,
  EMERGENCY_FUND_TARGET_MONTHS,
  EMERGENCY_STARTER_CENTS,
  EMERGENCY_STARTER_TARGET_MONTHS,
} from "@/config/proposals";

// How big an emergency fund to suggest for this person (spec step 263). Pure. Three months of
// spending is the usual; income that moves around needs more; someone in debt trouble needs a
// small starter buffer before the debt plan; a retiree on a pension needs the gap between
// spending and income, if there is one.

export type EmergencyTarget = {
  kind: "months" | "uneven" | "starter" | "gap";
  targetCents: number;
  // The months of spending (or of the gap) it is made of; null for a starter buffer.
  months: number | null;
  // Months from now to reach it.
  targetMonths: number;
  name: string;
};

export function emergencyTarget(input: {
  spendingCents: number;
  incomeCents: number | null;
  pattern: string | null;
  debtTrouble: boolean;
}): EmergencyTarget | null {
  if (input.spendingCents <= 0) return null;
  if (input.debtTrouble) {
    return {
      kind: "starter",
      targetCents: EMERGENCY_STARTER_CENTS,
      months: null,
      targetMonths: EMERGENCY_STARTER_TARGET_MONTHS,
      name: "Emergency starter buffer",
    };
  }
  if (input.pattern === "pension") {
    const gap = input.spendingCents - (input.incomeCents ?? 0);
    if (gap <= 0) return null;
    return {
      kind: "gap",
      targetCents: gap * EMERGENCY_FUND_GAP_MONTHS,
      months: EMERGENCY_FUND_GAP_MONTHS,
      targetMonths: EMERGENCY_FUND_TARGET_MONTHS,
      name: "Emergency fund",
    };
  }
  const uneven = input.pattern === "uneven" || input.pattern === "business";
  const months = uneven ? EMERGENCY_FUND_MONTHS_UNEVEN : EMERGENCY_FUND_MONTHS;
  return {
    kind: uneven ? "uneven" : "months",
    targetCents: input.spendingCents * months,
    months,
    targetMonths: EMERGENCY_FUND_TARGET_MONTHS,
    name: "Emergency fund",
  };
}

// The cash to keep back before paying a debt off from savings (loans QA): the emergency
// cushion the emergency-fund suggestion aims for, so paying off a card, a car loan or a student
// loan from cash never spends it. A month of spending when there's no target (a pension that
// covers spending).
export function cashCushionCents(input: Parameters<typeof emergencyTarget>[0]): number {
  return emergencyTarget(input)?.targetCents ?? Math.max(0, input.spendingCents);
}

// How a fund was sized, in words, for the drafted goal, the plan and the cash page:
// "6 months of your own average spending".
export function fundBasis(target: EmergencyTarget): string {
  if (target.kind === "starter") return "a starter buffer while paying off debt comes first";
  if (target.kind === "gap") {
    return `${target.months} months of the gap between your spending and your income`;
  }
  return `${target.months} months of your own average spending`;
}
