// Taxes for students and first-job earners (suggest-taxes, 11-18): money that arrives with nothing
// withheld (a fellowship, gig pay), the credits a student commonly misses, the paycheck withholding
// a part-year job gets wrong, and the dates that cost money. Every figure here was read at its source
// on the day given; a figure that could not be confirmed is not here (the suggest-taxes notes list
// them). The federal figures that already live in ./tax-rates.ts are reused from there: READ lists
// the ones this lane checked against the source too. Money in cents, rates as fractions.

export type Source = { url: string; read: string; what: string };

const READ_ON = "2026-11-18";
const src = (url: string, what: string): Source => ({ url, read: READ_ON, what });

export const SOURCES = {
  pub505: src(
    "https://www.irs.gov/publications/p505",
    "Pub. 505 (2026): who must pay estimated tax ($1,000; 90% of 2026 or 100% of 2025), the no-2025-liability exception, 110% over $150,000 AGI, the four 2026 due dates",
  ),
  form1040es: src(
    "https://www.irs.gov/pub/irs-pdf/f1040es.pdf",
    "Form 1040-ES (2026): due 4/15/2026, 6/15/2026, 9/15/2026, 1/15/2027; the January payment isn't needed if the 2026 return is filed and paid by February 1, 2027",
  ),
  extension: src(
    "https://www.irs.gov/filing/get-an-extension-to-file-your-tax-return",
    "Form 4868: until October 15 to file; an extension to file, not to pay",
  ),
  revProc2025_32: src(
    "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    "Rev. Proc. 2025-32 (tax year 2026): brackets, standard deduction $16,100 single, a dependent's standard deduction (greater of $1,350 or earned income + $450), student loan interest phase-out $85,000-$100,000 ($175,000-$205,000 joint)",
  ),
  pub970: src(
    "https://www.irs.gov/publications/p970",
    "Pub. 970 (2025 returns): taxable scholarships (room, board, stipends, pay for teaching or research) go on Schedule 1 line 8r; AOTC up to $2,500, 40% refundable, not for a dependent, married filing separately or a nonresident alien; student loan interest up to $2,500 on Schedule 1 line 21, not for a dependent or married filing separately",
  ),
  form8863: src(
    "https://www.irs.gov/instructions/i8863",
    "Form 8863 instructions (2025): AOTC and LLC phase out from $80,000 to $90,000 MAGI ($160,000-$180,000 joint); LLC 20% of up to $10,000; AOTC half-time, first 4 years, no more than 4 years claimed; Form 1098-T generally required; nonrefundable part on Schedule 3 line 3",
  ),
  eitcTables: src(
    "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/earned-income-and-earned-income-tax-credit-eitc-tables",
    "EITC 2026: no qualifying children, up to $664, AGI under $19,540 ($26,820 joint), investment income $12,200 or less",
  ),
  form8863Line7: src(
    "https://www.irs.gov/instructions/i8863",
    "Form 8863 line 7 (2025): no refundable AOTC for someone under 18, or 18 with earned income under half their support, or 18 to 23 and a full-time student, when a parent is alive and the return isn't joint; expenses are reduced by tax-free scholarships",
  ),
  pub15: src(
    "https://www.irs.gov/publications/p15",
    "Pub. 15 (2026): supplemental wages (stock vests among them) withheld at a flat 22% (37% over $1 million)",
  ),
  formW4V: src(
    "https://www.irs.gov/pub/irs-pdf/fw4v.pdf",
    "Form W-4V: voluntary federal withholding from Social Security and other government payments, at 7%, 10%, 12% or 22%",
  ),
  form1099K: src(
    "https://www.irs.gov/businesses/understanding-your-form-1099-k",
    "Form 1099-K: payment apps and online marketplaces report payments over $20,000 in more than 200 transactions; income is reported whether or not a 1099-K comes; gifts and repayments of shared personal costs aren't taxable income",
  ),
  seTax: src(
    "https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes",
    "Self-employment tax: 15.3% (12.4% Social Security, 2.9% Medicare); Schedule SE from $400 of net earnings; for 2026 the first $184,500 of wages and net earnings for Social Security",
  ),
  ftb540nrCa: src(
    "https://www.ftb.ca.gov/forms/2025/2025-540nr-ca-instructions.html",
    "Schedule CA (540NR) instructions (2025): a part-year resident is taxed on all income while a resident and only on California-source income while a nonresident; Form 540NR is the return for a nonresident or part-year resident",
  ),
  w2Instructions: src(
    "https://www.irs.gov/instructions/iw2w3",
    "Form W-2 instructions (2026): furnish Copies B, C and 2 to employees by February 1, 2027",
  ),
  infoReturns: src(
    "https://www.irs.gov/instructions/i1099gi",
    "General Instructions for Certain Information Returns, Part M: Forms 1098 and 1099 to recipients by January 31, or the next business day when it falls on a weekend",
  ),
  withholdingEstimator: src(
    "https://www.irs.gov/individuals/tax-withholding-estimator",
    "IRS Tax Withholding Estimator: estimates what an employer should withhold; too much withheld means a smaller paycheck now and a bigger refund later; it makes a pre-filled Form W-4 to give the employer",
  ),
  unemploymentIrs: src(
    "https://www.irs.gov/taxtopics/tc418",
    "IRS Topic 418: unemployment compensation is generally income; Form 1099-G shows it (box 1) and tax withheld (box 4); withholding by Form W-4V; estimated payments may be needed",
  ),
  unemploymentFtb: src(
    "https://www.ftb.ca.gov/file/personal/income-types/unemployment.html",
    "FTB: unemployment compensation is taxable for federal purposes and nontaxable for California",
  ),
  pub501: src(
    "https://www.irs.gov/publications/p501",
    "Pub. 501 (2025 returns): for a dependent's standard deduction, earned income includes any part of a taxable scholarship or fellowship grant",
  ),
  pub596: src(
    "https://www.irs.gov/publications/p596",
    "Pub. 596 (2025 returns): earned income for the EITC is wages, net earnings from self-employment and statutory employee pay",
  ),
  eitcWho: src(
    "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/who-qualifies-for-the-earned-income-tax-credit-eitc",
    "EITC: without a qualifying child, at least 25 and under 65 at year end; not someone else's dependent or qualifying child; a US citizen or resident alien all year",
  ),
  w4: src(
    "https://www.irs.gov/pub/irs-pdf/fw4.pdf",
    "Form W-4 (2026): exempt from withholding if no federal income tax liability in 2025 and none expected in 2026; a new W-4 by February 16, 2027",
  ),
  pub15t: src(
    "https://www.irs.gov/publications/p15t",
    "Pub. 15-T (2026): the part-year employment method, asked for in writing, for someone employed no more than 245 days in the calendar year; the standard annual table withholds nothing below $16,100 of single pay ($7,500 adjusted + $8,600)",
  ),
  ftbEstimated: src(
    "https://www.ftb.ca.gov/pay/estimated-tax-payments.html",
    "California estimated tax: $500 or more owed ($250 married/RDP separately); 30% April 15, 40% June 15, 0% September 15, 30% January 15; 90% of this year or 100% of last (110% over $150,000 CA AGI)",
  ),
  ftbExtension: src(
    "https://www.ftb.ca.gov/file/when-to-file/extension-to-file.html",
    "California: automatic 6-month extension to file, no form; not an extension to pay",
  ),
  ftbRenters: src(
    "https://www.ftb.ca.gov/file/personal/credits/nonrefundable-renters-credit.html",
    "California renter's credit (2025 returns): $60 single or married/RDP separately, $120 joint, head of household or widow(er); CA income $53,994 or less ($107,987); rent paid in CA at least half the year; property not tax exempt; not living with someone who can claim you as a dependent; Form 540 line 46",
  ),
  stanfordPayingStudents: src(
    "https://fingate.stanford.edu/paying-people/paying-students-graduate-and-undergraduate",
    "Stanford: fellowship stipends are paid from the student account as a direct-deposit refund; Stanford does not withhold tax from fellowships for US citizens, permanent residents and tax residents, who may owe quarterly estimated tax; nonresidents' awards are withheld at 30% (Form 1042-S); student-employee pay is withheld and on a W-2",
  ),
  stanfordTaxForms: src(
    "https://studentservices.stanford.edu/my-finances/1098-t-tax-overview-faqs/other-tax-forms-and-taxable-income",
    "Stanford: an RA or TA appointment gets a W-2; international students' fellowships are reported on Form 1042-S",
  ),
  stanfordInternational: src(
    "https://studentservices.stanford.edu/my-finances/taxes/tax-essentials-international-students",
    "Stanford: international students get Form 1042-S in March with scholarship amounts and tax withheld; filing a US return may bring a refund",
  ),
  bechtelForms: src(
    "https://bechtel.stanford.edu/navigate-international-life/taxes/determine-which-us-tax-forms-use",
    "Bechtel International Center: nonresident students file Form 8843 whether or not they had income (mid-June with no US income); with US income, Form 1040-NR and 8843; Sprintax for the returns",
  ),
} as const satisfies Record<string, Source>;

// The constants in ./tax-rates.ts this lane checked against the source above, and which source.
export const READ: Readonly<Record<string, keyof typeof SOURCES>> = {
  "FEDERAL_BRACKETS.single (10%, 12%, 22% rows)": "revProc2025_32",
  "STANDARD_DEDUCTION.single": "revProc2025_32",
  STUDENT_LOAN_INTEREST: "revProc2025_32",
  EDUCATION_CREDITS: "form8863",
  "EITC (no children: $664, phase-out to $19,540 / $26,820, investment $12,200)": "eitcTables",
};

// --- Estimated tax, 2026 ------------------------------------------------------------------------

export const ESTIMATED_TAX = {
  taxYear: 2026,
  // Each payment's last day, and the months of income it is for (Pub. 505).
  dates: [
    { due: "2026-04-15", covers: "January through March" },
    { due: "2026-06-15", covers: "April and May" },
    { due: "2026-09-15", covers: "June through August" },
    { due: "2027-01-15", covers: "September through December" },
  ],
  // Owing at least this after withholding and credits is when estimates are required.
  requiredFromCents: 100_000,
  // Withholding and estimates of at least the smaller of 90% of this year's tax or 100% of last
  // year's (110% when last year's AGI was over $150,000, $75,000 married filing separately).
  thisYearShare: 0.9,
  lastYearShare: 1,
  lastYearShareHigh: 1.1,
  highAgiCents: 15_000_000,
  highAgiSeparateCents: 7_500_000,
  // No 2025 tax, a US citizen or resident all of 2025, a 12-month year: no estimates required.
  noLiabilityYear: 2025,
  // The January payment can be skipped by filing the 2026 return and paying it all by then.
  fileInsteadOfJanuaryBy: "2027-02-01",
  sources: ["pub505", "form1040es"],
} as const;

export const CA_ESTIMATED_TAX = {
  taxYear: 2026,
  dates: [
    { due: "2026-04-15", share: 0.3 },
    { due: "2026-06-15", share: 0.4 },
    { due: "2026-09-15", share: 0 },
    { due: "2027-01-15", share: 0.3 },
  ],
  requiredFromCents: 50_000,
  requiredFromSeparateCents: 25_000,
  sources: ["ftbEstimated"],
} as const;

// --- Filing ------------------------------------------------------------------------------------

// The 2026 return: due on the 15th day of the fourth month (April 15, 2027, a Thursday); an
// extension (federal Form 4868, California automatic) moves filing to October 15, 2027, and never
// the payment.
export const FILING = {
  taxYear: 2026,
  due: "2027-04-15",
  extendedTo: "2027-10-15",
  federalExtensionForm: "Form 4868",
  sources: ["extension", "ftbExtension"],
} as const;

// --- Fellowships and student money --------------------------------------------------------------

// Money from a school that isn't pay for work: a stipend or fellowship (taxable, nothing withheld
// for a US student), or a refund from the student account (a fellowship's stipend at Stanford, or
// aid and loan money: which, only the person knows). Pay for work comes through payroll.
export const SCHOOL_PAYER =
  /\b(?:STANFORD|UNIV(?:ERSITY)?|COLLEGE|INSTITUTE OF TECHNOLOGY|BURSAR|STUDENT (?:ACCT|ACCOUNT|FIN(?:ANCIAL)?|AID))\b/;
export const STIPEND_WORDS = /\b(?:STIPEND|FELLOWSHIP|FELLOW PMT|GRAD(?:UATE)? SUPPORT|NSF GRFP)\b/;
export const SCHOOL_REFUND_WORDS = /\b(?:REFUND|DISB(?:URSEMENT)?|STUDENT (?:ACCT|ACCOUNT))\b/;
export const SCHOOL_PAYROLL_WORDS = /\b(?:PAYROLL|PAYRL|SALARY|DIR(?:ECT)? DEP(?:OSIT)? PAY)\b/;
// A deposit smaller than this isn't a stipend (a bookstore return, a parking refund).
export const STIPEND_MIN_CENTS = 50_000;

// Tuition paid to a school from the person's own account (what an education credit is figured on).
export const TUITION_WORDS = /\b(?:TUITION|BURSAR|STUDENT (?:ACCT|ACCOUNT) PAYMENT|REGISTRAR)\b/;
export const TUITION_MIN_CENTS = 20_000;

// Rent to a school is campus housing: the property is the school's and exempt from property tax,
// which the renter's credit rules out (FTB: "The property was not tax exempt").
export const CAMPUS_HOUSING =
  /\b(?:R&DE|HOUSING AND DINING|RESIDENTIAL (?:AND|&) DINING|STUDENT HOUSING|UNIV(?:ERSITY)? HOUSING|CAMPUS HOUSING|ESCONDIDO VILLAGE)\b/;

// --- California renter's credit ----------------------------------------------------------------

// The 2025 return's limits are the newest FTB has published; the 2026 limits are indexed up from
// them, so anyone under 2025's is under 2026's, and the card says it reads 2025's.
export const CA_RENTERS_CREDIT = {
  limitsYear: 2025,
  creditCents: {
    single: 6_000,
    married_separate: 6_000,
    married_joint: 12_000,
    head_of_household: 12_000,
  },
  incomeLimitCents: {
    single: 5_399_400,
    married_separate: 5_399_400,
    married_joint: 10_798_700,
    head_of_household: 10_798_700,
  },
  // At least half the year's rent paid in California.
  minMonths: 6,
  sources: ["ftbRenters"],
} as const;

// --- Education credits and student loans (the figures are in ./tax-rates.ts) -----------------------

export const AOTC_FORM = {
  // 100% of the first $2,000 of tuition and required books, 25% of the next $2,000; 40% of the
  // credit is refundable (paid even with no tax owed).
  firstCents: 200_000,
  secondCents: 200_000,
  secondRate: 0.25,
  refundableShare: 0.4,
  sources: ["pub970", "form8863"],
} as const;

// The earned income credit without children: from 25 to 64 at the year's end (./tax-rates.ts EITC has
// the amounts). Earned income is wages and self-employment (Pub. 596); a fellowship isn't on that
// list, though it is in AGI.
export const EITC_FORM = {
  sources: ["eitcTables", "eitcWho", "pub596"],
} as const;

// --- Withholding ----------------------------------------------------------------------------------

export const W4 = {
  // Pub. 15-T's standard annual table for a single W-4 takes an amount off the year's pay and withholds
  // nothing on the band after it, then the brackets (both amounts are the year's, in the tax-params
  // `withholding` group): withholding on a paycheck is the year's tax on its pay times the paychecks
  // in a year, less that, over those paychecks.
  // A job seen starting when the data shows no pay for this many pay intervals from its first day.
  startGapIntervals: 1.15,
  // Paychecks this many days apart, at most, make a pay interval; and the paychecks a year for each.
  intervals: [
    { maxDays: 9, perYear: 52 },
    { maxDays: 14, perYear: 26 },
    { maxDays: 17, perYear: 24 },
    { maxDays: 35, perYear: 12 },
  ],
  // Two jobs' paychecks: each payer seen at least this many times.
  jobMinPaychecks: 2,
  // Two jobs at once: each one's latest paycheck is within this many pay intervals of today, and
  // the two jobs' paychecks overlap in time.
  jobActiveWithinIntervals: 2,
  // The extension card is shown from this day of the year until the return is due.
  extensionFrom: "03-01",
  form: "Form W-4",
  partYearMaxDays: 245,
  exemptRenewBy: "2027-02-16",
  sources: ["w4", "pub15t"],
} as const;

// --- International students --------------------------------------------------------------------

export const INTERNATIONAL = {
  // Not shown on any card: fingate.stanford.edu says 30% for nonresidents' awards, while Stanford's
  // graduate funding page says 14% of taxable fellowship aid for F/J students, with a possible
  // treaty exemption (CodeRabbit sweep 1c, det-04). Check both at their source before showing a rate.
  stanfordFellowshipWithholding: 0.3,
  links: [
    {
      label: "Bechtel: which US tax forms to use",
      href: "https://bechtel.stanford.edu/navigate-international-life/taxes/determine-which-us-tax-forms-use",
    },
    {
      label: "Bechtel: Sprintax",
      href: "https://bechtel.stanford.edu/navigate-international-life/taxes/sprintax-software",
    },
    { label: "IRS: Form 8843", href: "https://www.irs.gov/forms-pubs/about-form-8843" },
    {
      label: "IRS: the substantial presence test",
      href: "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test",
    },
  ],
  sources: ["bechtelForms", "stanfordPayingStudents", "stanfordInternational"],
} as const;

// The fact versions of advice-only tax and investing cards (./src/detectors/tax-facts.ts).
export const W4V_RATES = [0.07, 0.1, 0.12, 0.22] as const;

// Side income beside a paycheck (./src/detectors/side-income.ts): payouts for work or sales, and money
// cashed out of a payment app, which only the person can say is work or friends.
export const SIDE_INCOME = {
  appThreshold: { cents: 2_000_000, payments: 200 },
  seRate: 0.153,
  seFromCents: 40_000,
  // Cashed out of an app: friends paying back, or customers paying; asked (app_income).
  appWords: /\b(?:VENMO|CASH ?APP|PAYPAL)\b.*\b(?:CASHOUT|CASH OUT|TRANSFER|INST XFER)\b/,
  sources: ["form1099K", "seTax"],
} as const;

// Tuition paid by December 31 for an academic period that starts by the end of March counts toward
// this year's education credits (Form 8863 instructions): said on the card from this day.
export const TUITION_TIMING_FROM = "11-01";

// The forms a person can expect for the year, from the payers Jane sees (./src/detectors/tax-forms.ts):
// shown from December 1 to February 15. W-2s, 1098s and 1099s are due to them January 31, or the next
// business day; Stanford mails fellowship recipients a letter summing payments over $600 in January;
// a nonresident's Form 1042-S comes in March.
export const FORMS_COMING = {
  from: "12-01",
  until: "02-15",
  dueMonthDay: "01-31",
  loanInterestFormFromCents: 60_000,
  sources: [
    "w2Instructions",
    "infoReturns",
    "stanfordPayingStudents",
    "stanfordInternational",
    "form1099K",
  ],
} as const;

// A federal refund beside a paycheck (./src/detectors/student-withholding.ts refundWithholding): from
// this much, said as withholding beyond the year's tax.
export const REFUND_SHOWN_FROM_CENTS = 50_000;
// A refund from the IRS, as banks write it ("IRS TREAS 310 TAX REF"). "TREAS 310" alone is any Treasury
// payment (FEMA's disaster aid is "FEMA IHP TREAS 310 DISASTER ASSIST").
export const IRS_REFUND = /\b(?:IRS|TREAS 310)\b.*\bTAX REF/;

// Form W-4V's one rate for unemployment compensation (line 5).
export const UNEMPLOYMENT_W4V_RATE = 0.1;
