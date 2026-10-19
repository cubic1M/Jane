import { CONTRIBUTION_LIMITS, TAX_RATES_YEAR } from "@/config/tax-rates";

// The HSA as an investment (spec step 159). Limits are the taxes lane's (IRS Rev. Proc.
// 2025-19 for 2026, in src/config/tax-rates.ts); the rest are Jane's own rules.

export const HSA_LIMITS = {
  year: TAX_RATES_YEAR,
  selfCents: CONTRIBUTION_LIMITS.hsaSelf,
  familyCents: CONTRIBUTION_LIMITS.hsaFamily,
  catchUpCents: CONTRIBUTION_LIMITS.hsaCatchUp55,
  catchUpAge: 55,
  source: "IRS Rev. Proc. 2025-19 (2026 HSA limits)",
} as const;

// Cash kept in the HSA for this year's health costs before the rest is invested: about a
// typical deductible.
export const HSA_CASH_CUSHION_CENTS = 200_000;
// Less than this isn't worth an order.
export const HSA_MIN_INVEST_CENTS = 10_000;
// The fund HSA money beyond the cushion goes into (a stand-in, like CORE_FUNDS).
export const HSA_FUND = "KTSIX";
// Transactions in these Plaid categories go to the receipts vault.
export const HSA_RECEIPT_PRIMARY = "MEDICAL";
// Veterinary bills aren't qualified medical expenses.
export const HSA_NOT_QUALIFIED: readonly string[] = ["MEDICAL_VETERINARY_SERVICES"];
// How far back Jane looks for medical charges.
export const HSA_RECEIPT_LOOKBACK_DAYS = 365;
