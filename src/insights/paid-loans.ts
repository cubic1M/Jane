import { PAID_LOAN_MIN_PAYMENTS, PAID_LOAN_RECENT_DAYS } from "@/config/debt";
import { normalizeMerchant } from "@/data-sources/merchant";
import { addDays, addMonths } from "@/lib/dates";

// Loans seen only in what the person pays from checking: a student loan, a car loan or a
// mortgage with no loan account on file (an upload person's usual case). Night QA 10-30: a
// person paying Nelnet $212.40 a month read "No loans, cards or plans yet" on /loans. One per
// lender and kind, from the latest payment; what's owed isn't known until the person types it.
// The debt book leaves out a kind already on file as a loan account. Pure.

export type PaidLoanKind = "student" | "auto" | "mortgage";

export const PAID_LOAN_CATEGORIES: Readonly<Record<string, PaidLoanKind>> = {
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: "student",
  LOAN_PAYMENTS_CAR_PAYMENT: "auto",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "mortgage",
};

export type PaidLoanPayment = {
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
};

export type PaidLoan = {
  // "student:nelnet": what typed terms are saved against, after "paid:".
  key: string;
  lender: string;
  kind: PaidLoanKind;
  paymentCents: number;
  paymentsMade: number;
  lastDate: string;
  // The next payment a month after the last, the first one from today on.
  nextDate: string;
};

export function paidLoans(payments: readonly PaidLoanPayment[], asOf: string): PaidLoan[] {
  const groups = new Map<string, { kind: PaidLoanKind; lender: string; rows: PaidLoanPayment[] }>();
  for (const p of payments) {
    const kind = PAID_LOAN_CATEGORIES[p.pfcDetailed ?? ""];
    if (!kind || p.amountCents <= 0 || p.date > asOf) continue;
    const merchant = normalizeMerchant(p.merchantName ?? p.description);
    if (!merchant) continue;
    const key = `${kind}:${merchant.key}`;
    const group = groups.get(key) ?? { kind, lender: merchant.name, rows: [] };
    group.rows.push(p);
    groups.set(key, group);
  }
  const recent = addDays(asOf, -PAID_LOAN_RECENT_DAYS);
  return [...groups.entries()]
    .flatMap(([key, { kind, lender, rows }]): PaidLoan[] => {
      if (rows.length < PAID_LOAN_MIN_PAYMENTS) return [];
      const last = [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
      if (last.date < recent) return [];
      let nextDate = addMonths(last.date, 1);
      while (nextDate < asOf) nextDate = addMonths(nextDate, 1);
      return [
        {
          key,
          lender,
          kind,
          paymentCents: last.amountCents,
          paymentsMade: rows.length,
          lastDate: last.date,
          nextDate,
        },
      ];
    })
    .sort((a, b) => b.paymentCents - a.paymentCents || a.key.localeCompare(b.key));
}
