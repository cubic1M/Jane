// A credit partner (spec step 116): where a credit score and its factors come from. Soft
// pulls only, which never affect the score. The demo bank uses a stand-in (./demo.ts); a
// real partner (a bureau or licensed score provider) implements the same interface, and
// nothing is pulled for a real account until one is connected.

export type CreditFactorKey =
  "payment_history" | "utilisation" | "credit_age" | "inquiries" | "mix";

export type CreditFactor = {
  key: CreditFactorKey;
  label: string;
  impact: "helping" | "hurting" | "neutral";
  // One plain line on why.
  detail: string;
};

export type CreditReport = {
  score: number;
  // The model and its range, as the partner names them.
  model: string;
  range: { low: number; high: number };
  // What the partner knows that Jane doesn't: the cards' total limit (for utilisation),
  // the average account age, and hard inquiries in the last year.
  cardLimitCents: number;
  averageAgeMonths: number;
  hardInquiries: number;
  // A stand-in score, never a real one.
  demo: boolean;
};

// What Jane already knows that a stand-in uses; a real partner ignores it and reads the
// bureau file.
export type CreditRequest = {
  cardBalanceCents: number;
  overdue: boolean;
  lateFeesLastYear: number;
  hasInstallmentLoan: boolean;
  month: string;
};

// Spec step 175: a change to try in the score simulator, on top of what's there now.
export type CreditChange = {
  // Card balances after the change (a payment before the statement closes, say).
  cardBalanceCents?: number;
  // A year of on-time payments: no late fees in the last year.
  lateFeesLastYear?: number;
  // A new card's limit, and the hard inquiry applying for it adds.
  extraLimitCents?: number;
  extraInquiries?: number;
  // A credit-builder loan adds an installment loan to the mix.
  hasInstallmentLoan?: boolean;
};

// Spec step 181: something on the person's credit report that may need fixing.
export type ReportItem = {
  // Stable for the same item.
  id: string;
  kind: "collection" | "error";
  // The collector, or the account the error is on.
  creditor: string;
  // The original creditor, for a collection.
  originalCreditor: string | null;
  amountCents: number | null;
  // YYYY-MM-DD: when a collection's notice reached the person, or the error first showed.
  firstSeenOn: string;
  // What the report says, and for an error what's wrong with it.
  detail: string;
  medical: boolean;
};

export type CreditPartner = {
  name: string;
  softPull(request: CreditRequest): Promise<CreditReport>;
  // Spec step 175: the score simulator. An estimate of the score after a change; it pulls
  // nothing and changes nothing.
  estimate(request: CreditRequest, change: CreditChange): Promise<number>;
  // Spec step 181: collections and suspect items on the report (a soft pull).
  // `anchor` is the day Jane first pulled this person's report, so a stand-in's items stay
  // put from month to month; a real partner ignores it.
  reportItems(request: CreditRequest, anchor: string): Promise<ReportItem[]>;
};
