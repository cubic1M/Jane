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

// --- Bills paid on time (spec step 145) ---------------------------------------------------
// A payment is scheduled this many days before its due date (never before tomorrow).
export const BILL_PAY_LEAD_DAYS = 2;
// Due dates this far ahead get a payment planned.
export const BILL_PAY_HORIZON_DAYS = 21;
// The payment that covers a bill: the regular payment from checking in this category (the
// person's own autopay), by the kind of debt.
export const BILL_PAYMENT_CATEGORIES: Readonly<Record<string, string>> = {
  credit: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  mortgage: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  student: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
  loan: "LOAN_PAYMENTS_CAR_PAYMENT",
};
// Checking keeps at least this much on every day of the forecast after a payment: a
// payment is never scheduled that would overdraw it, nor eat the safe-to-spend cushion.
export const BILL_PAY_MIN_LEFT_CENTS = PAYCHECK_CUSHION_CENTS;

// --- Every paycheck sent where it should go (spec step 206) -------------------------------
// Checking keeps at least this much above the forecast's lowest point over the coming month
// after a paycheck's moves, so a dip before the next paycheck never overdraws it.
export const PAYCHECK_BUFFER_MARGIN_CENTS = 20_000;
// The forecast looked at when working out that lowest point.
export const PAYCHECK_FORECAST_DAYS = 30;
