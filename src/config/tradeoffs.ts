// Goals that trade off openly (spec step 241): when the goals together need more each month
// than the year plan has room for, each choice's dates, a suggested order and the reason.

// Orders tried exhaustively up to this many goals; beyond it, by target date and by size.
export const TRADEOFF_MAX_PERMUTE = 5;
// The most months a goal is projected ahead before it's "later than I can see".
export const TRADEOFF_HORIZON_MONTHS = 120;
// A slip of this many months or fewer isn't called a delay.
export const TRADEOFF_NOTICEABLE_MONTHS = 1;
// The remembered fact holding the person's chosen order (goal ids, first first).
export const GOAL_ORDER_FACT = "goal_order";
