import type { APR, LiabilitiesObject } from "plaid";
import { MAX_APR_BPS } from "@/config/plaid";
import { toCents } from "./plaid-source";

// Plaid Liabilities (spec step 65) in the app's own shape: one row per card or loan, with
// rates in basis points and money in cents. Field names follow Plaid's /liabilities/get
// response (plaid SDK types CreditCardLiability, MortgageLiability, StudentLoan and
// LoanLiability). Account numbers, addresses, guarantors and reference numbers are left
// out on purpose. Pure.

export type LiabilityKind = "credit" | "mortgage" | "student" | "loan";

export type NormalizedLiability = {
  accountRef: string;
  kind: LiabilityKind;
  aprBps: number | null;
  rateType: string | null;
  minimumPaymentCents: number | null;
  // YYYY-MM-DD dates, as Plaid gives them.
  nextPaymentDueDate: string | null;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
  originationPrincipalCents: number | null;
  originationDate: string | null;
  payoffDate: string | null;
  isOverdue: boolean | null;
  pastDueCents: number | null;
  ytdInterestPaidCents: number | null;
  description: string | null;
};

// 15.24 (percent) -> 1524. Anything that can't be a real yearly rate is missing.
export function toBps(percentage: number | null | undefined): number | null {
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) return null;
  const bps = Math.round(percentage * 100);
  return bps < 0 || bps > MAX_APR_BPS ? null : bps;
}

const day = (value: string | null | undefined): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

const text = (value: string | null | undefined): string | null => value?.trim() || null;

// A card's rate: the purchase APR, which is what new spending is charged; otherwise the
// first one the bank lists.
export function cardApr(aprs: APR[]): number | null {
  const purchase = aprs.find((a) => a.apr_type === "purchase_apr");
  return toBps((purchase ?? aprs[0])?.apr_percentage);
}

const EMPTY = {
  rateType: null,
  originationPrincipalCents: null,
  originationDate: null,
  payoffDate: null,
  isOverdue: null,
  pastDueCents: null,
  ytdInterestPaidCents: null,
  description: null,
} as const;

export function normalizeLiabilities(liabilities: LiabilitiesObject): NormalizedLiability[] {
  const out: NormalizedLiability[] = [];
  for (const c of liabilities.credit ?? []) {
    if (!c.account_id) continue;
    out.push({
      ...EMPTY,
      accountRef: c.account_id,
      kind: "credit",
      aprBps: cardApr(c.aprs ?? []),
      minimumPaymentCents: toCents(c.minimum_payment_amount),
      nextPaymentDueDate: day(c.next_payment_due_date),
      lastPaymentCents: toCents(c.last_payment_amount),
      lastPaymentDate: day(c.last_payment_date),
      isOverdue: c.is_overdue,
    });
  }
  for (const m of liabilities.mortgage ?? []) {
    const pastDueCents = toCents(m.past_due_amount);
    out.push({
      accountRef: m.account_id,
      kind: "mortgage",
      aprBps: toBps(m.interest_rate?.percentage),
      rateType: text(m.interest_rate?.type),
      minimumPaymentCents: toCents(m.next_monthly_payment),
      nextPaymentDueDate: day(m.next_payment_due_date),
      lastPaymentCents: toCents(m.last_payment_amount),
      lastPaymentDate: day(m.last_payment_date),
      originationPrincipalCents: toCents(m.origination_principal_amount),
      originationDate: day(m.origination_date),
      payoffDate: day(m.maturity_date),
      // Mortgages have no overdue flag; an amount past due is the same thing.
      isOverdue: pastDueCents === null ? null : pastDueCents > 0,
      pastDueCents,
      ytdInterestPaidCents: toCents(m.ytd_interest_paid),
      description: text(m.loan_type_description),
    });
  }
  for (const s of liabilities.student ?? []) {
    if (!s.account_id) continue;
    out.push({
      ...EMPTY,
      accountRef: s.account_id,
      kind: "student",
      aprBps: toBps(s.interest_rate_percentage),
      minimumPaymentCents: toCents(s.minimum_payment_amount),
      nextPaymentDueDate: day(s.next_payment_due_date),
      lastPaymentCents: toCents(s.last_payment_amount),
      lastPaymentDate: day(s.last_payment_date),
      originationPrincipalCents: toCents(s.origination_principal_amount),
      originationDate: day(s.origination_date),
      payoffDate: day(s.expected_payoff_date),
      isOverdue: s.is_overdue,
      ytdInterestPaidCents: toCents(s.ytd_interest_paid),
      description: text(s.loan_name),
    });
  }
  for (const l of liabilities.loan ?? []) {
    out.push({
      ...EMPTY,
      accountRef: l.account_id,
      kind: "loan",
      aprBps: toBps(l.interest_rate?.percentage),
      rateType: text(l.interest_rate?.type),
      minimumPaymentCents: toCents(l.next_payment_amount),
      nextPaymentDueDate: day(l.next_payment_due_date),
      lastPaymentCents: toCents(l.last_payment_amount),
      lastPaymentDate: day(l.last_payment_date),
      originationPrincipalCents: toCents(l.origination_principal_amount),
      originationDate: day(l.origination_date),
      payoffDate: day(l.maturity_date),
      ytdInterestPaidCents: toCents(l.ytd_interest_paid),
    });
  }
  return out;
}
