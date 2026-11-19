import type { MethodAccount, MethodLiabilityData } from "./api";

// Method's liability accounts in Jane's shape: an account (Plaid's types, so the Loans pages,
// the debt planner and the student-loan cards read it like any other) and its liability row.
// Amounts are already cents. A field Method leaves empty stays empty, never zero. Kinds Jane has
// no page for yet (collections, utilities, BNPL, medical, insurance) are left out. Pure.

export type MethodRead = {
  externalId: string;
  account: {
    name: string;
    mask: string | null;
    type: "credit" | "loan";
    subtype: string;
    currentBalanceCents: number | null;
  };
  liability: {
    kind: "credit" | "mortgage" | "student" | "loan";
    aprBps: number | null;
    rateType: string | null;
    minimumPaymentCents: number | null;
    nextPaymentDueDate: string | null;
    lastPaymentCents: number | null;
    lastPaymentDate: string | null;
    originationPrincipalCents: number | null;
    originationDate: string | null;
    payoffDate: string | null;
    loanTermMonths: number | null;
    description: string | null;
  };
  // "direct" from the lender, or "snapshot" from the credit report (as of its last report).
  source: string | null;
  dataAsOf: string | null;
};

const SHAPES = {
  credit_card: { type: "credit", subtype: "credit card", kind: "credit" },
  auto_loan: { type: "loan", subtype: "auto", kind: "loan" },
  mortgage: { type: "loan", subtype: "mortgage", kind: "mortgage" },
  personal_loan: { type: "loan", subtype: "loan", kind: "loan" },
  student_loans: { type: "loan", subtype: "student", kind: "student" },
} as const;

const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const day = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const bps = (percent: unknown) =>
  typeof percent === "number" && Number.isFinite(percent) ? Math.round(percent * 100) : null;

// A card's rate: Method may give a range (purchase, cash advance...). Only a single rate is kept;
// a range isn't one rate, so it's left unknown rather than picked from.
function cardRate(data: MethodLiabilityData): number | null {
  const min = bps(data.interest_rate_percentage_min);
  const max = bps(data.interest_rate_percentage_max);
  if (max !== null && (min === null || min === max)) return max;
  return bps(data.interest_rate_percentage);
}

// Student loans: the rate across the disbursements, weighted by what's left on each. Unknown if
// any disbursement lacks its rate or balance.
function studentRate(data: MethodLiabilityData): number | null {
  const parts = data.disbursements ?? [];
  if (parts.length === 0) return bps(data.interest_rate_percentage);
  let owed = 0;
  let weighted = 0;
  for (const part of parts) {
    const balance = cents(part.balance);
    const rate = bps(part.interest_rate_percentage);
    if (balance === null || rate === null) return null;
    owed += balance;
    weighted += balance * rate;
  }
  return owed > 0 ? Math.round(weighted / owed) : null;
}

export function methodReads(accounts: readonly MethodAccount[]): MethodRead[] {
  return accounts.flatMap((account) => {
    const type = account.liability?.type ?? "";
    if (account.type !== "liability" || !Object.hasOwn(SHAPES, type)) return [];
    const shape = SHAPES[type as keyof typeof SHAPES];
    const update = typeof account.update === "object" && account.update ? account.update : null;
    const data = (update?.[type] ?? {}) as MethodLiabilityData;
    const federal = type === "student_loans" ? data.sub_type : null;
    return [
      {
        externalId: account.id,
        account: {
          name: account.liability?.name?.trim() || "Loan",
          mask: account.liability?.mask ?? null,
          type: shape.type,
          subtype: shape.subtype,
          currentBalanceCents: cents(data.balance),
        },
        liability: {
          kind: shape.kind,
          aprBps:
            type === "credit_card"
              ? cardRate(data)
              : type === "student_loans"
                ? studentRate(data)
                : bps(data.interest_rate_percentage),
          rateType: data.interest_rate_type ?? null,
          minimumPaymentCents: cents(data.next_payment_minimum_amount),
          nextPaymentDueDate: day(data.next_payment_due_date),
          lastPaymentCents: cents(data.last_payment_amount),
          lastPaymentDate: day(data.last_payment_date),
          originationPrincipalCents: cents(data.original_loan_amount),
          originationDate: day(data.opened_at),
          payoffDate: day(data.expected_payoff_date),
          loanTermMonths: typeof data.term_length === "number" ? data.term_length : null,
          // Federal or private, as Method says; never "Direct", which Method doesn't say.
          description:
            federal === "federal"
              ? "Federal student loans"
              : federal === "private"
                ? "Private student loans"
                : null,
        },
        source: update?.source ?? null,
        dataAsOf: update?.data_as_of ?? null,
      },
    ];
  });
}
