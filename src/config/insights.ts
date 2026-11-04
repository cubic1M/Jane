// The insights page's range.
export const INSIGHT_MONTHS = 12;

// Past this many days with no transaction, what's on file has ended: someone who uploaded a
// statement and came back. Later months aren't months of $0, and nothing later is known.
export const DATA_ENDED_AFTER_DAYS = 14;

// A category "is up" on the money tree only when it rose by at least this much and this share
// of last month (overnight upload QA: "Uncategorized is up +$3" asked for a look).
export const CATEGORY_UP_MIN_CENTS = 2_500;
export const CATEGORY_UP_MIN_SHARE = 0.1;
