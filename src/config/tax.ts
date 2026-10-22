import type { PfcDetailed } from "@/categorize/taxonomy";
import type { AutopilotChoice } from "@/config/autopilot";
import { CHARITY_CATEGORIES, PREPARER_GROUPS } from "@/config/tax-pack";

// Taxes (spec steps 118–127): what Jane needs to know, how she works it out from the
// person's accounts and what she does by herself at each autopilot level. Tax rates,
// brackets and limits are in src/config/tax-rates.ts.

// The tax year Jane works on during the year. Until the filing deadline the pack still
// opens on last year (src/config/tax-pack.ts TAX_PACK_LAST_YEAR_UNTIL).
export const TAX_YEAR = 2026;

// Spec step 118: the federal filing statuses Jane asks about. A qualifying surviving spouse
// uses the married-filing-jointly figures and is picked as that on the profile page.
export const FILING_STATUSES = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
} as const;
export type FilingStatus = keyof typeof FILING_STATUSES;
export const isFilingStatus = (value: unknown): value is FilingStatus =>
  typeof value === "string" && Object.hasOwn(FILING_STATUSES, value);

// Kinds of income, how Jane says it when she's seen it, the form each usually comes on, and how Jane spots each in the
// person's transactions (Plaid personal finance categories) and accounts (Plaid
// investment subtypes for taxable accounts, from Plaid's account type docs). Pensions and
// unemployment are taxable too, so they're asked about as well.
export const INCOME_KINDS = {
  w2: {
    label: "Wages from a job",
    seen: "wages",
    form: "W-2",
    categories: ["INCOME_SALARY", "INCOME_MILITARY"],
  },
  self_employed: {
    label: "Freelance, contract or gig work",
    seen: "freelance or gig pay",
    form: "1099-NEC or 1099-K",
    categories: ["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY"],
  },
  rental: {
    label: "Rent from a property",
    seen: "rent",
    form: "Schedule E",
    categories: ["INCOME_RENTAL"],
  },
  investment: {
    label: "Interest, dividends or sales of investments",
    seen: "investment income",
    form: "1099-INT, 1099-DIV or 1099-B",
    categories: ["INCOME_DIVIDENDS", "INCOME_INTEREST_EARNED"],
  },
  retirement: {
    label: "A pension or retirement payouts",
    seen: "pension or retirement payouts",
    form: "1099-R",
    categories: ["INCOME_RETIREMENT_PENSION"],
  },
  unemployment: {
    label: "Unemployment benefits",
    seen: "unemployment benefits",
    form: "1099-G",
    categories: ["INCOME_UNEMPLOYMENT"],
  },
} as const satisfies Record<
  string,
  { label: string; seen: string; form: string; categories: readonly PfcDetailed[] }
>;
export type IncomeKind = keyof typeof INCOME_KINDS;
export const INCOME_KIND_ORDER = Object.keys(INCOME_KINDS) as IncomeKind[];
export const isIncomeKind = (value: unknown): value is IncomeKind =>
  typeof value === "string" && Object.hasOwn(INCOME_KINDS, value);

// Investment accounts whose gains and dividends are taxed each year (Plaid investment
// subtypes). Retirement and health accounts (401k, IRA, HSA, 529) aren't in it.
export const TAXABLE_INVESTMENT_SUBTYPES: readonly string[] = [
  "brokerage",
  "mutual fund",
  "stock plan",
  "trust",
  "ugma",
  "utma",
  "crypto exchange",
];

// How far back Jane looks for income, in days: a full year, so a yearly payment counts.
export const TAX_PROFILE_LOOKBACK_DAYS = 365;
// Wages count once there are this many paychecks; one-off payments count from the first.
export const TAX_PROFILE_MIN_PAYCHECKS = 2;
// Payers named in Jane's message, most paid first.
export const TAX_PROFILE_PAYERS_SHOWN = 2;

// Spending that hints at children, so Jane mentions it when she asks (never assumes).
export const CHILDCARE_HINT_CATEGORIES: readonly PfcDetailed[] = ["GENERAL_SERVICES_CHILDCARE"];

// Payments to government agencies whose name starts with a state's code ("CA DMV …"), so
// Jane can suggest the state when it isn't in Settings.
export const STATE_AGENCY_CATEGORIES: readonly PfcDetailed[] = [
  "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
];

// The most dependants of each kind the profile takes.
export const MAX_DEPENDANTS = 15;

// Spec step 119: tax tags on transactions. Jane tags spending in these categories by
// herself; "check" tags are ones she asks about (an online course may not be education
// for taxes). Work expenses are only ever tagged by the person. Tags sit beside the
// spending categories and never change them, so spending totals stay the same.
export const TAX_TAGS = {
  donation: {
    label: "Donation",
    plural: "donations",
    categories: CHARITY_CATEGORIES,
    check: false,
  },
  medical: {
    label: "Medical",
    plural: "medical",
    categories: PREPARER_GROUPS.medical,
    check: false,
  },
  childcare: {
    label: "Childcare",
    plural: "childcare",
    categories: PREPARER_GROUPS.childcare,
    check: false,
  },
  education: {
    label: "Education",
    plural: "education",
    categories: PREPARER_GROUPS.education,
    check: true,
  },
  work: { label: "Work expense", plural: "work expenses", categories: [], check: false },
  // Spec step 123: costs of freelance or gig work. Tagged by the person; for people with
  // freelance income Jane also suggests likely ones (BUSINESS_HINT_CATEGORIES) and asks.
  business: {
    label: "Business expense",
    plural: "business expenses",
    categories: [],
    check: false,
  },
  // Spec step 173: costs of a rental property (repairs, management, insurance, advertising).
  // Tagged by the person; they come off the rent before it's taxed.
  rental: {
    label: "Rental expense",
    plural: "rental expenses",
    categories: [],
    check: false,
  },
} as const satisfies Record<
  string,
  { label: string; plural: string; categories: readonly PfcDetailed[]; check: boolean }
>;
export type TaxTagKind = keyof typeof TAX_TAGS;
export const TAX_TAG_ORDER = Object.keys(TAX_TAGS) as TaxTagKind[];
export const isTaxTagKind = (value: unknown): value is TaxTagKind =>
  typeof value === "string" && Object.hasOwn(TAX_TAGS, value);
// What a person's "not for taxes" is stored as.
export const UNTAGGED = "none";

// Spec step 123: spending Jane suggests as a business expense, and asks about, for people
// with freelance or gig income.
export const BUSINESS_HINT_CATEGORIES: readonly PfcDetailed[] = [
  "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
  "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
  "GENERAL_SERVICES_CONSULTING_AND_LEGAL",
  "GENERAL_SERVICES_POSTAGE_AND_SHIPPING",
];

// Spec step 123: estimated tax for freelancers. Jane reminds this many days before each
// due date, with the amount, when the year's estimate leaves at least minOwedCents to pay
// (under $1,000 owed there's no penalty). Paying: IRS Direct Pay.
export const QUARTERLY = {
  remindDays: 14,
  minOwedCents: 100_000,
} as const;
export const IRS_DIRECT_PAY_URL = "https://www.irs.gov/payments/direct-pay";
// Freelance payments from the last this-many days get a set-aside message.
export const SET_ASIDE_RECENT_DAYS = 14;
// The most square feet and miles the helpers take.
export const MAX_HOME_OFFICE_SQFT = 300;
export const MAX_BUSINESS_MILES = 200_000;

// /taxes/tags shows at most this many transactions when searching for one to tag.
export const TAX_TAG_SEARCH_LIMIT = 50;

// Spec step 119: the tax forms to expect, from the income and loans Jane sees. Usual dates
// (MM-DD, the year after the tax year) the payer must send each by; a weekend or holiday
// moves it to the next business day, so Jane says "by about". Thresholds in cents: below
// them a payer needn't send a form (the income still counts). For review: from the IRS
// "General Instructions for Certain Information Returns" (2026) and the One Big Beautiful
// Bill Act, which raised the 1099-NEC/MISC threshold from $600 to $2,000 for payments made
// in 2026 and put the 1099-K threshold back to $20,000 and 200 payments.
export const TAX_FORMS = {
  w2: { form: "W-2", what: "wages", by: "01-31" },
  nec: { form: "1099-NEC or 1099-K", what: "freelance or gig pay", by: "01-31" },
  int: { form: "1099-INT", what: "interest", by: "01-31" },
  brokerage: { form: "consolidated 1099 (DIV and B)", what: "dividends and sales", by: "02-15" },
  r: { form: "1099-R", what: "pension or retirement payouts", by: "01-31" },
  g: { form: "1099-G", what: "unemployment benefits", by: "01-31" },
  mortgage: { form: "1098", what: "mortgage interest", by: "01-31" },
  student: { form: "1098-E", what: "student loan interest", by: "01-31" },
  // Spec step 219: an exchange that sold crypto in the year reports the proceeds (brokers
  // report from 2025; cost basis from 2026).
  da: { form: "1099-DA", what: "crypto sales", by: "02-15" },
} as const;
export type TaxFormKey = keyof typeof TAX_FORMS;
// For review: 1099-NEC/MISC, by the year the money was paid.
export const NEC_THRESHOLD_CENTS: Readonly<Record<number, number>> = {
  2025: 60_000,
  2026: 200_000,
};
export const necThreshold = (year: number) =>
  NEC_THRESHOLD_CENTS[year] ??
  NEC_THRESHOLD_CENTS[Math.max(...Object.keys(NEC_THRESHOLD_CENTS).map(Number))];
// For review: 1099-INT at $10 of interest; 1098-E at $600 of student loan interest; 1098 at
// $600 of mortgage interest.
export const INT_THRESHOLD_CENTS = 1_000;
export const STUDENT_INTEREST_THRESHOLD_CENTS = 60_000;
export const MORTGAGE_INTEREST_THRESHOLD_CENTS = 60_000;
// Jane starts asking whether forms have arrived from this day (MM-DD) of the year after.
export const TAX_FORMS_ASK_FROM = "01-20";
// ...until this day (MM-DD), the usual filing deadline.
export const TAX_FORMS_ASK_UNTIL = "04-15";

// Spec step 120: the demo bank's stand-in pay stub, per paycheck, for its ACME CORP
// PAYROLL deposits (src/lib/payroll/demo.ts). A real payroll connection (Plaid Income's
// payroll data, or a payroll provider) replaces it. Net pay is the deposit: $2,450.00.
export const DEMO_PAY_STUB = {
  grossCents: 395_000,
  retirementCents: 23_700,
  // Health premiums, pre-tax (not subject to Social Security or Medicare).
  otherPretaxCents: 14_500,
  federalWithheldCents: 56_557,
  stateWithheldCents: 21_000,
  socialSecurityCents: 23_591,
  medicareCents: 5_517,
  // State disability insurance (California SDI).
  stateDisabilityCents: 5_135,
  netCents: 245_000,
} as const;

// Paychecks a year by the usual gap between them, in days.
export const PAY_FREQUENCIES: readonly { maxGap: number; perYear: number; label: string }[] = [
  { maxGap: 9, perYear: 52, label: "weekly" },
  { maxGap: 14, perYear: 26, label: "every two weeks" },
  { maxGap: 17, perYear: 24, label: "twice a month" },
  { maxGap: 35, perYear: 12, label: "monthly" },
];

// Spec step 121: the withholding checkup. A refund over bigRefund, or a bill over bill, is
// worth a W-4 change; the change aims for a small refund of target. Amounts are rounded:
// extra withholding per paycheck up to a whole dollar, Step 4(b) deductions down to $100.
export const WITHHOLDING = {
  targetRefundCents: 30_000,
  bigRefundCents: 100_000,
  billCents: 10_000,
  roundExtraCents: 100,
  roundDeductionCents: 10_000,
} as const;
export const IRS_WITHHOLDING_ESTIMATOR_URL =
  "https://www.irs.gov/individuals/tax-withholding-estimator";
export const IRS_W4_URL = "https://www.irs.gov/forms-pubs/about-form-w-4";

// Spec step 122: the tax savings finder (demo advice). Savings under this many cents a year
// aren't shown. Purchases that look like tuition or home energy work are spotted by these
// words in the payee.
export const TAX_SAVINGS_MIN_CENTS = 2_500;
export const TUITION_PAYEE =
  /\b(?:UNIV(?:ERSITY)?|COLLEGE|TUITION|BURSAR|COMMUNITY COLL|SCHOOL OF)\b/i;
export const ENERGY_PAYEE =
  /\b(?:SOLAR|SUNRUN|SUNPOWER|SUNNOVA|TESLA ENERGY|HEAT PUMP|MITSUBISHI ELECTRIC|INSULATION|ENERGY STAR|GEOTHERMAL|POWERWALL)\b/i;
// Health FSA: suggested when out-of-pocket medical spending this year is over this.
export const FSA_SUGGEST_FROM_CENTS = 50_000;
// When open enrollment usually ends (MM-DD): the reminder Jane sets for it.
export const OPEN_ENROLLMENT_BY = "11-30";
// Bunching gifts: suggested when doubling a year's gifts would take itemized deductions
// past the standard deduction.

// Spec step 125: tax refunds. A deposit is a refund when Plaid says so or its description
// reads like one; federal when it's from the Treasury. A refund matches the estimate when
// it's within matchCents or matchShare of it. Debt worth paying from a refund: rates from
// debtAprBps up. Refunds Jane brings up: from the last recentDays.
export const REFUND = {
  payee:
    /\b(?:TAX REF(?:UND)?|TREAS 310|IRS TREAS|FRANCHISE TAX BD|DEPT OF REVENUE|STATE TAX REFUND)\b/i,
  federalPayee: /\b(?:IRS|TREAS 310|US TREASURY)\b/i,
  matchCents: 5_000,
  matchShare: 0.05,
  debtAprBps: 800,
  recentDays: 30,
} as const;

// Spec step 126: filing. Jane offers to start the return in filing season (MM-DD, the
// year after the tax year; through the October extension deadline). The demo partner
// accepts a return this many hours after it's submitted.
export const FILING_SEASON = { from: "01-20", until: "10-15" } as const;
export const DEMO_FILING_ACCEPT_HOURS = 24;

// Spec step 166: tax forms Jane collects from the document partner (a stand-in for the
// demo bank). She looks for each expected form from its usual date (TAX_FORMS by) until the
// filing deadline, once a day. A form agrees with the transactions when the amounts are
// within the larger of matchCents and matchShare of them (post-tax deductions such as a
// Roth 401(k) can make a W-2's take-home differ); otherwise it's flagged and not used until
// the person says it's right. A form still missing chaseDays after its date gets a nudge,
// and "Remind me" puts asking the payer on their deadlines remindDays out.
export const TAX_DOCUMENTS = {
  from: "01-20",
  until: "04-15",
  matchCents: 100,
  matchShare: 0.01,
  chaseDays: 7,
  remindDays: 7,
} as const;

// Spec step 127: the one message in January with everything ready, sent between these
// days (MM-DD) of the year after the tax year.
export const JANUARY_READY = { from: "01-02", until: "01-31" } as const;

// Spec step 124: investment taxes (demo advice for harvesting and where to hold what).
// Harvesting chances from this much unrealised loss; holdings whose payouts are taxed each
// year in a taxable account, by name.
export const HARVEST_MIN_LOSS_CENTS = 20_000;
export const TAX_HEAVY_HOLDING = /\b(?:BOND|INCOME|DIVIDEND|TREASURY|REIT|HIGH YIELD)\b/i;
// Jane brings up harvesting from this day (MM-DD) to the end of the year.
export const HARVEST_FROM = "10-01";

// The estimate tells the person when it has moved by at least this much (in cents) since
// Jane last said it.
export const TAX_ESTIMATE_STEP_CENTS = 50_000;

// The chat (src/lib/jane-agent/sources/taxes.ts): how important tax messages are, among
// the others in src/config/agent-chat.ts MESSAGE_PRIORITY.
export const TAX_MESSAGE_PRIORITY = {
  // The profile unlocks the rest of taxes, so it comes before budgets and goals.
  profile: 46,
  // Spec step 165: a move changes the state estimate; the city tax question is small.
  move: 44,
  local: 31,
  new_income: 36,
  // Spec step 119.
  tag_check: 33,
  tag_month: 25,
  form_due: 38,
  // Spec step 120.
  estimate: 30,
  // Spec step 121.
  withholding: 37,
  // Spec step 122.
  saving: 34,
  // Spec step 125.
  refund: 68,
  // Spec step 126.
  filing: 72,
  // Spec step 127.
  january: 74,
  // Spec step 124.
  // A wash sale is news, but not before what can save money today.
  wash_sale: 41,
  harvest: 33,
  // Spec step 123.
  quarterly: 88,
  set_aside: 39,
  // Spec step 166: a form that disagrees with the accounts matters more than one collected.
  doc_flagged: 70,
  doc_collected: 40,
  doc_missing: 38,
  // Spec step 167: a tax move with a deadline coming.
  plan: 42,
  // Spec step 168: the giving options in season, and a gift's missing receipt.
  giving: 43,
  receipt: 32,
  // Spec step 169: a family tax choice worth making.
  family: 35,
  // Spec step 170: the state and local tax cap biting, and a home sale.
  salt_cap: 29,
  home_sale: 45,
  // Spec step 171: a year's records can be thrown away.
  records: 28,
  // Spec step 172: a return read from a document, and what its review found.
  prior_return: 47,
  prior_review: 43,
  // Spec step 173: a rental to set up, and hobby or business.
  rental_setup: 37,
  side_kind: 36,
  // Spec step 217: a tax notice is urgent.
  notice: 82,
  // Spec step 218: a sign of identity theft is urgent; the IP PIN is January's.
  identity: 83,
  ip_pin: 48,
  // Spec step 219: crypto and equity pay will add tax nothing withholds.
  equity: 40,
  // Spec step 220: a move that saves tax over several years.
  years: 35,
  // Spec step 221: an assessment worth appealing, and exemptions not yet claimed.
  property: 38,
  // Spec step 222: an accountant's answers, and a return people usually bring one to.
  accountant_answer: 60,
  accountant: 28,
  // Spec step 223: an estimated payment due that needs a tap, and December's year-end moves.
  estimate_due: 85,
  // Spec step 267: an S corporation that would save more than it costs.
  business: 33,
  // Spec step 268: an inherited IRA, and a gift that needs a gift tax return.
  inherited: 46,
  gifts: 44,
  // Spec step 269: a credit that would be repaid, an HSA over its limit, medical costs worth
  // itemizing.
  ptc: 72,
  hsa_excess: 62,
  medical: 40,
  year_end: 55,
  exemption: 30,
} as const;

// What Jane does about taxes by herself at each autopilot level (spec step 57), shown on
// /taxes and said in the chat, one entry per feature: what she does when the person asks
// her to check first ("Ask me first", or no level picked yet) and at the levels that let
// her act (safe, everything allowed, custom). Nothing is ever filed, signed or paid
// without a tap.
export type TaxAutopilotLevel = AutopilotChoice | "custom" | "none";
export const TAX_AUTOPILOT: readonly { feature: string; ask: string; auto: string }[] = [
  {
    feature: "profile",
    ask: "I work out your tax profile from your accounts and ask you to check it; I only use what you've told me or said yes to.",
    auto: "I keep your tax profile up to date from your accounts and use what I find straight away, marked as found by me, until you check it. I ask before adding a new kind of income.",
  },
  {
    feature: "estimate",
    ask: "I keep your tax estimate up to date after every sync, from your income so far.",
    auto: "I keep your tax estimate up to date after every sync, and tell you when it moves by $500 or more.",
  },
  {
    feature: "withholding",
    ask: "I check your withholding against your estimate and, with demo advice, show what to put on a new W-4. Only you can send it to your employer.",
    auto: "I check your withholding after every sync and bring up a W-4 change when you're heading for a big refund or a bill. Only you can send it to your employer.",
  },
  {
    feature: "savings",
    ask: "With demo advice, I look for ways to pay less (retirement and health accounts, deductions, credits) and show each with an estimate; you pick which to act on.",
    auto: "With demo advice, I look for ways to pay less after every sync and bring up each new one with the goal or reminder ready to set with one tap. I never change your contributions myself.",
  },
  {
    feature: "self_employed",
    ask: "For freelance income, I suggest likely business expenses, remind you before each estimated tax date and, with demo advice, say how much to set aside from each payment.",
    auto: "For freelance income, I tag likely business expenses for you to check, remind you before each estimated tax date with the amount and, with demo advice, start a tax set-aside goal and tell you what to put in it from each payment. Paying is always your tap.",
  },
  {
    feature: "refund",
    ask: "I spot your tax refund when it lands, check it against my estimate and, with demo advice, suggest where it could go.",
    auto: "I spot your tax refund when it lands, check it against my estimate and, with demo advice, have the plan for it ready: one tap sets up the goals and reminders. Moving the money is always yours.",
  },
  {
    feature: "filing",
    ask: "In filing season I offer to start your return with the filing partner, handing over your profile, income, tags and forms; you review and sign it, and I track it.",
    auto: "In filing season, once your forms are in, I start your return with the filing partner by myself and tell you when it's ready to review. Only you can sign it; nothing is filed until you do.",
  },
  {
    feature: "january",
    ask: "In January I send one message with everything ready: the estimate, the tax-time pack and which forms are in.",
    auto: "In January I send one message with everything ready (the estimate, the tax-time pack, which forms are in) and keep it all up to date until you file.",
  },
  {
    feature: "investments",
    ask: "I work out your gains and losses from your holdings, warn you about wash sales and, with demo advice, show losses worth harvesting and what's better held in your 401(k) or IRA.",
    auto: "I work out your gains and losses after every sync, warn you about wash sales and, with demo advice, bring up losses worth harvesting before the year ends. I never sell anything myself.",
  },
  {
    feature: "equity",
    ask: "I work out crypto gains by lot, ESPP sales that lost their special treatment, ISO exercises with the alternative minimum tax and RSU withholding that falls short, all in your estimate. With demo advice I say how much to set aside.",
    auto: "I work out crypto gains by lot, ESPP sales that lost their special treatment, ISO exercises with the alternative minimum tax and RSU withholding that falls short, all in your estimate, and with demo advice have a goal ready for what to set aside. Putting money in is always yours.",
  },
  {
    feature: "years",
    ask: "I project your federal tax for each year ahead from your estimate and your plans, and with demo advice find moves like a Roth conversion in a low-income year, each with what it saves over the years. You decide which to put on your plan.",
    auto: "I keep your multi-year tax projection up to date and, with demo advice, bring up the move that saves the most over the years with a button to put it on your deadlines. I never convert, sell or give anything myself.",
  },
  {
    feature: "property",
    ask: "I compare your home's assessed value with its market value and, with demo advice, tell you when the gap is worth an appeal, draft it with comparable sales and name exemptions you may not have claimed. You decide who files it.",
    auto: "I compare your home's assessed value with its market value, put the appeal deadline on your plan when the gap is worth an appeal, and with demo advice draft it with comparable sales and name exemptions you may not have claimed. Filing is always on your tap: my team's or yours.",
  },
  {
    feature: "accountant",
    ask: "When your taxes include things people usually bring an accountant to, I say so. If you make a read-only link, I put your tax pack, the forms I collected and my questions on it, and bring their answers back here. The link ends when you say and every time it is opened is logged.",
    auto: "When your taxes include things people usually bring an accountant to, I say so, and I keep my questions for them up to date. Making and sharing a link is always your tap. It ends when you say, you can revoke it any time, and every time it is opened is logged.",
  },
  {
    feature: "calendar",
    ask: "I keep your tax calendar and, each month, tell you what is due: the IP PIN in January, forms as they come in, estimated payments a few days before they are due, a withholding check in June, the year-end moves in December and your refund after you file. Anything that moves money, I ask first.",
    auto: "I run your tax calendar: the IP PIN reminder in January, the form chase, each estimated payment paid a few days before it is due if it is within your cap for taxes (above it, I ask), a withholding check in June, the year-end moves on your deadlines in December, and your refund tracked after you file. Signing and filing your return are always yours.",
  },
  {
    feature: "business",
    ask: "For a business owner I work out your qualified business income deduction and, with demo advice, whether an S corporation would save more than its payroll and filing costs at your profit, with a salary range to start from. A tax professional sets up the election.",
    auto: "For a business owner I keep your qualified business income deduction and the S corporation comparison current and, with demo advice, bring it up when it would save more than it costs. I never file the election.",
  },
  {
    feature: "inheritance",
    ask: "If you inherit an IRA I tell you the date it has to be empty by and, with demo advice, how taking it out evenly could keep your tax lower. I flag a gift to one person over the yearly exclusion, which needs a gift tax return. These are facts for a tax professional to confirm, not legal advice.",
    auto: "I watch for an inherited IRA and gifts over the yearly exclusion and tell you what applies and by when, with demo advice on spreading withdrawals. These are facts for a tax professional to confirm, not legal advice. I never file a return.",
  },
  {
    feature: "health",
    ask: "If you buy a Marketplace plan I check its credit against your real income every month and warn you as soon as a rise would make you pay some back. I watch your HSA deposits against the limit before you file, and tell you when a year of medical bills is worth itemizing. Telling the Marketplace or your HSA provider is yours.",
    auto: "I keep checking your income against the Marketplace credit, your HSA against its limit and your medical costs against the 7.5% floor, and bring each up with the numbers as soon as it matters. I contact no one: telling the Marketplace or your HSA provider is yours.",
  },
  {
    feature: "identity",
    ask: "Every January I remind you to get an IRS Identity Protection PIN. If your return is rejected because one was already filed, or a letter reads like an identity problem, I ask, and if it is I give you the steps in order and keep track of each.",
    auto: "Every January I put getting your IRS Identity Protection PIN on your deadlines. If your return is rejected because one was already filed, or a letter reads like an identity problem, I ask, and if it is I give you the steps in order and keep track of each. The steps are yours: I never contact the IRS or a bureau.",
  },
  {
    feature: "notices",
    ask: "When you upload a letter from the IRS or your state, I read it for you to confirm, put its date on your deadlines, check it against your records and draft a reply. You choose agree, pay or disagree, and whether my team or you sends it. I never pay or send anything myself.",
    auto: "When you upload a letter from the IRS or your state, I read it for you to confirm, put its date on your deadlines, check it against your records, draft a reply and remind you as the date gets close. You choose agree, pay or disagree, and whether my team or you sends it. I never pay or send anything myself.",
  },
  {
    feature: "side_income",
    ask: "I count rent less the expenses you tag and depreciation on the building, match each gig platform's payouts to its 1099, and with demo advice show your side income taxed as a business and as a hobby. Which it is is your call.",
    auto: "I count rent less tagged expenses and depreciation, match each gig platform's payouts to its 1099, put rental profit on your quarterly amounts, and with demo advice show your side income taxed as a business and as a hobby. Which it is is your call.",
  },
  {
    feature: "last_return",
    ask: "When you upload a return you filed, I read it for you to confirm and, with demo advice, check it against your accounts for money left behind. If an amended return is worth it, I prepare it; you review and sign.",
    auto: "When you upload a return you filed, I read it for you to confirm and, with demo advice, check it against your accounts for money left behind. If an amended return is worth it, I have it ready for you to review. Only you can confirm a reading or sign an amended return.",
  },
  {
    feature: "records",
    ask: "I tie every deduction and credit to its transactions, receipts and forms in an audit pack for each year, list what's still needed, and tell you when a year's records can be thrown away, with a reminder if you want one.",
    auto: "I tie every deduction and credit to its transactions, receipts and forms in an audit pack for each year, list what's still needed, and put a reminder on your deadlines a month before a year's records can be thrown away. I never delete anything.",
  },
  {
    feature: "home",
    ask: "I find your mortgage interest (from your 1098 or your lender), property tax payments and energy work, apply the state and local tax cap, and work out the gain on a home sale against the exclusion, each figure linked to where it came from.",
    auto: "I find your mortgage interest, property tax payments and energy work after every sync, apply the state and local tax cap, count property tax in your estimate, and work out the gain on a home sale against the exclusion, each figure linked to where it came from.",
  },
  {
    feature: "family",
    ask: "With demo advice, I compare your family's tax choices (claiming the children, a dependent care FSA or the credit, which education credit, a 529's state break, filing jointly or separately) and show both sides' tax. Choosing is yours.",
    auto: "With demo advice, I compare your family's tax choices after every sync, using your college plans and childcare and tuition spending, and tell you when one side saves money. Choosing is yours.",
  },
  {
    feature: "giving",
    ask: "I find your gifts to charity, ask for the receipt on each of $250 or more and, with demo advice, show before the year ends how bunching, a donor-advised fund or giving shares would change your tax.",
    auto: "I find your gifts to charity, put getting each missing receipt on your deadlines and, with demo advice, show before the year ends how bunching, a donor-advised fund or giving shares would change your tax. The gifts themselves are always yours.",
  },
  {
    feature: "plan",
    ask: "I keep a calendar of tax moves with their deadlines (contributions, estimated payments, year-end sales and gifts, a W-4 check after a new job or baby) and bring each up when it's time, ready to put on your deadlines.",
    auto: "I keep a calendar of tax moves with their deadlines and, when each one's time comes, put it on your deadlines myself and tell you. The contributions, payments, sales and gifts themselves are always yours.",
  },
  {
    feature: "documents",
    ask: "From late January I collect your tax forms (W-2s, 1099s, 1098s) when they're ready and check each one against your accounts. I show you each form; one that doesn't match is flagged and never used until you say it's right.",
    auto: "From late January I collect your tax forms when they're ready, check each one against your accounts and tick off the ones that match. One that doesn't match is flagged and never used until you say it's right; one that's late gets a nudge to ask the payer.",
  },
  {
    feature: "states",
    ask: "I work out your state taxes, split between states when you move or work for an employer in another state, with any city income tax. When your payments to state agencies switch to a new state, I ask whether you moved.",
    auto: "I work out your state taxes, split between states when you move or work for an employer in another state, with any city income tax. When your payments to state agencies switch to a new state, I count it as a move straight away and ask you to check it.",
  },
  {
    feature: "tags",
    ask: "I tag donations, medical, childcare and education spending as it comes in, and ask about anything I'm unsure of.",
    auto: "I tag donations, medical, childcare and education spending as it comes in, ask about anything I'm unsure of, and tell you each month what I tagged.",
  },
];

export function whatJaneDoes(level: string | null): string[] {
  const auto = level === "safe" || level === "all" || level === "custom";
  return TAX_AUTOPILOT.map((line) => (auto ? line.auto : line.ask));
}

// Whether Jane may use what she found before the person has said yes to it.
export const usesFoundAnswers = (level: string | null): boolean =>
  level === "safe" || level === "all" || level === "custom";
