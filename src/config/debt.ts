// Loans and debt (spec Phase Y, steps 109–117): every threshold, rate and limit Jane's
// debt features read. Nothing here is inline in the code.

// --- Step 109: every debt in one place -----------------------------------------------

// Buy now, pay later companies, found from their payments (src/insights/bnpl.ts). A
// payment counts when its merchant or description has one of the words.
export const BNPL_PROVIDERS = [
  { key: "affirm", name: "Affirm", words: ["affirm"] },
  { key: "klarna", name: "Klarna", words: ["klarna"] },
  { key: "afterpay", name: "Afterpay", words: ["afterpay"] },
] as const;
export type BnplProviderKey = (typeof BNPL_PROVIDERS)[number]["key"];

// A Pay in 4 plan: four equal payments two weeks apart, the first at checkout. Every one of
// these companies offers it interest-free; that's where its 0% rate comes from.
export const BNPL_PAY_IN_4_PAYMENTS = 4;
export const BNPL_PAY_IN_4_RATE_SOURCE =
  "Pay in 4 plans charge no interest under the company's own terms";
// Days between payments that read as every two weeks, and as monthly.
export const BNPL_BIWEEKLY_DAYS = { min: 12, max: 16 } as const;
export const BNPL_MONTHLY_DAYS = { min: 26, max: 35 } as const;
// Payments looked at: this far back.
export const BNPL_LOOKBACK_DAYS = 200;
// A plan is still running while its next payment is no more than this late.
export const BNPL_GRACE_DAYS = 10;
// Payments a few cents apart (rounding of the last one) are the same plan.
export const BNPL_AMOUNT_TOLERANCE_CENTS = 2;

// Terms the person types for a debt the bank doesn't report (src/lib/debts.ts): typo guards.
export const MAX_TYPED_APR_BPS = 9_999;
export const MAX_TYPED_DEBT_CENTS = 2_000_000_000;

// What Jane does about debts by herself at each autopilot level (src/config/autopilot.ts),
// step by step. Applying for credit, moving money and signing always need the person's tap,
// at every level. Steps 110–117 add to this list.
export const DEBT_AUTOPILOT: Readonly<
  Record<"ask" | "safe" | "all", readonly { step: number; does: string }[]>
> = {
  ask: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
  ],
  safe: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
  ],
  all: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
  ],
};
