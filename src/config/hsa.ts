import { federalParams, ownLawYear } from "@/config/tax-params";

// The HSA as an investment (spec step 159). Limits are the year's own (Tax T32c: the tax-params
// table; IRS Rev. Proc. 2024-25 for 2025, 2025-19 for 2026, 2026-24 for 2027); the rest are Jane's
// own rules. A year without figures throws NoTaxParamsError.
const HSA_REV_PROC: Readonly<Record<number, string>> = {
  2025: "IRS Rev. Proc. 2024-25",
  2026: "IRS Rev. Proc. 2025-19",
  2027: "IRS Rev. Proc. 2026-24",
};

export function hsaLimits(year: number) {
  const l = federalParams(ownLawYear(year)).contributionLimits.value;
  return {
    year,
    selfCents: l.hsaSelf,
    familyCents: l.hsaFamily,
    catchUpCents: l.hsaCatchUp55,
    catchUpAge: 55,
    source: `${HSA_REV_PROC[year] ?? "IRS"} (${year} HSA limits)`,
  };
}

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
