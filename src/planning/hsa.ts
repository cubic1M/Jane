import { HSA_CASH_CUSHION_CENTS, HSA_LIMITS, HSA_MIN_INVEST_CENTS } from "@/config/hsa";

// The HSA as an investment (spec step 159, demo advice). Pure. What it holds in cash and
// invested, how much of the cash is beyond the cushion for this year's health costs (and so
// worth investing), and how much more can go in this year under the limit.

export type HsaInput = {
  balanceCents: number;
  cashCents: number;
  // Paid in over the last 12 months.
  contributedCents: number;
  coverage: "self" | "family";
  age: number | null;
};

export type HsaPlan = {
  investedCents: number;
  cashCents: number;
  cushionCents: number;
  // Cash beyond the cushion, when it's worth an order.
  toInvestCents: number;
  limitCents: number;
  roomCents: number;
  // The room spread over the paychecks left (24 a year).
  perPaycheckCents: number;
};

export function hsaLimit(coverage: "self" | "family", age: number | null): number {
  const base = coverage === "family" ? HSA_LIMITS.familyCents : HSA_LIMITS.selfCents;
  return base + (age !== null && age >= HSA_LIMITS.catchUpAge ? HSA_LIMITS.catchUpCents : 0);
}

export function hsaPlan(input: HsaInput, paychecksLeft = 24): HsaPlan {
  const extra = input.cashCents - HSA_CASH_CUSHION_CENTS;
  const limitCents = hsaLimit(input.coverage, input.age);
  const roomCents = Math.max(0, limitCents - input.contributedCents);
  return {
    investedCents: input.balanceCents - input.cashCents,
    cashCents: input.cashCents,
    cushionCents: HSA_CASH_CUSHION_CENTS,
    toInvestCents: extra >= HSA_MIN_INVEST_CENTS ? extra : 0,
    limitCents,
    roomCents,
    perPaycheckCents: paychecksLeft > 0 ? Math.ceil(roomCents / paychecksLeft) : roomCents,
  };
}
