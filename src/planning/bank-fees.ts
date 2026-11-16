import { PAY_APP_NAMES } from "@/config/costly-borrowing";
import { BANK_FEE_CATEGORIES, FEE_REVERSAL_DAYS, PROCESSOR_FEE_PAYEE } from "@/config/detection";
import { ANNUAL_FEE_WORDS, FEE_PACE_MIN_CHARGES } from "@/config/found-policies";

// Bank fees in a year, the one definition (the brief's suggestion, the Today card's fees and
// Jane's answer all use it): fees in the bank-fee categories over the last twelve months, not
// a payment processor's. With under twelve months of data the figure is scaled up to a year and
// said to be an estimate. A fee the bank gave back (the same amount, on the same account,
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

// Each account's fees, on its own (debugger 11-01: a card's one late fee was paced along with
// checking's monthly fees, "about $200.00/yr" where the report said $77): what was seen, and a
// year's worth. The report's finding on each account is this (src/detection/rules/bank-fees.ts),
// and the dock and the chat add them up (bankFeesYear), so the three say one figure (gate B).
export type AccountFees = {
  accountId: string | undefined;
  seenCents: number;
  yearCents: number;
  count: number;
};

export function bankFeesByAccount(
  transactions: readonly FeeTx[],
  monthsOfData: number,
): AccountFees[] {
  const inFees = transactions.filter(
    (t) =>
      BANK_FEE_CATEGORIES.includes(t.pfc as never) &&
      !PROCESSOR_FEE_PAYEE.test(t.description) &&
      // A pay advance app's tip is the advance's cost (costly borrowing), not a bank fee.
      !PAY_APP_NAMES.test(t.description),
  );
  const refunds = inFees.filter((t) => t.amountCents < 0);
  const used = new Set<FeeTx>();
  const reversed = (fee: FeeTx) => {
    const back = refunds.find(
      (r) =>
        !used.has(r) &&
        r.amountCents === -fee.amountCents &&
        // On the same account, in any bank-fee category: a bank files its "FEE REVERSAL" line under
        // its own category, not always the fee's, so pairing by category made one upload's $34 fee
        // given back read $102 a year in one bank's layout and $34 in another (gate B).
        r.accountId === fee.accountId &&
        daysApart(fee.date, r.date) <= FEE_REVERSAL_DAYS,
    );
    if (back) used.add(back);
    return Boolean(back);
  };
  const fees = inFees.filter((t) => t.amountCents > 0).filter((fee) => !reversed(fee));
  // Other refunds of fees (part of one, or one we can't pair) still come off.
  const unpaired = refunds.filter((r) => !used.has(r));
  const months = Math.min(12, Math.max(1, monthsOfData));
  return [...new Set(fees.map((t) => t.accountId))].sort().flatMap((account) => {
    const own = fees.filter((t) => t.accountId === account);
    const back = unpaired
      .filter((r) => r.accountId === account)
      .reduce((s, r) => s - r.amountCents, 0);
    const seen = Math.max(0, own.reduce((s, t) => s + t.amountCents, 0) - back);
    if (seen === 0) return [];
    // A card's annual fee comes once a year, so it counts once, not scaled up with the rest.
    const yearly = Math.min(
      seen,
      own
        .filter((t) => ANNUAL_FEE_WORDS.test(t.description))
        .reduce((s, t) => s + t.amountCents, 0),
    );
    // One fee isn't a pace: it counts once (FEE_PACE_MIN_CHARGES).
    const paced =
      own.filter((t) => !ANNUAL_FEE_WORDS.test(t.description)).length >= FEE_PACE_MIN_CHARGES;
    return [
      {
        accountId: account,
        seenCents: seen,
        yearCents: paced ? Math.round((seen - yearly) * (12 / months)) + yearly : seen,
        count: own.length,
      },
    ];
  });
}

export function bankFeesYear(
  transactions: readonly FeeTx[],
  monthsOfData: number,
): BankFees | null {
  const accounts = bankFeesByAccount(transactions, monthsOfData);
  if (accounts.length === 0) return null;
  const months = Math.min(12, Math.max(1, monthsOfData));
  return {
    seenCents: accounts.reduce((s, a) => s + a.seenCents, 0),
    yearCents: accounts.reduce((s, a) => s + a.yearCents, 0),
    count: accounts.reduce((s, a) => s + a.count, 0),
    monthsOfData: months,
    estimated: months < 12,
  };
}

// Whole days between two YYYY-MM-DD dates, either order.
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}
