import { INSURANCE_PARTNER_ENV, QUOTABLE_KINDS, type PolicyKind } from "@/config/insurance";
import type { PremiumFrequency } from "@/config/documents";
import type { PrismaClient } from "@/generated/prisma/client";
import { demoOptionsAllowed } from "@/lib/compare";
import { db as defaultClient } from "@/lib/db";
import { hasDemoBank } from "@/lib/plaid/demo";
import type { Coverage } from "./coverage";
import { demoPartner } from "./demo-partner";

// The insurance partner (spec step 103): who quotes, binds and cancels policies. The
// shapes here follow what a licensed insurance marketplace's API returns (a quote id, the
// carrier and its rating, the premium for the term, the cover and deductible quoted, an
// expiry), so a real partner drops in behind the same interface.
//
// Until one is connected, the stand-in (./demo-partner.ts) answers for demo-bank people
// only, from a made-up carrier catalog. Everyone else gets no partner, and Jane says quotes
// aren't available yet. To swap in a real partner: implement InsurancePartner over its API,
// return it from partnerFor when INSURANCE_PARTNER names it, and record counsel's answer in
// COUNSEL_INSURANCE_REFERRALS (src/config/referrals.ts).

export type QuoteRequest = {
  kind: PolicyKind;
  // Two-letter state, or null when the person hasn't said.
  state: string | null;
  household: {
    housing: string | null;
    vehicles: number | null;
    dependants: number | null;
    pets: number | null;
  };
  // The cover and deductible to quote: the person's current policy, like for like.
  deductibleCents: number | null;
  coverage: Coverage;
  // How the person pays now, so prices compare in the same terms.
  premiumFrequency: PremiumFrequency;
  // YYYY-MM-DD: when the new policy would start.
  startDate: string;
};

export type QuoteCarrier = {
  id: string;
  name: string;
  rating: string;
  // 0–100, for weighing the pick (spec step 104).
  ratingScore: number;
  claimsPhone: string;
  claimsUrl: string;
};

export type PartnerQuote = {
  partnerQuoteId: string;
  carrier: QuoteCarrier;
  // A health plan's name (spec step 149); other kinds are the carrier's standard policy.
  plan?: string | null;
  kind: PolicyKind;
  // What the term costs a year, and per payment at the requested frequency.
  annualPremiumCents: number;
  premiumCents: number;
  premiumFrequency: PremiumFrequency;
  termMonths: number;
  deductibleCents: number | null;
  // The cover quoted, by the same keys as the policy's (COVERAGE_FIELDS).
  coverage: Coverage;
  // ISO time.
  expiresAt: string;
  // From the stand-in, never a real offer.
  demo: boolean;
};

export type Binding = {
  // The new policy's number at the carrier.
  policyNumber: string;
  carrier: QuoteCarrier;
  // YYYY-MM-DD.
  startDate: string;
  firstPaymentCents: number;
  // The documents the carrier issues (declarations page), as plain text.
  documents: { title: string; text: string }[];
};

export type PaymentStatus = "paid" | "pending" | "failed";

export type Cancellation = {
  status: "cancelled";
  // YYYY-MM-DD: the last day of cover.
  effectiveDate: string;
  confirmation: string;
};

export interface InsurancePartner {
  readonly name: string;
  readonly demo: boolean;
  quote(request: QuoteRequest, options: { now: Date }): Promise<PartnerQuote[]>;
  bind(
    quote: Pick<
      PartnerQuote,
      | "partnerQuoteId"
      | "carrier"
      | "kind"
      | "premiumCents"
      | "deductibleCents"
      | "coverage"
      | "termMonths"
    >,
    options: { startDate: string; holderName: string | null; now: Date },
  ): Promise<Binding>;
  // Whether the first payment on a bound policy went through.
  paymentStatus(
    policyNumber: string,
    options: { startDate: string; now: Date },
  ): Promise<PaymentStatus>;
  cancel(
    policy: { carrier: string; policyNumber: string | null },
    options: { effectiveDate: string; now: Date },
  ): Promise<Cancellation>;
}

export const isQuotable = (kind: PolicyKind) => QUOTABLE_KINDS.includes(kind);

// The partner that answers for this person, or null when none can.
export async function partnerFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<InsurancePartner | null> {
  const configured = process.env[INSURANCE_PARTNER_ENV] ?? "demo";
  if (configured !== "demo") {
    // No real partner is connected yet; see the note at the top.
    return null;
  }
  if (!demoOptionsAllowed()) return null;
  return (await hasDemoBank(userId, { client })) ? demoPartner : null;
}
