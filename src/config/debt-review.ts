// Debt on autopilot, round two (spec step 230): one yearly review of everything about debts
// and credit, done for the person where Jane may and handed to them where it may not.

// A review is done at least this often...
export const REVIEW_EVERY_DAYS = 365;
// ...and early when something changes, but never twice within this many days.
export const REVIEW_MIN_GAP_DAYS = 30;
// A paycheck this much bigger than at the last review counts as a raise.
export const REVIEW_RAISE_SHARE = 0.05;

export type ReviewReason = "yearly" | "first" | "raise" | "new_loan" | "missed_payment" | "asked";

export const REVIEW_REASON_TEXT: Readonly<Record<ReviewReason, string>> = {
  first: "Here's your first debt review",
  yearly: "It's been a year, so here's your yearly debt review",
  raise: "Your pay went up, so here's a debt review",
  new_loan: "There's a new loan on your list, so here's a debt review",
  missed_payment: "A payment was missed, so here's a debt review",
  asked: "Here's your debt review",
};

// The items, in the order they're listed.
export const REVIEW_ITEMS = ["statements", "promos", "rates", "home", "goals"] as const;
export type ReviewItemKey = (typeof REVIEW_ITEMS)[number];
export const REVIEW_ITEM_TITLES: Readonly<Record<ReviewItemKey, string>> = {
  statements: "Payments timed to statement dates",
  promos: "0% promotions on pace",
  rates: "Lower-rate requests",
  home: "PMI and escrow",
  goals: "Credit score goals",
};
