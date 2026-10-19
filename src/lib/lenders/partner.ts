import type { LoanProduct } from "@/config/debt";

// A lender partner (spec step 111): where refinance offers come from. Jane asks it to
// prequalify the person for a loan (a soft check that doesn't touch their credit score),
// reads back each offer, applies only after the person taps (spec step 112), and follows
// the application. The demo bank uses a stand-in catalog (./demo.ts); a real loan
// marketplace partner implements the same interface.

export type PrequalifyRequest = {
  product: LoanProduct;
  // What's owed now, and the months to compare over (the debt's remaining term).
  amountCents: number;
  termMonths: number;
  // A stand-in credit band until a credit partner is connected (spec step 116).
  creditBand: "excellent" | "good" | "fair";
  // YYYY-MM: rates move month to month.
  month: string;
};

export type LoanOffer = {
  // Stable for the same lender, product, rate and term.
  id: string;
  lender: string;
  product: LoanProduct;
  aprBps: number;
  rateType: "fixed" | "variable";
  termMonths: number;
  // Paid up front: an origination fee or, for a mortgage, closing costs.
  feeCents: number;
  feeLabel: string;
  // Where the lender explains it (the stand-in's are example.com pages).
  sourceUrl: string;
  // A stand-in offer, never a real one.
  demo: boolean;
};

export type ApplicationStatus = "submitted" | "approved" | "funded" | "declined";

export type LenderPartner = {
  name: string;
  // Soft check: offers the person prequalifies for. Never a hard credit pull.
  prequalify(request: PrequalifyRequest): Promise<LoanOffer[]>;
  // One offer again, by id, as it stands now (null when it's gone).
  offer(id: string, request: PrequalifyRequest): Promise<LoanOffer | null>;
  // Only after the person taps Apply (spec step 112).
  apply(input: { offerId: string; applicant: Record<string, string> }): Promise<{
    applicationId: string;
    status: ApplicationStatus;
  }>;
  status(applicationId: string): Promise<ApplicationStatus>;
};
