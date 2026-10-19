import type { AccountBase, LiabilitiesObject, Transaction } from "plaid";
import { PFC_TAXONOMY, type PfcDetailed, type PfcPrimary } from "@/categorize/taxonomy";

// A fake bank (spec step 75) that stands in for Plaid until there are keys. It produces
// Plaid-shaped accounts, transactions and liabilities, so everything after the sync runs
// exactly as with a real bank. The data is made up but realistic, and built so each kind
// of finding shows up: subscriptions, a price rise, high phone and internet bills, bank
// fees, card interest, a trial that converted, a duplicate charge and idle cash.
//
// Deterministic: the same item, anchor date and day always give the same transactions,
// so a later sync adds only the new days. Pure.

export const DEMO_INSTITUTION = "Demo Bank (fake data)";

// The anchor is the day the demo bank was linked; one-off events are placed around it so
// they always look recent on the first scan.
export type DemoSeed = { seed: string; anchor: string };

const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// A small seeded random number in [0, 1), so amounts vary but never change between syncs.
function random(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += 0x6d2b79f5;
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const primaryOf = (detailed: PfcDetailed): PfcPrimary =>
  (Object.keys(PFC_TAXONOMY) as PfcPrimary[]).find((p) =>
    (PFC_TAXONOMY[p] as readonly string[]).includes(detailed),
  )!;

type AccountKey =
  | "checking"
  | "savings"
  | "card"
  | "mortgage"
  | "student"
  | "auto"
  | "retirement"
  | "brokerage"
  // Spec step 159: a demo HSA, only when the person links one (DemoExtra).
  | "hsa"
  // Spec step 160: a demo employer stock plan (vested RSUs).
  | "stock_plan";

export const accountId = (seed: string, key: AccountKey) => `demo-${seed}-${key}`;

type Template = {
  key: string;
  account: AccountKey;
  name: string;
  merchant: string | null;
  category: PfcDetailed;
  // Dollars; positive is money out of the account (Plaid's convention). A range varies.
  amount: number | [number, number] | ((day: string, anchor: string) => number);
};

// Charges on fixed days of every month.
const MONTHLY: (Template & { days: number[] })[] = [
  {
    key: "pay",
    account: "checking",
    name: "ACME CORP PAYROLL",
    merchant: null,
    category: "INCOME_SALARY",
    amount: -2450,
    days: [1, 15],
  },
  {
    key: "mortgage",
    account: "checking",
    name: "ROCKET MORTGAGE PAYMENT",
    merchant: "Rocket Mortgage",
    category: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
    amount: 2141.54,
    days: [1],
  },
  {
    key: "car",
    account: "checking",
    name: "TOYOTA FINANCIAL SVCS",
    merchant: "Toyota Financial Services",
    category: "LOAN_PAYMENTS_CAR_PAYMENT",
    amount: 494.1,
    days: [1],
  },
  {
    key: "insurance",
    account: "checking",
    name: "GEICO *AUTO",
    merchant: "GEICO",
    category: "GENERAL_SERVICES_INSURANCE",
    amount: 142,
    days: [2],
  },
  {
    key: "to-savings",
    account: "checking",
    name: "ONLINE TRANSFER TO SAVINGS",
    merchant: null,
    category: "TRANSFER_OUT_SAVINGS",
    amount: 250,
    days: [3],
  },
  {
    key: "from-checking",
    account: "savings",
    name: "ONLINE TRANSFER FROM CHECKING",
    merchant: null,
    category: "TRANSFER_IN_SAVINGS",
    amount: -250,
    days: [3],
  },
  {
    key: "gym",
    account: "checking",
    name: "PLANET FITNESS #0412",
    merchant: "Planet Fitness",
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    amount: 24.99,
    days: [5],
  },
  {
    key: "internet",
    account: "checking",
    name: "COMCAST XFINITY",
    merchant: "Comcast",
    category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    amount: 165,
    days: [8],
  },
  {
    key: "power",
    account: "checking",
    name: "PG&E WEB ONLINE",
    merchant: "PG&E",
    category: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    amount: [88, 141],
    days: [18],
  },
  {
    key: "phone",
    account: "checking",
    name: "VERIZON WIRELESS",
    merchant: "Verizon Wireless",
    category: "RENT_AND_UTILITIES_TELEPHONE",
    amount: 145,
    days: [20],
  },
  {
    key: "card-payment",
    account: "checking",
    name: "PAYMENT TO DEMO CARD",
    merchant: null,
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    amount: 850,
    days: [25],
  },
  {
    key: "card-paid",
    account: "card",
    name: "PAYMENT THANK YOU",
    merchant: null,
    category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    amount: -850,
    days: [26],
  },
  {
    key: "student",
    account: "checking",
    name: "NELNET STUDENT LOAN",
    merchant: "Nelnet",
    category: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    amount: 195,
    days: [28],
  },
  {
    key: "service-fee",
    account: "checking",
    name: "MONTHLY SERVICE FEE",
    merchant: null,
    category: "BANK_FEES_OTHER_BANK_FEES",
    amount: 12,
    days: [28],
  },
  {
    key: "interest-earned",
    account: "savings",
    name: "INTEREST PAYMENT",
    merchant: null,
    category: "INCOME_INTEREST_EARNED",
    amount: -1.02,
    days: [28],
  },
  {
    key: "groceries",
    account: "checking",
    name: "WHOLEFDS MKT 10234",
    merchant: "Whole Foods Market",
    category: "FOOD_AND_DRINK_GROCERIES",
    amount: [55, 125],
    days: [4, 11, 18, 25],
  },
  {
    key: "gas",
    account: "checking",
    name: "SHELL OIL 57444221",
    merchant: "Shell",
    category: "TRANSPORTATION_GAS",
    amount: [38, 56],
    days: [9, 23],
  },
  {
    key: "coffee",
    account: "checking",
    name: "STARBUCKS STORE 05521",
    merchant: "Starbucks",
    category: "FOOD_AND_DRINK_COFFEE",
    amount: [5, 8],
    days: [6, 13, 19, 27],
  },
  // The price went up 20 days before the demo bank was linked.
  {
    key: "netflix",
    account: "card",
    name: "NETFLIX.COM",
    merchant: "Netflix",
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    amount: (day, anchor) => (day >= addDays(anchor, -20) ? 17.99 : 15.49),
    days: [14],
  },
  {
    key: "hulu",
    account: "card",
    name: "HULU 877-8244858",
    merchant: "Hulu",
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    amount: 11.99,
    days: [9],
  },
  {
    key: "spotify",
    account: "card",
    name: "SPOTIFY USA",
    merchant: "Spotify",
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    amount: 11.99,
    days: [12],
  },
  {
    key: "audible",
    account: "card",
    name: "AUDIBLE*ADBL",
    merchant: "Audible",
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    amount: 14.95,
    days: [22],
  },
  {
    key: "dropbox",
    account: "card",
    name: "DROPBOX*PLUS",
    merchant: "Dropbox",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    amount: 11.99,
    days: [6],
  },
  {
    key: "nytimes",
    account: "card",
    name: "NYTIMES*DIGITAL",
    merchant: "The New York Times",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    amount: 4,
    days: [1],
  },
  {
    key: "card-interest",
    account: "card",
    name: "PURCHASE INTEREST CHARGE",
    merchant: null,
    category: "BANK_FEES_INTEREST_CHARGE",
    amount: [26, 39],
    days: [28],
  },
  {
    key: "amazon",
    account: "card",
    name: "AMZN MKTP US*2K4L91RT0",
    merchant: "Amazon",
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    amount: [14, 85],
    days: [3, 16, 24],
  },
  {
    key: "doordash",
    account: "card",
    name: "DOORDASH*CHIPOTLE",
    merchant: "DoorDash",
    category: "FOOD_AND_DRINK_RESTAURANT",
    amount: [18, 42],
    days: [7, 17, 29],
  },
  {
    key: "uber",
    account: "card",
    name: "UBER *TRIP",
    merchant: "Uber",
    category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    amount: [12, 34],
    days: [10, 21],
  },
];

// One-off events, in days from the anchor.
const ONE_OFF: (Template & { offsets: number[] })[] = [
  {
    key: "overdraft",
    account: "checking",
    name: "OVERDRAFT FEE",
    merchant: null,
    category: "BANK_FEES_OVERDRAFT_FEES",
    amount: 34,
    offsets: [-230, -110, -5],
  },
  {
    key: "late-fee",
    account: "card",
    name: "LATE FEE",
    merchant: null,
    category: "BANK_FEES_LATE_FEES",
    amount: 40,
    offsets: [-170],
  },
  {
    key: "masterclass-trial",
    account: "card",
    name: "MASTERCLASS.COM",
    merchant: "MasterClass",
    category: "GENERAL_SERVICES_EDUCATION",
    amount: 1,
    offsets: [-24],
  },
  {
    key: "masterclass",
    account: "card",
    name: "MASTERCLASS.COM",
    merchant: "MasterClass",
    category: "GENERAL_SERVICES_EDUCATION",
    amount: 120,
    offsets: [-10],
  },
  {
    key: "peacock",
    account: "card",
    name: "PEACOCK PREMIUM",
    merchant: "Peacock",
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    amount: 7.99,
    offsets: [-62, -31, -1],
  },
  {
    key: "duolingo",
    account: "card",
    name: "DUOLINGO PLUS",
    merchant: "Duolingo",
    category: "GENERAL_SERVICES_EDUCATION",
    amount: 29.99,
    offsets: [-361, -270, -179, -88],
  },
  // The same Target charge twice, a day apart.
  {
    key: "target-1",
    account: "card",
    name: "TARGET 00012345",
    merchant: "Target",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    amount: 64.2,
    offsets: [-3],
  },
  {
    key: "target-2",
    account: "card",
    name: "TARGET 00012345",
    merchant: "Target",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    amount: 64.2,
    offsets: [-2],
  },
  // A big recent purchase, for a return window on /deadlines (spec step 71).
  {
    key: "apple-store",
    account: "card",
    name: "APPLE STORE R102",
    merchant: "Apple",
    category: "GENERAL_MERCHANDISE_ELECTRONICS",
    amount: 1349,
    offsets: [-2],
  },
  // A $0.99 first charge with nothing after it yet: a trial that may end soon.
  {
    key: "paramount-trial",
    account: "card",
    name: "PARAMOUNT+",
    merchant: "Paramount+",
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    amount: 0.99,
    offsets: [-6],
  },
  // Donations and medical bills, so the tax-time pack has something to show (spec step 72).
  {
    key: "red-cross",
    account: "card",
    name: "AMERICAN RED CROSS DONATION",
    merchant: "American Red Cross",
    category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    amount: 50,
    offsets: [-150, -40],
  },
  {
    key: "pharmacy",
    account: "card",
    name: "CVS/PHARMACY #08812",
    merchant: "CVS Pharmacy",
    category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
    amount: 23.4,
    offsets: [-75, -18],
  },
  {
    key: "dentist",
    account: "checking",
    name: "BRIGHT SMILES DENTAL",
    merchant: null,
    category: "MEDICAL_DENTAL_CARE",
    amount: 180,
    offsets: [-52],
  },
  // Spec step 70: the yearly car registration, paid five months ago.
  {
    key: "dmv",
    account: "checking",
    name: "CA DMV VEHICLE REGISTRATION",
    merchant: "California DMV",
    category: "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
    amount: 212,
    offsets: [-150],
  },
];

// Spec step 109: buy now, pay later. A monthly Affirm plan (its balance and rate aren't in
// the payments, so Jane asks for them) and a Klarna Pay in 4 halfway through when the demo
// bank is linked; later syncs bring the payments still to come.
const BNPL: (Template & { offsets: number[] })[] = [
  {
    key: "affirm",
    account: "checking",
    name: "AFFIRM * PAYMENT",
    merchant: "Affirm",
    category: "LOAN_PAYMENTS_BNPL",
    amount: 89.5,
    offsets: [-140, -110, -79, -49, -18, 12, 42, 73],
  },
  {
    key: "klarna",
    account: "card",
    name: "KLARNA* PAY IN 4",
    merchant: "Klarna",
    category: "LOAN_PAYMENTS_BNPL",
    amount: 62.25,
    offsets: [-17, -3, 11, 25],
  },
];

// Spec step 70: holiday gifts every November and December, on these [month, day]s, so
// the season shows as a yearly cost to set aside for.
const SEASONAL: (Template & { dates: [month: number, day: number][] })[] = [
  {
    key: "gifts",
    account: "card",
    name: "ETSY.COM*GIFTS",
    merchant: "Etsy",
    category: "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES",
    amount: [70, 150],
    dates: [
      [11, 24],
      [11, 28],
      [12, 5],
      [12, 14],
      [12, 19],
    ],
  },
];

// How far back the first sync goes, like Plaid's days_requested.
export const DEMO_HISTORY_DAYS = 365;

function amountOf(t: Template, day: string, { seed, anchor }: DemoSeed): number {
  if (typeof t.amount === "number") return t.amount;
  if (typeof t.amount === "function") return t.amount(day, anchor);
  const [low, high] = t.amount;
  return Math.round((low + random(`${seed}|${t.key}|${day}`) * (high - low)) * 100) / 100;
}

function transaction(t: Template, day: string, demo: DemoSeed): Transaction {
  return {
    transaction_id: `demo-${demo.seed}-${t.key}-${day}`,
    account_id: accountId(demo.seed, t.account),
    date: day,
    amount: amountOf(t, day, demo),
    name: t.name,
    merchant_name: t.merchant,
    pending: false,
    personal_finance_category: {
      primary: primaryOf(t.category),
      detailed: t.category,
      confidence_level: "VERY_HIGH",
    },
  } as unknown as Transaction;
}

const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// Transactions dated after `after` (exclusive; null for the first sync) through `through`.
export function demoTransactions(
  demo: DemoSeed,
  after: string | null,
  through: string,
): Transaction[] {
  const start = after ?? addDays(through, -DEMO_HISTORY_DAYS);
  const inRange = (day: string) => day > start && day <= through;
  const out: Transaction[] = [];
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${through}T00:00:00Z`);
  for (
    let y = first.getUTCFullYear(), m = first.getUTCMonth();
    y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth());
    m === 11 ? ((m = 0), (y += 1)) : (m += 1)
  ) {
    for (const t of MONTHLY) {
      for (const dayOfMonth of t.days) {
        const d = Math.min(dayOfMonth, lastDayOfMonth(y, m));
        const day = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (inRange(day)) out.push(transaction(t, day, demo));
      }
    }
  }
  for (const t of [...ONE_OFF, ...BNPL]) {
    for (const offset of t.offsets) {
      const day = addDays(demo.anchor, offset);
      if (inRange(day)) out.push(transaction(t, day, demo));
    }
  }
  for (const t of SEASONAL) {
    for (let y = first.getUTCFullYear(); y <= last.getUTCFullYear(); y += 1) {
      for (const [month, dayOfMonth] of t.dates) {
        const day = `${y}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
        if (inRange(day)) out.push(transaction(t, day, demo));
      }
    }
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id),
  );
}

const account = (
  seed: string,
  key: AccountKey,
  name: string,
  mask: string,
  type: string,
  subtype: string,
  current: number,
): AccountBase =>
  ({
    account_id: accountId(seed, key),
    name,
    official_name: null,
    mask,
    type,
    subtype,
    balances: { current, available: null, limit: null, iso_currency_code: "USD" },
  }) as unknown as AccountBase;

export function demoAccounts({ seed }: DemoSeed, extras: readonly DemoExtra[] = []): AccountBase[] {
  return [
    account(seed, "checking", "Demo Checking", "0001", "depository", "checking", 3840.12),
    account(seed, "savings", "Demo Savings", "0002", "depository", "savings", 24310),
    account(seed, "card", "Demo Credit Card", "0003", "credit", "credit card", 2410.5),
    account(seed, "mortgage", "Demo Home Loan", "0004", "loan", "mortgage", 312400),
    account(seed, "student", "Demo Student Loan", "0005", "loan", "student", 18345),
    account(seed, "auto", "Demo Car Loan", "0006", "loan", "auto", 18020),
    account(seed, "retirement", "Demo 401(k)", "0007", "investment", "401k", 84250.4),
    account(seed, "brokerage", "Demo Brokerage", "0008", "investment", "brokerage", 12480.15),
    // Spec step 159: a demo HSA's balance is what it holds.
    ...(extras.includes("hsa")
      ? [account(seed, "hsa", "Demo HSA", "0009", "investment", "hsa", 4271.8)]
      : []),
    // Spec step 160: vested Acme shares from work, at the demo price.
    ...(extras.includes("stock_plan")
      ? [account(seed, "stock_plan", "Demo Stock Plan", "0010", "investment", "stock plan", 20460)]
      : []),
  ];
}

// Extra stand-in accounts a demo-bank person can link (spec step 159 on).
export const DEMO_EXTRAS = ["hsa", "stock_plan"] as const;
export type DemoExtra = (typeof DEMO_EXTRAS)[number];

// The next time a day of the month comes round, after `today`.
function nextDayOfMonth(today: string, dayOfMonth: number): string {
  for (let i = 1; i <= 31; i += 1) {
    const day = addDays(today, i);
    if (Number(day.slice(8)) === dayOfMonth) return day;
  }
  return addDays(today, 30);
}

const yearsAfter = (day: string, years: number) =>
  `${Number(day.slice(0, 4)) + years}${day.slice(4, 7)}-01`;

export function demoLiabilities({ seed, anchor }: DemoSeed, today: string): LiabilitiesObject {
  return {
    credit: [
      {
        account_id: accountId(seed, "card"),
        aprs: [
          {
            apr_percentage: 22.99,
            apr_type: "purchase_apr",
            balance_subject_to_apr: 2410.5,
            interest_charge_amount: 32.4,
          },
          {
            apr_percentage: 29.99,
            apr_type: "cash_apr",
            balance_subject_to_apr: 0,
            interest_charge_amount: 0,
          },
        ],
        is_overdue: false,
        last_payment_amount: 850,
        last_payment_date: null,
        last_statement_issue_date: null,
        last_statement_balance: 2410.5,
        minimum_payment_amount: 35,
        next_payment_due_date: nextDayOfMonth(today, 26),
      },
    ],
    mortgage: [
      {
        account_id: accountId(seed, "mortgage"),
        account_number: null,
        current_late_fee: null,
        escrow_balance: null,
        has_pmi: false,
        has_prepayment_penalty: false,
        interest_rate: { percentage: 3.99, type: "fixed" },
        last_payment_amount: 2141.54,
        last_payment_date: null,
        loan_term: "30 year",
        loan_type_description: "Conventional 30 year fixed",
        maturity_date: yearsAfter(anchor, 26),
        next_monthly_payment: 2141.54,
        next_payment_due_date: nextDayOfMonth(today, 1),
        origination_date: null,
        origination_principal_amount: 400000,
        past_due_amount: 0,
        property_address: null,
        ytd_interest_paid: 10230.4,
        ytd_principal_paid: 9180.25,
      },
    ],
    student: [
      {
        account_id: accountId(seed, "student"),
        account_number: null,
        disbursement_dates: null,
        expected_payoff_date: yearsAfter(anchor, 6),
        guarantor: null,
        interest_rate_percentage: 5.25,
        is_overdue: false,
        last_payment_amount: 195,
        last_payment_date: null,
        last_statement_issue_date: null,
        loan_name: "Consolidation",
        loan_status: { end_date: null, type: "repayment" },
        minimum_payment_amount: 195,
        next_payment_due_date: nextDayOfMonth(today, 28),
        origination_date: null,
        origination_principal_amount: 25000,
        outstanding_interest_amount: null,
        payment_reference_number: null,
        pslf_status: {
          estimated_eligibility_date: null,
          payments_made: null,
          payments_remaining: null,
        },
        repayment_plan: { description: "Standard Repayment", type: "standard" },
        sequence_number: null,
        servicer_address: null,
        ytd_interest_paid: 805.5,
        ytd_principal_paid: 1144.5,
      },
    ],
    loan: [
      {
        account_id: accountId(seed, "auto"),
        account_number: null,
        interest_rate: { percentage: 6.9, type: "fixed" },
        principal_balance: 18020,
        origination_principal_amount: 26000,
        origination_date: null,
        loan_term_months: 60,
        maturity_date: yearsAfter(anchor, 3),
        payment_count: null,
        payment_frequency: null,
        next_payment_amount: 494.1,
        next_payment_due_date: nextDayOfMonth(today, 1),
        last_payment_amount: 494.1,
        last_payment_date: null,
        payoff_amount: null,
        ytd_interest_paid: 1050.75,
        compounding_period: null,
      },
    ],
  } as unknown as LiabilitiesObject;
}

// A switch the person made on the demo bank (spec step 77), so the demo shows what a real
// account would: the new provider's first bill, the cheaper tier's charge, or the money
// moving out, two days after the switch started.
export type DemoSwitch = {
  actionId: string;
  kind: "plan" | "tier" | "savings";
  provider: string;
  // The service being replaced, for a tier.
  company: string | null;
  category: string | null;
  monthlyCents: number | null;
  amountCents: number | null;
  // YYYY-MM-DD the switch started.
  startDay: string;
};

export const DEMO_SWITCH_DELAY_DAYS = 2;

const SWITCH_CATEGORY: Record<string, PfcDetailed> = {
  phone: "RENT_AND_UTILITIES_TELEPHONE",
  internet_tv: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
};

export function demoSwitchTransactions(
  demo: DemoSeed,
  switches: DemoSwitch[],
  after: string | null,
  through: string,
): Transaction[] {
  return switches.flatMap((sw) => {
    const day = addDays(sw.startDay, DEMO_SWITCH_DELAY_DAYS);
    if ((after !== null && day <= after) || day > through) return [];
    const template: Template | null =
      sw.kind === "savings"
        ? sw.amountCents === null
          ? null
          : {
              key: `switch-${sw.actionId}`,
              account: "savings",
              name: `TRANSFER TO ${sw.provider.toUpperCase()}`,
              merchant: null,
              category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
              amount: sw.amountCents / 100,
            }
        : sw.monthlyCents === null
          ? null
          : {
              key: `switch-${sw.actionId}`,
              account: sw.kind === "tier" ? "card" : "checking",
              name: (sw.kind === "tier" ? (sw.company ?? sw.provider) : sw.provider).toUpperCase(),
              merchant: sw.kind === "tier" ? (sw.company ?? sw.provider) : sw.provider,
              category:
                SWITCH_CATEGORY[sw.category ?? ""] ??
                (sw.kind === "tier"
                  ? "ENTERTAINMENT_TV_AND_MOVIES"
                  : "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"),
              amount: sw.monthlyCents / 100,
            };
    return template ? [transaction(template, day, demo)] : [];
  });
}
