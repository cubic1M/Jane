// "Can I afford this?" settings (src/planning/afford.ts, spec step 69).

// How many month-end checking balances the page shows, this month first.
export const AFFORD_MONTHS = 12;

// The largest purchase or monthly change the page takes: $1 million, which catches typos
// and keeps the math well inside safe integers.
export const MAX_AFFORD_CENTS = 100_000_000;

// A goal that still isn't reached after this many months at the new pace is shown as not
// reached: the pace is too small to get there.
export const MAX_GOAL_MONTHS = 600;
