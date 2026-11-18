// Student money facts the suggest-money detectors state (src/detectors/student-money.ts). Every
// figure and date was read at its source on the day given; a fact that couldn't be confirmed
// there isn't here (the notes list what was skipped). Stanford is named only to state a fact
// about Stanford's own bill and programs, never as if it endorses Jane.

// Everything below was read at its source on 2026-11-18.

// --- Stanford's student bill ------------------------------------------------------------------
// studentservices.stanford.edu, "Billing Dates & Deadlines", the 2026-27 due dates. Each quarter
// is billed in three monthly parts; these are the due dates the page lists.
export const STANFORD_BILL = {
  url: "https://studentservices.stanford.edu/my-finances/understand-your-student-bill-and-payment-system/billing-dates",
  dueDates: {
    undergraduate: [
      "2026-09-20",
      "2026-10-20",
      "2026-11-20",
      "2026-12-17",
      "2027-01-20",
      "2027-02-20",
      "2027-03-20",
      "2027-04-20",
      "2027-05-20",
      "2027-06-20",
      "2027-07-20",
      "2027-08-20",
    ],
    graduate: [
      "2026-10-20",
      "2026-11-20",
      "2027-01-20",
      "2027-02-20",
      "2027-04-20",
      "2027-05-20",
      "2027-07-20",
      "2027-08-20",
    ],
  },
  // The Financial Responsibility Agreement: "late payment and/or finance charges at the rate of
  // 1.00% per month" on the past-due portion, and a financial hold that blocks registering and
  // the diploma.
  lateBpsPerMonth: 100,
  agreementUrl:
    "https://studentservices.stanford.edu/my-finances/understand-your-student-bill-payment-system/financial-responsibility-agreement",
} as const;

// The undergraduate payment plan (same site, "Payment Plans"): free to sign up, a quarter's bill in
// three parts, for matriculated undergraduates enrolled this term with a US bank account and no
// prior-term balance. Sign-up windows as the page lists them (no year given; this academic year's);
// none in summer, and autumn 2027's isn't listed yet.
export const STANFORD_PAYMENT_PLAN = {
  url: "https://studentservices.stanford.edu/my-finances/understand-your-student-bill-and-payment-system/make-payment/payment-plans",
  windows: [
    { quarter: "Winter", from: "2026-11-25", to: "2026-12-16" },
    { quarter: "Spring", from: "2027-02-25", to: "2027-03-19" },
  ],
} as const;

// Graduate students (studentservices.stanford.edu, "Stipends & Cash Advances"): an advance on
// expected funding, $1,000 to $4,000 a quarter, repaid within 45 days, for an active degree-seeking
// graduate student with no hold and direct deposit set up. Assistants can also pay their bill
// from their pay (the Payroll Deduction Plan, on the payment plans page above).
export const STANFORD_GRAD_ADVANCE = {
  url: "https://studentservices.stanford.edu/my-finances/manage-your-funding/funding-and-scholarships/stipends-cash-advances",
  minCents: 100_000,
  maxCents: 400_000,
  repayDays: 45,
} as const;

// The Opportunity Fund (flissc.stanford.edu): for undergraduates whose parent contribution is
// $3,500 or less, enrolled, who completed its annual Canvas course; graduate and coterm students
// can't apply. 2026-27 windows as listed.
export const OPPORTUNITY_FUND = {
  url: "https://flissc.stanford.edu/opportunity-fund",
  parentContributionMaxCents: 350_000,
  windows: [
    { term: "Fall", from: "2026-09-25", to: "2026-12-04" },
    { term: "Winter", from: "2027-01-08", to: "2027-03-26" },
    { term: "Spring", from: "2027-04-02", to: "2027-05-28" },
    { term: "Summer", from: "2027-07-02", to: "2027-08-31" },
  ],
} as const;

// --- Federal student loans --------------------------------------------------------------------
// studentaid.gov "Interest Rates and Fees": fixed rates for Direct Loans first disbursed July 1,
// 2026 to June 30, 2027, and the loan fees for those first disbursed Oct 1, 2020 to Oct 1, 2027.
// studentaid.gov "One Big Beautiful Bill Act – Important Definitions" (updated Oct 30, 2026): the
// annual limits from July 1, 2026; Direct PLUS loans for graduate students are no longer
// available (an interim exception keeps some on the old limits).
export const FEDERAL_LOANS = {
  ratesUrl: "https://studentaid.gov/understand-aid/types/loans/interest-rates",
  limitsUrl: "https://studentaid.gov/announcements-events/big-updates/definitions",
  undergradRateBps: 652,
  gradRateBps: 807,
  plusRateBps: 907,
  directFeeBps: 105.7,
  plusFeeBps: 422.8,
  // Dependent undergraduates, by year in school; the most of it that can be subsidized.
  dependentLimits: [
    { year: "first", cents: 550_000, subsidizedCents: 350_000 },
    { year: "second", cents: 650_000, subsidizedCents: 450_000 },
    { year: "third and later", cents: 750_000, subsidizedCents: 550_000 },
  ],
  gradUnsubsidizedCents: 2_050_000,
  parentPlusPerStudentCents: 2_000_000,
} as const;

// --- When a bill ahead won't be covered ------------------------------------------------------
export const BILL_GAP = {
  // How far ahead a bill is looked at: the next one inside this many days.
  aheadDays: 45,
  // A gap smaller than this is a timing wobble, not borrowing.
  minGapCents: 10_000,
  // A Stanford bill payment seen this recently says the person pays the bill themselves.
  billSeenDays: 130,
  // The smallest payment that reads as a bill, not a fee or a printing charge.
  billMinCents: 50_000,
} as const;

// A line paying Stanford's student bill, and lines that name Stanford but aren't the university
// billing a student (its hospital, credit union and shopping centre).
export const STANFORD_BILL_WORDS =
  /STANFORD.*(?:STUDENT ?(?:ACC(?:OUN)?T|BILL|FIN)|TUITION|E-?PAY|BILL ?PAY|WEB ?PMT)|(?:TUITION|STUDENT ACCOUNT).*STANFORD/;
export const STANFORD_WORDS = /\bSTANFORD\b/;
export const NOT_STANFORD_UNIVERSITY =
  /STANFORD (?:HEALTH|HOSPITAL|CHILDREN|MEDICINE|FED(?:ERAL)?|FCU|CREDIT|SHOPPING|BLOOD)|SFCU/;
// How many lines must name Stanford (paid or paying) before Jane says "your Stanford bill".
export const STANFORD_MIN_LINES = 2;

// --- Card interest while cash sits ------------------------------------------------------------
export const CARD_VS_CASH = {
  // Cash left in checking and savings after paying the card: a month of spending, never less
  // than this.
  keepFloorCents: 50_000,
  // Only when what cash could clear is at least this much of a card balance.
  minClearCents: 20_000,
} as const;
