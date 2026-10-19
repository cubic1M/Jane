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

// What the lender says about an application: approved (on the offer's terms) or declined
// after the soft check; then accepted once the person signs, and funded when the lender has
// paid the old loan off.
export type ApplicationStatus = "approved" | "declined" | "accepted" | "funded";

export type Applicant = {
  name: string;
  email: string;
  // The loan being paid off and what's owed on it, by name: never an account number.
  payingOff: string;
  amountCents: number;
};

// Spec step 113: a 0% balance transfer card for a card's balance.
export type TransferRequest = {
  amountCents: number;
  creditBand: PrequalifyRequest["creditBand"];
  month: string;
};

export type TransferOffer = {
  id: string;
  issuer: string;
  cardName: string;
  // 0% for this many months from the transfer.
  promoMonths: number;
  // The transfer fee on this amount, and how the issuer puts it.
  feeCents: number;
  feeLabel: string;
  // The rate once the 0% ends.
  goToAprBps: number;
  sourceUrl: string;
  demo: boolean;
};

export type LenderPartner = {
  name: string;
  // Soft check: offers the person prequalifies for. Never a hard credit pull.
  prequalify(request: PrequalifyRequest): Promise<LoanOffer[]>;
  // One offer again, by id, as it stands now (null when it's gone).
  offer(id: string, request: PrequalifyRequest): Promise<LoanOffer | null>;
  // Spec step 113: 0% balance transfer cards the person prequalifies for (a soft check).
  balanceTransfers(request: TransferRequest): Promise<TransferOffer[]>;
  // Only after the person reviewed the terms and tapped Submit (spec step 112). A soft
  // check: approved on the offer's terms, or declined.
  apply(input: {
    offer: LoanOffer;
    request: PrequalifyRequest;
    applicant: Applicant;
  }): Promise<{ applicationId: string; status: "approved" | "declined" }>;
  // Only after the person tapped Accept: signs for the loan.
  accept(applicationId: string): Promise<void>;
  // Where it stands now. acceptedAt is when the person accepted, for the stand-in, which
  // keeps no state of its own; a real partner looks it up.
  status(
    applicationId: string,
    at: { now: Date; acceptedAt: Date | null },
  ): Promise<ApplicationStatus>;
};
