// How money movement starts, once it's allowed at all (Stage 3 of the roadmap, Phase P of the spec).
// REAL_MONEY_MOVEMENT (./money-movement.ts) stays false until a licensed partner and counsel's
// sign-off, and nothing here turns it on. PAYMENT_REHEARSAL=1 walks this on the demo bank.
export const PAYMENT_ROLLOUT = {
  // Step 1: "Jane prepares, you pay": no partner, no money near Jane (connector plan).
  // Step 2: card and bill payments through a partner, a yes on every payment.
  bills: true,
  // Step 3: then cash between the person's own accounts.
  ownAccounts: false,
  // Step 4: only then, payments under a cap with no yes each time.
  underCap: false,
} as const;

export const paymentRehearsal = () => process.env.PAYMENT_REHEARSAL === "1";

// A prepared payment counts as paid when a debit this close to the amount shows up, from this many
// days before its day. FOR REVIEW.
export const PREPARED_AMOUNT_TOLERANCE = 0.01;
export const PREPARED_EARLY_DAYS = 3;
// How long before its day the person is reminded.
export const PREPARED_REMIND_DAYS = 3;

// A payment can come back after it settled: returns arrive up to about 60 days later (Dwolla's docs;
// Spinwheel: APPLIED can still become FAILED or RETURNED). Watched this long.
export const RETURN_WATCH_DAYS = 60;
