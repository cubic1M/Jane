import type { RewardCategory } from "@/config/credit-cards";

// A card partner (spec step 174): where card terms come from. It says which product each of
// the person's cards is, lists the cards they could apply for (rewards, annual fee and
// intro offer), and applies only after the person taps. The demo bank uses a stand-in
// catalog (./demo.ts); a real card marketplace partner implements the same interface.

export type CreditBand = "excellent" | "good" | "fair";

export type CardProduct = {
  // Stable for the same card.
  id: string;
  issuer: string;
  name: string;
  annualFeeCents: number;
  // What a dollar earns, in basis points of cash value (300 is 3%), by kind of spending.
  // A kind not listed earns the base rate.
  rateBps: Partial<Record<RewardCategory, number>>;
  baseRateBps: number;
  // How the card says it ("3x points on dining"), for the page.
  rewardsLabel: string;
  // A sign-up bonus: its cash value after spending this much within this many months.
  intro: { bonusCents: number; spendCents: number; months: number } | null;
  // The lowest credit band the issuer usually approves.
  minBand: CreditBand;
  // Where the issuer explains it (the stand-in's are example.com pages).
  sourceUrl: string;
  // A stand-in card, never a real one.
  demo: boolean;
};

export type CardApplicant = { name: string; email: string };

export type CreditCardPartner = {
  name: string;
  // Which product a card account is, from its name at the bank; null when unknown.
  identify(accountName: string): Promise<CardProduct | null>;
  // Every card the person could apply for this month, for their band.
  catalog(request: { creditBand: CreditBand; month: string }): Promise<CardProduct[]>;
  // One card, by id (null when it's gone).
  product(id: string): Promise<CardProduct | null>;
  // Only after the person tapped Apply. A real application with a hard credit check.
  apply(input: {
    product: CardProduct;
    creditBand: CreditBand;
    applicant: CardApplicant;
  }): Promise<{ applicationId: string; status: "approved" | "declined" | "pending" }>;
};
