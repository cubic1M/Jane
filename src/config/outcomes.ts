// The verified savings record (src/lib/outcomes.ts, src/planning/outcomes.ts): how long Jane
// waits for a saving to show in the person's transactions, and how sure each kind of evidence
// is. All marked FOR REVIEW: they decide what counts as confirmed, never what is shown as a
// saving before it is.

// A charge that should have stopped: the next one was due this many days after the last, plus
// this grace for a bank to post it late.
export const STOP_GRACE_DAYS = 7;
// A charge of at least this share of the usual amount counts as the same charge coming back.
export const SAME_CHARGE_SHARE = 0.5;
// A bill counts as lower when it comes in under this share of the price before.
export const LOWER_BILL_SHARE = 0.97;
// A refund counts when a credit of at least this share of what was asked for arrives.
export const REFUND_MIN_SHARE = 0.5;
// How long after acting each kind of saving can take to show; after this with nothing, it is
// "not seen" (a fee or a bill still charged in full, no refund).
export const WATCH_DAYS = { charge_stops: 75, bill_drops: 75, refund: 60, fee_stops: 60 } as const;
// Fees: the days after acting that are compared with the month before.
export const FEE_COMPARE_DAYS = 60;

// Confirmed versus partial: what the transactions show against what was expected.
export const CONFIRMED_SHARE = 0.8;

// How sure each kind of evidence is, a whole percentage, shown beside the confirmed figure.
export const VERIFIED_PERCENT = {
  // The next charge was due and never came: one missed cycle, then two.
  charge_stopped: 85,
  charge_stopped_twice: 95,
  // A lower bill arrived from the same payee.
  bill_dropped: 90,
  // The money came back from the payee.
  refund_seen: 95,
  // No fees of that kind since acting, over FEE_COMPARE_DAYS.
  fees_stopped: 80,
  // Fewer fees, not none.
  fees_fewer: 65,
} as const;
