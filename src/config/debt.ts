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
export const DEBT_SOURCE_LIMITS = {
  debts: 1,
  payoff: 1,
  refinance: 1,
  loans: 2,
  transfers: 1,
  student: 1,
} as const;
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
  // Spec step 111: the refinance offer that saves the most, then any others: money that
  // can wait a few days, after the questions other features wait on (taxes, 35).
  refinance_offer: 33,
  refinance_more: 28,
  // Spec step 112: an approved loan waiting for the person's yes, and an old loan still
  // showing a balance after the new one funded, come early; funded and paid-off news after.
  loan_approved: 86,
  loan_payoff_late: 84,
  loan_funded: 50,
  loan_paid_off: 52,
  // Spec step 113: a reminder before a 0% transfer ends is a deadline; an offer can wait,
  // like refinance offers.
  transfer_reminder: 89,
  transfer_offer: 32,
  // Spec step 114: a cheaper student loan plan, and studentaid.gov's steps, both can wait.
  student_pick: 31,
  student_steps: 27,
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
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
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
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
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
    {
      step: 111,
      does: "Checks refinance rates with the lender partner every month (a soft check) and tells you only when a switch saves enough. Applying always needs your tap.",
    },
    {
      step: 112,
      does: "Prepares the application for the offer you pick from what it already knows, then follows it: funding, and the old loan being paid off. Submitting and accepting a loan always need your tap.",
    },
    {
      step: 113,
      does: "Looks for 0% balance transfer offers for your cards every month and, once you've moved a balance, puts the promo's end on your deadlines and reminds you 60, 30 and 7 days before it. Opening the card and moving the money are yours.",
    },
    {
      step: 114,
      does: "Compares the federal student loan plans at your income, counts your qualifying payments toward forgiveness, and walks you through studentaid.gov's steps. Changing plans is done by you on studentaid.gov.",
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

// --- Step 111: refinance offers --------------------------------------------------------

// The kinds of loan a lender partner refinances (src/lib/lenders), and which of the
// person's debts each takes: a card's balance moves to a personal loan.
export const LOAN_PRODUCTS = ["student", "auto", "mortgage", "personal"] as const;
export type LoanProduct = (typeof LOAN_PRODUCTS)[number];
export const PRODUCT_FOR_DEBT: Readonly<Record<string, LoanProduct>> = {
  student: "student",
  auto: "auto",
  mortgage: "mortgage",
  loan: "personal",
  card: "personal",
};
// A card has no end date, so its offers are compared over this many months.
export const REFI_CARD_TERM_MONTHS = 36;
// Jane asks the lender partner for offers this often, by herself.
export const REFI_CHECK_DAYS = 30;
// And brings one up only when it saves at least this much over the same term, fees in.
export const REFI_MIN_SAVING_CENTS = 30_000;
// Offers shown besides the pick.
export const REFI_RUNNERS_UP = 2;
// Jane picks the cheapest fixed-rate offer that saves enough before a cheaper variable one:
// a variable rate can go up, so its saving isn't certain.
export const REFI_PREFER_FIXED = true;
// Which lender partner to use: "demo" is the stand-in catalog (demo-bank people only, never
// in production unless DEMO_BANK=1); "none" turns refinancing off. A real loan marketplace
// partner is a new value here and a new implementation of LenderPartner.
export const LENDER_PARTNER: "demo" | "none" = "demo";

// --- Step 112: one-tap apply ------------------------------------------------------------

// The stand-in lender funds an accepted loan this many days later (a real one says when).
export const DEMO_LOAN_FUNDING_DAYS = 3;
// Once funded, the old loan should show as paid off within this many days; after that Jane
// tells the person it still shows a balance.
export const LOAN_PAYOFF_WAIT_DAYS = 10;
// An old loan counts as paid off at or under this balance (a few cents of interest).
export const LOAN_PAID_OFF_CENTS = 100;
// An approved loan the person hasn't answered: Jane reminds them after this many days.
export const LOAN_APPROVED_REMIND_DAYS = 1;

// --- Step 113: balance transfers ----------------------------------------------------------

// A 0% transfer is worth bringing up when it saves at least this much against keeping the
// card, the transfer fee counted, paying the same each month.
export const BT_MIN_SAVING_CENTS = 10_000;
// Reminders before the 0% ends, in days. The promo end also goes on Deadlines.
export const BT_REMIND_DAYS: readonly number[] = [60, 30, 7];
// The demo bank shows a moved card balance gone this many days after the transfer.
export const DEMO_TRANSFER_DAYS = 2;
