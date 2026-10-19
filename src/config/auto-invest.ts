// Automatic investing (spec step 134): an amount every payday, or what's left after bills
// and goals, through the brokerage partner (the simulation until a real one is
// connected). Safe to spend always comes first.

// Safe to spend never goes below this because of investing: Jane pauses instead.
export const SAFE_TO_SPEND_FLOOR_CENTS = 100_000;
// Less than this isn't worth investing: the payday is paused instead.
export const MIN_CONTRIBUTION_CENTS = 2_500;
// "The rest after bills and goals" invests this share of what's safe to spend above the
// floor, and never more than the cap, so a big month doesn't empty checking.
export const LEFTOVER_SHARE = 0.5;
export const MAX_CONTRIBUTION_CENTS = 200_000;
// The amounts offered when Jane suggests starting: a round number, a share of the
// paycheck.
export const SUGGESTED_PAYCHECK_SHARE = 0.05;
export const SUGGESTED_ROUND_CENTS = 2_500;
// A deposit counts as a paycheck from this much.
export const MIN_PAYCHECK_CENTS = 50_000;
// Paychecks this old or older don't start a contribution (a new plan starts at the next).
export const PAYCHECK_LOOKBACK_DAYS = 7;
