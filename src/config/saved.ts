// What Jane saved you (spec step 139): savings proven by the person's own transactions,
// kept apart from estimates, and a total they can share.

// A lower bill counts once a charge from the same company, this long after the work was
// done, is below the old price.
export const LOWER_BILL_LOOK_DAYS = 120;
// A cancellation counts once its next charge is this many days overdue and never came.
export const CANCEL_GRACE_DAYS = 5;

// Jane says so in the chat when the confirmed total passes each of these, once.
export const SAVED_MILESTONES_CENTS: readonly number[] = [
  5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
];

// A shared total stays up until the person takes it down.
export const SHARE_TOKEN_BYTES = 18;
