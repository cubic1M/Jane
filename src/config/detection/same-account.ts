// --- Same account or not: an upload beside a linked account, decided by what each one shows -----
// (src/planning/same-account.ts). The founder's rule: Jane double-checks the uploads itself and
// leaves out the copies, without asking.

// Lines in the days both cover, on the side with fewer of them, needed to say anything either way.
export const SAME_ACCOUNT_MIN_LINES = 5;
// This share of those lines found on the other side (the same amount, within the day slack, one to
// one) is the same account; this share or less is a different one; in between, nothing is said.
export const SAME_ACCOUNT_MATCH_RATIO = 0.8;
export const DIFFERENT_ACCOUNT_MAX_RATIO = 0.2;
// A bank's statement and the link can date one charge a day or two apart (posted against made).
export const SAME_ACCOUNT_DAY_SLACK = 2;
// The upload's closing balance against the link's on that day: within a dollar, and the link's own
// reading no more than this many days before it.
export const SAME_ACCOUNT_BALANCE_SLACK_CENTS = 100;
export const SAME_ACCOUNT_BALANCE_SLACK_DAYS = 3;
// "Different" needs the two to share at least this many days: an upload that ends just after the
// link's history begins has too few days in common to say they are another account.
export const DIFFERENT_ACCOUNT_MIN_OVERLAP_DAYS = 14;
