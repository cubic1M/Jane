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

// Jane's chat (src/config/agent-chat.ts takes these in): each debt message source's daily
// limit, and where its messages go among the rest (higher first).
export const DEBT_SOURCE_LIMITS = { debts: 1, payoff: 1 } as const;
export const DEBT_MESSAGE_PRIORITY = {
  // A buy now, pay later plan Jane found, then a debt with no rate: news that can wait,
  // after the questions other features need answered first (taxes, investments).
  debt_found: 31,
  debt_missing_rate: 29,
  // Spec step 110: a plan off track comes with the time-sensitive things; Jane's offer of a
  // plan and an on-track check after the findings.
  payoff_off_track: 72,
  payoff_offer: 55,
  payoff_on_track: 48,
} as const;

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
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
  ],
  safe: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
  ],
  all: [
    {
      step: 109,
      does: "Keeps every loan, card and buy now, pay later plan up to date from your bank and payments, and tells you when one appears or a rate is missing.",
    },
    {
      step: 110,
      does: "Recomputes your payoff plan from your balances every month, checks it against what you owe and tells you when you're off track.",
    },
  ],
};

// --- Step 110: payoff plans ----------------------------------------------------------

// Debts the payoff plan leaves out: a mortgage runs for decades on its own schedule and
// would swamp the plan (step 115 watches it). Same as the planner (PLANNER_LEFT_OUT_SUBTYPES).
export const PAYOFF_LEFT_OUT_KINDS: readonly string[] = ["mortgage"];
// A Pay in 4 plan's payment comes every two weeks: this many count toward a month.
export const BNPL_PAYMENTS_PER_MONTH = 2;
// "What if I paid more?": the extra a month each scenario adds on top of the minimums.
export const DEBT_EXTRA_SCENARIOS_CENTS: readonly number[] = [0, 5_000, 10_000, 25_000];
// The most extra a month the chat or the page takes, as a typo guard.
export const MAX_DEBT_EXTRA_CENTS = 10_000_000;
// Demo advice picks highest rate first (least interest), unless smallest balance first
// costs at most this much more interest and clears its first debt at least this many
// months sooner: then the early win is worth the small cost.
export const SNOWBALL_PICK_MAX_EXTRA_INTEREST_CENTS = 5_000;
export const SNOWBALL_QUICK_WIN_MONTHS = 3;
// The plan checks itself once this many days have passed since its last check.
export const DEBT_PLAN_CHECK_DAYS = 28;
// Months of expected balances kept, to compare with what's owed at each check.
export const DEBT_PLAN_TRACK_MONTHS = 24;
// Off track: owing more than the plan expected by more than this share of what the plan
// meant to pay down since the last check, and by at least this much.
export const DEBT_OFF_TRACK_SHARE = 0.5;
export const DEBT_OFF_TRACK_MIN_CENTS = 10_000;
