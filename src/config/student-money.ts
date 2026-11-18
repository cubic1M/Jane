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

// --- What Stanford gives its people free ------------------------------------------------------
// Stanford Libraries' newspapers guide (guides.library.stanford.edu/c.php?g=1021986, updated
// 2026-11-17): The New York Times (not Games, Cooking, Podcasts or The Athletic; a paid subscriber
// must cancel before activating), The Wall Street Journal, The Washington Post, The Atlantic and
// Bloomberg.com, free with a SUNet ID. UIT (uit.stanford.edu/service/softwarelic/ms, licence
// 11/1/23 to 10/31/28): Microsoft 365 free for faculty, staff and students on up to five
// computers, five tablets and five phones.
export const STANFORD_FREE = [
  {
    name: "The New York Times",
    words: /NYTIMES|NEW YORK TIMES|\bNYT\b/,
    // Games, Cooking and The Athletic aren't in Stanford's access.
    notWords: /GAMES|COOKING|ATHLETIC|CROSSWORD|WORDLE/,
    how: "activate it at accessnyt.com with your Stanford email (cancel the paid one first; Games, Cooking and The Athletic aren't included)",
    url: "https://guides.library.stanford.edu/c.php?g=1021986",
  },
  {
    name: "The Wall Street Journal",
    words: /\bWSJ\b|WALL STREET JOURNAL|DOW JONES/,
    notWords: null,
    how: "create a WSJ account with your Stanford email through the library's WSJ page",
    url: "https://guides.library.stanford.edu/c.php?g=1021986",
  },
  {
    name: "The Washington Post",
    words: /WASHINGTON ?POST|WAPO/,
    notWords: null,
    how: "sign in at washingtonpost.com with your Stanford email",
    url: "https://guides.library.stanford.edu/c.php?g=1021986",
  },
  {
    name: "The Atlantic",
    words: /THE ATLANTIC|ATLANTIC MONTHLY|THEATLANTIC/,
    notWords: null,
    how: "open it through SearchWorks, signed in with your SUNet ID",
    url: "https://guides.library.stanford.edu/c.php?g=1021986",
  },
  {
    name: "Bloomberg",
    words: /BLOOMBERG/,
    notWords: null,
    how: "connect through the Business Library's Bloomberg page with your Stanford email",
    url: "https://guides.library.stanford.edu/c.php?g=1021986",
  },
  {
    name: "Microsoft 365",
    words: /MICROSOFT ?\*? ?365|MICROSOFT\*OFFICE|OFFICE ?365|MSFT ?\* ?(?:365|OFFICE)/,
    notWords: null,
    how: "install it free with your Stanford Microsoft 365 account (up to five computers, five tablets and five phones)",
    url: "https://uit.stanford.edu/service/softwarelic/ms",
  },
  // uit.stanford.edu/service/zoom (modified 2026-09-02): free for current students, faculty and staff.
  {
    name: "Zoom",
    words: /\bZOOM\.?(?:US|COM| VIDEO| COMMUNICATIONS| WORKPLACE| PRO)\b|ZOOM\.US/,
    notWords: null,
    how: "sign in at stanford.zoom.us with your SUNet ID",
    url: "https://uit.stanford.edu/service/zoom",
  },
] as const;
// A charge under this reads as monthly when only one is seen; at or over it, as a year's.
export const FREE_SERVICE_YEARLY_FROM_CENTS = 5_000;
// Charges this recent say the person still pays.
export const FREE_SERVICE_SEEN_DAYS = 400;

// Stanford Transportation, "Caltrain GoPass for Commuting Graduate Students": free for an active,
// degree-seeking graduate student whose residence isn't in 94304, 94305 or 94309 and is within
// commuting range; requested with a Clipper card number; scheduled through August 2027.
export const GRAD_GOPASS = {
  url: "https://transportation.stanford.edu/getting-stanford/public-transit/caltrain-gopass/caltrain-gopass-commuting-graduate-students",
  formUrl: "https://transportation-forms.stanford.edu/transit-pass-grads/",
  until: "2027-08-31",
  words: /CALTRAIN/,
  // At least this many Caltrain fares, in the last 90 days.
  minFares: 2,
} as const;

// --- Cardinal Care ----------------------------------------------------------------------------
// financialaid.stanford.edu (grad subsidy page): $8,808 for 2026-27; Stanford pays all of it
// ($2,936 a quarter) for a graduate student on a 25%-or-more assistantship who hasn't waived it,
// half for one under 25%. stanford.myahpcare.com/waiver: windows for 2026-27, an outside plan must
// meet Minimum Essential Coverage, a deductible and an out-of-pocket maximum of $10,600 or less
// for one person, and cover inpatient and outpatient care in the Bay Area; short-term, travel and
// dental-only plans can't be used; a decision within 10 business days.
export const CARDINAL_CARE = {
  yearCents: 880_800,
  quarterCents: 293_600,
  costUrl: "https://financialaid.stanford.edu/grad/funding/programs/subsidy.html",
  waiverUrl: "https://stanford.myahpcare.com/waiver",
  maxDeductibleCents: 1_060_000,
  windows: [
    { who: "continuing and autumn students", from: "2026-08-14", to: "2026-09-15" },
    { who: "students starting in winter", from: "2026-11-18", to: "2026-12-15" },
    { who: "students starting in spring", from: "2027-02-24", to: "2027-03-15" },
  ],
} as const;
// A health plan's premium, by its words: the insurers a student's own or family plan is with.
export const HEALTH_PREMIUM_WORDS =
  /BLUE SHIELD|BLUE CROSS|ANTHEM|KAISER|AETNA|CIGNA|UNITED ?HEALTH|UHC|HEALTH ?NET|OSCAR|COVERED ?CALIFORNIA|MOLINA|SUTTER HEALTH PLUS|WESTERN HEALTH/;
// At least this many premium payments in the last 120 days.
export const HEALTH_PREMIUM_MIN = 1;
// One premium payment this size or more reads as a term's or a year's, not a month's.
export const HEALTH_PREMIUM_ONCE_FROM_CENTS = 150_000;

// --- Two plans protecting one phone -----------------------------------------------------------
// A maker's plan and a carrier's or a third party's, each paid monthly.
export const DEVICE_PLANS = [
  { name: "AppleCare", words: /APPLECARE/ },
  {
    name: "your carrier's protection",
    words:
      /PROTECTION ?360|P360|MOBILE PROTECT|TOTAL MOBILE PROTECTION|PROTECT ADVANTAGE|DEVICE PROTECT|ASURION/,
  },
  { name: "Samsung Care+", words: /SAMSUNG CARE/ },
] as const;

// --- A grace period ending --------------------------------------------------------------------
// studentaid.gov ("Subsidized and Unsubsidized Loans", read 2026-11-18): "you'll have a six-month
// grace period before you are required to begin repayment"; the servicer tells you the first due
// date. Plaid reports the status "in grace" and its end date.
export const GRACE_ENDING = {
  url: "https://studentaid.gov/understand-aid/types/loans/subsidized-unsubsidized",
  // Told this many days before the grace period ends.
  aheadDays: 120,
  // "now" this close.
  urgentDays: 30,
  // Standard's term, to show what a level payment would be.
  standardMonths: 120,
} as const;

// --- Clipper START ----------------------------------------------------------------------------
// clipperstartcard.com/s/faqs (MTC, read 2026-11-18): 50% off single rides on Bay Area operators
// (BART, Caltrain, Muni, VTA, SamTrans, AC Transit and others) for someone aged 19 to 64 living in
// the nine Bay Area counties, with household income at or under 200% of the 2026 poverty level, and
// no Clipper Access card. A CalFresh/EBT card qualifies on its own; proof is a tax return's AGI or a
// benefits card.
export const CLIPPER_START = {
  url: "https://www.clipperstartcard.com/s/faqs",
  applyUrl: "https://www.clipperstartcard.com/s/",
  discount: 0.5,
  ages: { from: 19, to: 64 },
  // Household size: the yearly income limit.
  incomeLimitCents: [
    3_192_000, 4_328_000, 5_464_000, 6_600_000, 7_736_000, 8_872_000, 10_008_000, 11_144_000,
  ],
  fareWords:
    /CLIPPER|CALTRAIN|\bBART\b|\bVTA\b|SFMTA|\bMUNI\b|SAMTRANS|AC TRANSIT|GOLDEN GATE (?:TRANSIT|FERRY)|SF BAY FERRY/,
  // Fares that aren't single rides (a monthly pass) or already discounted aren't told apart: the
  // card counts what was paid, at this many fares or more in 90 days.
  minFares: 3,
} as const;

// --- Stanford's aid priority date -------------------------------------------------------------
// financialaid.stanford.edu, continuing U.S. undergraduates (updated 2026-09-18): the CSS Profile
// (code 4704) and FAFSA (code 001305) for 2027-28 open October 1, priority filing date April 30;
// with the Profile and the tax documents done by April 30, an aid notice comes in August.
export const AID_PRIORITY = {
  url: "https://financialaid.stanford.edu/undergrad/apply/requirements/continuing_us.html",
  date: "2027-04-30",
  year: "2027-28",
  // Told from this many days before.
  aheadDays: 75,
  cssCode: "4704",
  fafsaCode: "001305",
} as const;
// Money from Stanford that isn't pay: an aid refund or disbursement.
export const STANFORD_AID_WORDS =
  /STANFORD.*(?:REFUND|FIN(?:ANCIAL)? ?AID|DISBURSE|SCHOLARSHIP)|(?:REFUND|FINANCIAL AID).*STANFORD/;

// --- Phase 2: facts for real accounts where the advice card is demo-only ----------------------
// Stanford's 2026-27 residence agreement (rde.stanford.edu, read 2026-11-18): "The university does
// not carry insurance covering personal property", and "it is advisable that you obtain your own
// renter's insurance to cover your personal property in the event of damage or loss"; residents
// are responsible for damage to university property, and jointly when no one person is.
export const STANFORD_HOUSING = {
  url: "https://rde.stanford.edu/studenthousing/residence-agreement-policies-and-procedures-2026-27",
} as const;
// The NAIC's average renters (HO-4) premium for 2022, the latest year published, via the Insurance
// Information Institute (iii.org/fact-statistic/facts-statistics-renters-insurance, read
// 2026-11-18): $171 in the US, $169 in California (California's from its Department of Insurance).
export const RENTERS_AVERAGE = {
  url: "https://www.iii.org/fact-statistic/facts-statistics-renters-insurance",
  year: 2022,
  usCents: 17_100,
  byState: { CA: 16_900 } as Readonly<Record<string, number>>,
} as const;
// The NAIC's average auto insurance expenditure for 2023 via the Insurance Information Institute
// (iii.org/fact-statistic/facts-statistics-auto-insurance, read 2026-11-18): $1,282 in the US. No
// state figure on that page, so only the US one is said.
export const AUTO_AVERAGE = {
  url: "https://www.iii.org/fact-statistic/facts-statistics-auto-insurance",
  year: 2023,
  usCents: 128_200,
  // Said only when what the person pays is at least this much above it.
  aboveShare: 0.1,
} as const;
export const AUTO_PREMIUM_WORDS =
  /GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|FARMERS|MERCURY INS|AAA\b|CSAA|LIBERTY MUTUAL|NATIONWIDE|USAA|TRAVELERS|ROOT INS|WAWANESA|\bAUTO INS/;
// The Federal Reserve's G.19 (release of 2026-11-06, read 2026-11-18): commercial banks' average
// rate on credit card plans for accounts assessed interest, 22.36%, and on 24-month personal
// loans, 11.90%, both August 2026.
export const FED_RATES = {
  url: "https://www.federalreserve.gov/releases/g19/current/default.htm",
  month: "August 2026",
  cardBps: 2_236,
  personalLoanBps: 1_190,
  // A card's rate this far above the average is worth a call.
  aboveBps: 200,
  minBalanceCents: 50_000,
} as const;

// --- A cheaper plan of the same service -------------------------------------------------------
// A cheaper plan of the same service, as the service's own page prices it (read 2026-11-18):
// - Netflix's help centre, "Plans and pricing" (help.netflix.com/en/node/24926): Standard with ads
//   $8.99 a month, Standard $19.99, Premium $26.99, in the US.
// - OpenAI's ChatGPT pricing page (chatgpt.com/pricing): Go $8 a month, Plus $20, Pro from $100.
export const CHEAPER_PLANS = [
  {
    service: "Netflix",
    words: /NETFLIX/,
    plan: "Standard with ads",
    cents: 899,
    differs: "ads, screens at once and picture quality",
    where: "Netflix's Account page lists each plan under Change plan",
    url: "https://help.netflix.com/en/node/24926",
  },
  {
    service: "ChatGPT",
    // The subscription, not API usage billed to a developer account.
    words: /CHATGPT|OPENAI\b.*\bSUBSCR/,
    plan: "Go",
    cents: 800,
    differs: "which models and how much use each includes",
    where: "ChatGPT's settings list each plan under your account's plan",
    url: "https://chatgpt.com/pricing/",
  },
] as const;
// Sales tax on the cheaper plan's price, so someone already on it isn't told about it.
export const CHEAPER_PLAN_TAX_ROOM = 1.15;
// A charge this recent says the person still pays.
export const CHEAPER_PLAN_SEEN_DAYS = 45;
// T-Mobile's plans page (t-mobile.com/cell-phone-plans, read 2026-11-18): for one line, T-Mix
// Standard $55 a month, More $75 and Loaded $95 with AutoPay, each $10 more without, plus taxes
// and fees. A bill over this many cents is likely more than one line, so nothing is said.
export const TMOBILE_PLANS = {
  url: "https://www.t-mobile.com/cell-phone-plans",
  cheapestCents: 5_500,
  autopayCents: 1_000,
  words: /T-?MOBILE/,
  notWords: /PROTECTION|P360|INSURANCE|HOME INTERNET/,
  taxRoom: 1.15,
  oneLineMaxCents: 11_000,
} as const;

// Chase's overdraft FAQ (chase.com/personal/checking/overdraft-services/faqs, read 2026-11-18): a
// $34 Overdraft Fee; with Chase Overdraft Assist, none if overdrawn by $50 or less at the end of the
// business day, or if the balance is brought back to that by 11 PM ET the next business day.
// Not on Chase First, High School or Secure Checking.
export const CHASE_OVERDRAFT = {
  url: "https://www.chase.com/personal/checking/overdraft-services/faqs",
  graceCents: 5_000,
  words: /\bCHASE\b|JPMORGAN/,
} as const;
