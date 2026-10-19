// Demo advice mode (spec step 98). Jane may recommend investments, taxes, insurance and
// loans only to people whose data is the demo bank, and every such message and page says so
// with this label.

export const DEMO_ADVICE_LABEL = "Demo advice: sample data, not financial advice";

// Advice for real accounts. It stays off in code until a licensed partner (a registered
// investment adviser for investments, a licensed agency for insurance, a lender or loan
// marketplace for loans, a tax preparer for taxes) is connected and counsel has signed off on
// the wording. Turning it on is a code change, never an env var.
export const REAL_ACCOUNT_ADVICE = false;
