// A steady paycheck from uneven income (spec step 240): for freelancers and commission earners,
// every deposit is set aside for tax and lands in a buffer (the savings account), and a steady
// "paycheck" goes from the buffer to checking each month. These are the numbers.

// The buffer Jane aims for, in months of the person's spending, and the floor it never goes
// below (the paycheck stops before that).
export const BUFFER_TARGET_MONTHS = 3;
export const BUFFER_FLOOR_MONTHS = 1;
// The paycheck is this share of the average monthly income after tax set-aside, before the
// buffer's level moves it.
export const STEADY_SHARE = 0.9;
// Months of deposits averaged (up to).
export const STEADY_MONTHS = 12;
// A buffer above/below its target moves the paycheck by this share of the gap each month...
export const BUFFER_ADJUST_SHARE = 1 / 6;
// ...but never by more than this share of the usual paycheck.
export const MAX_ADJUST_SHARE = 0.25;
// Fewest months of deposits before a steady paycheck is worked out.
export const MIN_STEADY_MONTHS = 3;
// A move smaller than this isn't worth a transfer.
export const MIN_STEADY_MOVE_CENTS = 5_000;
// The person saying their income is uneven (a remembered fact with this key).
export const UNEVEN_INCOME_FACT = "uneven_income";
