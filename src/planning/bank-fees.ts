import { BANK_FEE_CATEGORIES, PROCESSOR_FEE_PAYEE } from "@/config/detection";

// Bank fees in a year, the one definition (the brief's suggestion, the Today card's fees and
// Jane's answer all use it): fees in the bank-fee categories over the last twelve months, not
// a payment processor's. With under twelve months of data the figure is scaled up to a year and
// said to be an estimate. Pure.

export type FeeTx = { date: string; amountCents: number; description: string; pfc: string | null };
export type BankFees = {
  // The fees seen, and a year's worth of them (equal with twelve months of data).
  seenCents: number;
  yearCents: number;
  count: number;
  monthsOfData: number;
  estimated: boolean;
};

export function bankFeesYear(
  transactions: readonly FeeTx[],
  monthsOfData: number,
): BankFees | null {
  const fees = transactions.filter(
    (t) =>
      t.amountCents > 0 &&
      BANK_FEE_CATEGORIES.includes(t.pfc as never) &&
      !PROCESSOR_FEE_PAYEE.test(t.description),
  );
  if (fees.length === 0) return null;
  const seenCents = fees.reduce((s, t) => s + t.amountCents, 0);
  const months = Math.min(12, Math.max(1, monthsOfData));
  return {
    seenCents,
    yearCents: Math.round(seenCents * (12 / months)),
    count: fees.length,
    monthsOfData: months,
    estimated: months < 12,
  };
}
