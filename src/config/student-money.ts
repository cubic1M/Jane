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
  // Two bill payments this close together are a quarter paid in parts, not at once.
  monthlyGapDays: 40,
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

// --- Overdraft coverage -----------------------------------------------------------------------
// Regulation E, 12 CFR 1005.17: a bank can't charge an overdraft fee on an ATM withdrawal or a
// one-time debit card purchase unless the person opted in, and the choice can be changed at any
// time (the CFPB's consumer page: opted out, the card is declined instead, with no fee).
export const OVERDRAFT_OPT_IN = {
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/17/",
  // Its consumer page, in the words the card uses (archived, last modified 2026-06-25).
  consumerUrl:
    "https://www.consumerfinance.gov/whats-your-status-when-it-comes-to-overdraft-coverage",
} as const;

// --- A credit file that hasn't started --------------------------------------------------------
// The CFPB's "Building credit from scratch": a secured card's deposit ranges from $50 to $300 and
// becomes the credit line (ask whether the issuer reports to the credit bureaus); a credit-builder
// loan, typically at a credit union, holds $300 to $1,000 in a locked savings account repaid over
// 6 to 24 months, and the money comes back at the end; the credit report is free at
// annualcreditreport.com.
export const CREDIT_START = {
  url: "https://files.consumerfinance.gov/f/documents/201612_cfpb_credit_invisible_checklist.PDF",
  securedDepositCents: { from: 5_000, to: 30_000 },
  builderLoanCents: { from: 30_000, to: 100_000 },
  builderLoanMonths: { from: 6, to: 24 },
  reportUrl: "https://www.annualcreditreport.com",
  // At least this much data before "no card or loan seen" means anything.
  minDays: 30,
} as const;

// A payment to a card or a lender, by its words (a card paid from checking files as a transfer
// at some banks).
export const CREDIT_PAYMENT_WORDS =
  /CREDIT CA?RD|\bCRD\b|CARD ?(?:PMT|PAYMENT|AUTOPAY)|\bAMEX\b|AMERICAN EXPRESS|DISCOVER|CAPITAL ONE|CITI ?CARD|APPLE ?CARD|SYNCHRONY|\bLOAN\b|NELNET|MOHELA|AIDVANTAGE|SALLIE MAE|NAVIENT/;

// --- A student account at the same bank -------------------------------------------------------
// Each bank's own page, read 2026-11-18:
// - Chase Secure Banking: "$4.95 OR $0" a month, $0 for "an account owner who is 17-24 years old";
//   "There are no overdraft fees with a Chase Secure Banking account."
// - Bank of America Advantage SafeBalance Banking: "no monthly fee if under age 25" and "no
//   Overdraft Item Fees".
// - Wells Fargo Everyday Checking: a $15 monthly service fee, avoided when "The primary account
//   owner is 17 - 24 years old".
export const STUDENT_ACCOUNTS = [
  {
    bank: "Chase",
    words: /\bCHASE\b|JPMORGAN/,
    account: "Chase Secure Banking",
    rule: "no monthly fee for an owner aged 17 to 24, and no overdraft fees",
    ages: { from: 17, to: 24 },
    noOverdraftFees: true,
    url: "https://personal.chase.com/personal/secure-banking",
  },
  {
    bank: "Bank of America",
    words: /BANK OF AMERICA|\bBOFA\b|\bB OF A\b|ADV(?:ANTAGE)? ?PLUS|ADV(?:ANTAGE)? RELATIONSHIP/,
    account: "Bank of America Advantage SafeBalance Banking",
    rule: "no monthly fee for an owner under 25, and no overdraft item fees",
    ages: { from: 0, to: 24 },
    noOverdraftFees: true,
    url: "https://www.bankofamerica.com/deposits/checking/advantage-banking/",
  },
  {
    bank: "Wells Fargo",
    words: /WELLS ?FARGO/,
    account: "Wells Fargo Everyday Checking",
    rule: "its $15 monthly fee waived for a primary owner aged 17 to 24",
    ages: { from: 17, to: 24 },
    noOverdraftFees: false,
    url: "https://www.wellsfargo.com/checking/everyday/",
  },
] as const;

// A checking account's own monthly fee, by its words.
export const MONTHLY_FEE_WORDS =
  /MONTHLY (?:MAINTENANCE|SERVICE|ACCOUNT) (?:FEE|CHARGE)|MAINTENANCE FEE|MONTHLY FEE|SERVICE CHARGE/;
// A monthly fee charged this recently says it's still charged.
export const MONTHLY_FEE_SEEN_DAYS = 62;
