import type { FindingType } from "@/generated/prisma/client";
import type { ConfidenceLevel } from "@/config/detection";

// What the rules see. The engine loads these from the database; tests build them by hand.
// Dates are YYYY-MM-DD strings and amounts follow Plaid: positive is money out.

export type DetectionAccount = {
  id: string;
  name: string;
  // Plaid type and subtype, e.g. depository/checking or credit/credit card.
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
};

export type DetectionTransaction = {
  id: string;
  accountId: string;
  plaidTransactionId: string | null;
  date: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  categorySource: "rule" | "llm" | "plaid" | null;
};

// A row from recurring_streams (Plaid's /transactions/recurring/get, from step 7).
export type DetectionRecurringStream = {
  id: string;
  accountId: string;
  plaidStreamId: string;
  merchantName: string | null;
  frequency: string;
  lastAmountCents: number;
  averageAmountCents: number;
  lastDate: string | null;
  status: string;
  isActive: boolean;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  transactionIds: string[];
};

export type DetectionInput = {
  // "Today" for the rules: the lookback window ends here.
  asOf: string;
  accounts: DetectionAccount[];
  // Posted (not pending) transactions inside the lookback window.
  transactions: DetectionTransaction[];
  recurringStreams: DetectionRecurringStream[];
  // Merchant keys Claude said are subscriptions (see AMBIGUOUS_SUBSCRIPTION_CATEGORIES).
  subscriptionMerchantKeys?: string[];
};

// The proof behind a finding, stored as JSON so the card can show why.
export type EvidenceTransaction = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
};

export type Evidence = { [key: string]: EvidenceValue };
type EvidenceValue = string | number | boolean | null | EvidenceValue[] | Evidence;

export type Candidate = {
  type: FindingType;
  // Stable within (user, type): the same opportunity gets the same key on every scan.
  key: string;
  title: string;
  annualSavingsCents: number | null;
  // What the rule measured, compared on rescans to decide whether a declined finding returns.
  amountCents: number | null;
  confidence: ConfidenceLevel;
  evidence: Evidence;
};
