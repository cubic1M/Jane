// Money between family and friends (spec step 226): which payment-app transfers might be a
// loan, how repayments are matched, and when Jane drafts a reminder. Jane never messages the
// other person: every reminder is text for the person to send themselves.

// The payment apps whose transfers are looked at.
export const PAYMENT_APPS = [
  "venmo",
  "zelle",
  "cash app",
  "cashapp",
  "paypal",
  "apple cash",
] as const;
// A transfer of at least this much, with a name on it, might be a loan; smaller ones are
// splitting a meal.
export const CANDIDATE_MIN_CENTS = 10_000;
// How far back Jane looks for transfers.
export const CANDIDATE_LOOKBACK_DAYS = 120;
// Words in a note that make a transfer look like a loan or a repayment.
export const LOAN_WORDS = [
  "loan",
  "lend",
  "lent",
  "borrow",
  "owe",
  "pay back",
  "payback",
  "paying you back",
  "repay",
  "back",
  "rent",
  "deposit",
  "advance",
] as const;
// Words that say it's not a loan (splitting a bill, a gift, a purchase).
export const NOT_LOAN_WORDS = [
  "dinner",
  "lunch",
  "brunch",
  "coffee",
  "gift",
  "birthday",
  "tickets",
  "uber",
  "drinks",
  "split",
  "groceries",
] as const;
// A gentle reminder is drafted for a loan open at least this many days, then again after
// this many more.
export const REMIND_AFTER_DAYS = 30;
export const REMIND_AGAIN_DAYS = 30;
// A co-signed loan this many days past due is worth telling the person about.
export const COSIGNED_PAST_DUE_DAYS = 1;
