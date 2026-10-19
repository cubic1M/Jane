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

export type CreditPartner = {
  name: string;
  softPull(request: CreditRequest): Promise<CreditReport>;
};
