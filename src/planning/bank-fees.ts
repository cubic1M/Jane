import { BANK_FEE_CATEGORIES, FEE_REVERSAL_DAYS, PROCESSOR_FEE_PAYEE } from "@/config/detection";
import { ANNUAL_FEE_WORDS, FEE_PACE_MIN_CHARGES } from "@/config/found-policies";

// Bank fees in a year, the one definition (the brief's suggestion, the Today card's fees and
// Jane's answer all use it): fees in the bank-fee categories over the last twelve months, not
// a payment processor's. With under twelve months of data the figure is scaled up to a year and
// said to be an estimate. A fee the bank gave back (the same amount, in the same category,
// within FEE_REVERSAL_DAYS) doesn't count; other fee refunds come off the total. Pure.

export type FeeTx = {
  date: string;
  amountCents: number;
  description: string;
  pfc: string | null;
  // Fees are paced per account, as the report's findings are (src/detection/rules/fee-totals.ts).
  accountId?: string;
};
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
  const unpaired = refunds.filter((r) => !used.has(r));
  const months = Math.min(12, Math.max(1, monthsOfData));
  // Each account on its own, as the report's findings are (debugger 11-01: a card's one late fee
  // was paced along with checking's monthly fees, "about $200.00/yr" where the report said $77).
  const perAccount = [...new Set(fees.map((t) => t.accountId))].map((account) => {
    const own = fees.filter((t) => t.accountId === account);
    const back = unpaired
      .filter((r) => r.accountId === account)
      .reduce((s, r) => s - r.amountCents, 0);
    const seen = Math.max(0, own.reduce((s, t) => s + t.amountCents, 0) - back);
    // A card's annual fee comes once a year, so it counts once, not scaled up with the rest.
    const yearly = Math.min(
      seen,
      own
        .filter((t) => ANNUAL_FEE_WORDS.test(t.description))
        .reduce((s, t) => s + t.amountCents, 0),
    );
    // One fee isn't a pace: it counts once (FEE_PACE_MIN_CHARGES), as the report's finding does.
    const paced =
      own.filter((t) => !ANNUAL_FEE_WORDS.test(t.description)).length >= FEE_PACE_MIN_CHARGES;
    return { seen, year: paced ? Math.round((seen - yearly) * (12 / months)) + yearly : seen };
  });
  const seenCents = perAccount.reduce((s, a) => s + a.seen, 0);
  if (seenCents === 0) return null;
  return {
    seenCents,
    yearCents: perAccount.reduce((s, a) => s + a.year, 0),
    count: fees.length,
    monthsOfData: months,
    estimated: months < 12,
  };
}

// Whole days between two YYYY-MM-DD dates, either order.
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}
