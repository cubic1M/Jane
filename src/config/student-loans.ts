// Student loans (spec step 114): the federal repayment plans' rules Jane compares, each with
// where it comes from. Checked October 2026 against the servicer pages on studentaid.gov and
// the law that created RAP (July 2025). Rules change: update these, with their sources,
// rather than code.

export const STUDENT_SOURCES = {
  plans: "https://studentaid.gov/manage-loans/repayment/plans",
  servicerPlans: "https://edfinancial.studentaid.gov/lower-payment-options",
  incomeDriven: "https://studentaid.gov/manage-loans/repayment/plans/income-driven",
  povertyGuidelines:
    "https://aspe.hhs.gov/sites/default/files/documents/b1bfa16b20ae9b89d525bc35de7c1643/detailed-guidelines-2026.pdf",
  pslf: "https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service",
} as const;

// 2026 HHS poverty guidelines, 48 contiguous states and D.C. (STUDENT_SOURCES.povertyGuidelines).
export const POVERTY_GUIDELINE_CENTS = { first: 1_596_000, eachMore: 568_000 } as const;

// Standard plan: a fixed payment over 10 years, at least $50 a month (servicerPlans).
export const STANDARD_YEARS = 10;
export const STANDARD_MIN_PAYMENT_CENTS = 5_000;

// Income-Based Repayment: 10% (first loans on or after July 1, 2014) or 15% (earlier) of
// discretionary income, the income above 150% of the poverty guideline; never more than
// the 10-year standard payment; what's left forgiven after 20 or 25 years (servicerPlans,
// incomeDriven). Jane uses the newer borrower's 10% and 20 years unless told otherwise.
export const IBR = {
  povertyMultiple: 1.5,
  share: { new: 0.1, old: 0.15 },
  forgivenAfterYears: { new: 20, old: 25 },
} as const;

// Repayment Assistance Plan (from July 1, 2026): a share of adjusted gross income a year,
// divided by 12, minus $50 a month for each dependent, at least $10 a month; forgiven after
// 30 years (servicerPlans). The share by income (the law's table: 1% for each $10,000 of
// AGI from $10,000, up to 10% above $100,000) and the interest relief (interest the payment
// doesn't cover is waived, and principal goes down by at least $50 a month with a match)
// are as the law describes them; studentaid.gov's servicer page lists "not more than 10%".
export const RAP = {
  bands: [
    { upToCents: 1_000_000, share: 0 },
    { upToCents: 2_000_000, share: 0.01 },
    { upToCents: 3_000_000, share: 0.02 },
    { upToCents: 4_000_000, share: 0.03 },
    { upToCents: 5_000_000, share: 0.04 },
    { upToCents: 6_000_000, share: 0.05 },
    { upToCents: 7_000_000, share: 0.06 },
    { upToCents: 8_000_000, share: 0.07 },
    { upToCents: 9_000_000, share: 0.08 },
    { upToCents: 10_000_000, share: 0.09 },
    { upToCents: Number.MAX_SAFE_INTEGER, share: 0.1 },
  ],
  perDependentCents: 5_000,
  minPaymentCents: 1_000,
  minPrincipalDropCents: 5_000,
  forgivenAfterYears: 30,
} as const;

// Public Service Loan Forgiveness: 120 qualifying monthly payments while working full time
// for a qualifying employer, on a qualifying plan (pslf).
export const PSLF_PAYMENTS = 120;

// The guided steps on studentaid.gov, in order, each with its official page.
export const STUDENT_STEPS = [
  {
    key: "see_loans",
    title: "See your federal loans",
    does: "Sign in to studentaid.gov with your account and open My Aid to see each loan, its servicer and its plan.",
    url: "https://studentaid.gov/aid-summary/loans",
  },
  {
    key: "simulate",
    title: "Compare plans with the Loan Simulator",
    does: "The official Loan Simulator uses your real loans to show each plan's payment.",
    url: "https://studentaid.gov/loan-simulator/",
  },
  {
    key: "apply_idr",
    title: "Apply for an income-driven plan",
    does: "The application takes about 10 minutes and can pull your income from the IRS with your consent.",
    url: "https://studentaid.gov/idr/",
  },
  {
    key: "pslf",
    title: "Working in public service? Certify your employment",
    does: "The PSLF Help Tool checks your employer and counts your qualifying payments.",
    url: "https://studentaid.gov/pslf/",
  },
  {
    key: "recertify",
    title: "Recertify your income every year",
    does: "Income-driven payments are reset each year from your income and family size.",
    url: "https://studentaid.gov/manage-loans/repayment/plans/income-driven",
  },
] as const;

// Payments seen this long ago or less count toward forgiveness tracking from transactions.
export const STUDENT_PAYMENT_LOOKBACK_DAYS = 400;

// --- The long game (spec step 225) ----------------------------------------------------------

export const LONG_GAME = {
  // PSLF needs the employer certified (the PSLF Help Tool's employment certification form) at
  // least this often, and every employer change; an income-driven plan is recertified yearly.
  certifyEveryMonths: 12,
  recertifyEveryMonths: 12,
  // A reminder this many days before either date.
  remindDays: 30,
  // A private loan is worth refinancing when an offer's rate is at least this much lower.
  refiMinDropBps: 100,
  // How many months of the PSLF count the page shows on each side of today.
  gridMonthsEachSide: 6,
  // An assumed share of forgiven debt paid as federal income tax, to size a plan for it.
  forgivenTaxRate: 0.22,
  // The tax on forgiven debt goes on the deadlines list this many years before forgiveness
  // (the deadlines list only holds dates a few years ahead).
  taxPlanYearsAhead: 2,
} as const;

export const LONG_GAME_SOURCES = {
  pslfCertify: "https://studentaid.gov/pslf/",
  forgivenTax: "https://studentaid.gov/manage-loans/forgiveness-cancellation",
  refinance: "https://studentaid.gov/understand-aid/types/loans/federal-vs-private",
  recertify: "https://studentaid.gov/manage-loans/repayment/plans/income-driven/recertify",
} as const;

// What a federal loan has that a private refinance gives up for good.
export const FEDERAL_PROTECTIONS = [
  "Public Service Loan Forgiveness and income-driven forgiveness",
  "payments tied to your income, and the option to lower them if you lose a job",
  "deferment and forbearance, and discharge if you die or become disabled",
] as const;

// The tax on forgiven debt: PSLF forgiveness isn't taxed; forgiveness under an income-driven
// plan is generally taxable as income federally from 2026 (the exclusion for it ended after
// 2025), and states may tax it too.
export const FORGIVEN_TAX = {
  pslf: { taxable: false, text: "Public Service Loan Forgiveness isn't taxed." },
  idr: {
    taxable: true,
    text: "Forgiveness under an income-driven plan is generally taxed as income federally from 2026, and some states tax it too.",
  },
} as const;
