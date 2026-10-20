// Numbers the debt and credit detectors (spec step 260) use. Never inline in src/detectors.
// Kept apart from src/config/detectors.ts so lanes adding detectors don't collide.

export const DEBT_DETECTOR_RATES = {
  // Student loans: an income-driven plan's payment is roughly this share of a month's income
  // (the plans' own formulas are in src/config/student-loans.ts; this is the screen that asks
  // whether to run them). A payment well above it is worth comparing.
  studentIdrShare: 0.07,
  studentPaymentsMin: 3,
  studentMinGapCents: 5_000,
  // A car payment this share of income or more is worth a look at the loan and its add-ons.
  autoPaymentShare: 0.15,
  autoPaymentsMin: 6,
  // A refinance typically takes this much off a car loan's rate for someone with a car payment
  // this heavy (the stand-in lender catalog's own spread).
  autoRefiGapBps: 200,
  // A dealer add-on: a payment this big or bigger with GAP, warranty or service-contract words.
  addonMinCents: 20_000,
  // Card cash advances: one is enough.
  cashAdvanceMin: 1,
  // Interest on a cash advance starts at once, at this rate, for about this many days.
  cashAdvanceAprBps: 2_999,
  cashAdvanceDays: 30,
  // Extra money on a mortgage: the loan's rate at least this, and at least this much cash beyond
  // what's kept. Paying down earns the mortgage rate for certain; the alternative is the high-yield
  // rate in src/config/detectors.ts.
  mortgageExtraMinBps: 500,
  mortgageExtraMinExcessCents: 1_000_000,
  // A 0% balance transfer: card interest of at least this in the year on a balance of at least this,
  // and the transfer fee as a share of the balance.
  transferMinInterestCents: 30_000,
  transferMinBalanceCents: 150_000,
  transferFeeShare: 0.03,
} as const;
