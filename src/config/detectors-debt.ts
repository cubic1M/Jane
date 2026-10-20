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
  // Card use: the share of limits in use at or above which the reported balance hurts the score.
  utilisationHigh: 0.3,
  // Pay in 4 and other pay-later plans: this many installments in the year is a habit.
  bnplPaymentsMin: 3,
  // Medical bills: care paid for this much in the year is worth asking about (an itemized bill,
  // financial assistance, a no-interest plan), and the share people usually get off by asking.
  medicalMinCents: 50_000,
  medicalAskShare: 0.2,
  // Collection agencies a payment goes to: a debt on the credit report that can be checked.
  collectorPayee:
    /\b(?:portfolio recovery|midland (?:credit|funding)|encore capital|lvnv|cavalry|asset acceptance|collection|collections|recovery (?:assoc|services)|credit collection)\b/i,
  // Public Service Loan Forgiveness: a public-service employer, and the number of payments.
  publicEmployer:
    /\b(?:school|schools|district|county|city of|state of|library|university|college|hospital|health system|department|dept|u\.?s\.? (?:army|navy|air force)|public)\b/i,
  pslfPayments: 120,
  // Money sent through a payment app that might be a loan to family or friends: this much or more.
  familyLoanMinCents: 20_000,
  paymentApp: /\b(?:venmo|zelle|cash ?app|paypal)\b/i,
} as const;
