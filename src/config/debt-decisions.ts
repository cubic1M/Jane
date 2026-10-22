// Straight answers to the money decisions people ask about debt and credit (the chat's
// decision questions): pay a card or invest, consolidate, use savings on debt, close a card,
// a payday loan, a student loan early. Every answer is built from the person's own numbers
// and the assumptions here; the comparison is a fact, the pick is demo advice.

// What investing has returned over long stretches, as a range a year before inflation is taken
// out of the picture, never a promise: a debt costing more than the top of it is a better
// "return" than investing, because paying it down is certain.
export const INVEST_RANGE = {
  lowBps: 400,
  highBps: 800,
  note: "Investing has historically returned roughly 4% to 8% a year over long periods, with some losing years along the way.",
} as const;

// How sure Jane is of each answer, and why (shown as "80% sure: ..." under the answer).
export const DECISION_CONFIDENCE: Readonly<Record<string, { percent: number; reason: string }>> = {
  pay_or_invest: {
    percent: 80,
    reason: "the rate is yours; investing's range is a historical average, not a forecast",
  },
  consolidate: { percent: 75, reason: "the offers are stand-in quotes, not a lender's" },
  personal_loan: { percent: 75, reason: "the offers are stand-in quotes, not a lender's" },
  savings_or_debt: { percent: 85, reason: "your balances and rates, as your accounts show them" },
  close_card: { percent: 70, reason: "I only know your cards' total limit" },
  payoff_hurts: { percent: 90, reason: "how credit scores treat paying a card off" },
  payday_loan: { percent: 90, reason: "the usual payday loan fee, not a particular lender's" },
  student_early: { percent: 75, reason: "I can't tell if your loan is federal" },
  overdraft: { percent: 80, reason: "your bills and pay as they repeat" },
  bnpl: { percent: 85, reason: "how pay-in-4 plans usually work" },
  save_each_month: { percent: 80, reason: "your last full months of income and spending" },
  rent_or_buy: { percent: 70, reason: "a typical rate and the usual 28/36 rules" },
};

// Cash to keep before putting more on a debt: this many months of spending.
export const KEEP_CASH_MONTHS = 1;

// A payday loan: the usual fee per $100 for two weeks, as a share, and the yearly rate that is.
export const PAYDAY = { feeShare: 0.15, days: 14 } as const;
export const paydayAprPercent = () => Math.round(PAYDAY.feeShare * (365 / PAYDAY.days) * 100);

// Closed cards in good standing stay on the report; this is the usual number of years.
export const CLOSED_CARD_YEARS = 10;

// How much of take-home to save: the common 50/30/20 rule's 20%.
export const SAVE_SHARE = 0.2;
// Buying tends to beat renting only after about this many years in the home, because closing
// costs (3% of the price) and moving come first.
export const RENT_BUY_YEARS = 5;

// Card use under this share of the limit is where it stops weighing on a score.
export const USE_GOOD = 0.3;
