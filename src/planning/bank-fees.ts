import { BANK_FEE_CATEGORIES, FEE_REVERSAL_DAYS, PROCESSOR_FEE_PAYEE } from "@/config/detection";

// Bank fees in a year, the one definition (the brief's suggestion, the Today card's fees and
// Jane's answer all use it): fees in the bank-fee categories over the last twelve months, not
// a payment processor's. With under twelve months of data the figure is scaled up to a year and
// said to be an estimate. A fee the bank gave back (the same amount, in the same category,
// within FEE_REVERSAL_DAYS) doesn't count; other fee refunds come off the total. Pure.

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
  const inFees = transactions.filter(
    (t) => BANK_FEE_CATEGORIES.includes(t.pfc as never) && !PROCESSOR_FEE_PAYEE.test(t.description),
  );
  const refunds = inFees.filter((t) => t.amountCents < 0);
  const used = new Set<FeeTx>();
  const reversed = (fee: FeeTx) => {
    const back = refunds.find(
      (r) =>
        !used.has(r) &&
        r.amountCents === -fee.amountCents &&
        r.pfc === fee.pfc &&
        daysApart(fee.date, r.date) <= FEE_REVERSAL_DAYS,
    );
    if (back) used.add(back);
    return Boolean(back);
  };
  const fees = inFees.filter((t) => t.amountCents > 0).filter((fee) => !reversed(fee));
  if (fees.length === 0) return null;
  // Other refunds of fees (part of one, or one we can't pair) still come off.
  const otherRefunds = refunds.filter((r) => !used.has(r)).reduce((s, r) => s - r.amountCents, 0);
  const seenCents = Math.max(0, fees.reduce((s, t) => s + t.amountCents, 0) - otherRefunds);
  if (seenCents === 0) return null;
  const months = Math.min(12, Math.max(1, monthsOfData));
  return {
    seenCents,
    yearCents: Math.round(seenCents * (12 / months)),
    count: fees.length,
    monthsOfData: months,
    estimated: months < 12,
  };
}

// Whole days between two YYYY-MM-DD dates, either order.
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}
