// Money that moves itself (spec steps 144–145): transfers between the person's own accounts,
// and payments, through a money-movement partner. Until a licensed partner is connected and
// counsel signs off, a stand-in records them and moves nothing real, and only for people
// whose data is the demo bank. Turning on real money movement is a code change, never an
// env var.
export const REAL_MONEY_MOVEMENT = false;

export const STAND_IN_PARTNER = "Simulated transfers (no real money moves)";

// A transfer runs this many days after it's scheduled, and can be undone until then.
export const TRANSFER_DELAY_DAYS = 1;

// Safe to spend keeps at least this much after any move (spec step 144): money it needs is
// never moved.
export const PAYCHECK_CUSHION_CENTS = 10_000;
// A paycheck this recent gets a plan; older ones are left alone.
export const PAYCHECK_PLAN_DAYS = 3;
// Paychecks in a month, for each goal's share of its monthly amount, when the pay pattern
// isn't clear.
export const DEFAULT_PAYCHECKS_PER_MONTH = 2;
// A move smaller than this isn't worth a transfer.
export const MIN_MOVE_CENTS = 500;
// Goals whose name marks them as the tax set-aside (Taxes' autopilot) rather than Goals'.
export const TAX_GOAL_PATTERN = /^Taxes set aside/i;
