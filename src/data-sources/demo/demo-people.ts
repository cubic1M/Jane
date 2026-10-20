import type { AccountBase, LiabilitiesObject, Transaction } from "plaid";
import type { PfcDetailed } from "@/categorize/taxonomy";
import type { PersonId } from "@/config/people";
import { PEOPLE_EXTRAS } from "./people-extras";
import {
  accountId,
  addDays,
  type DemoSeed,
  lastDayOfMonth,
  lastDayOfMonthOn,
  nextDayOfMonth,
  primaryOf,
  random,
  yearsAfter,
} from "./demo-bank";

// The eight sample people's banks (spec step 252): each a year of transactions, accounts,
// loans and investments in the same Plaid shapes as the demo bank, so they sync through the
// same path. Deterministic and pure, like the rest of the demo bank. Who each person is and
// what Jane should and must not suggest is in src/config/people.ts.

export type Recurring = {
  key: string;
  account: string;
  name: string;
  merchant: string | null;
  category: PfcDetailed;
  // Dollars; positive is money out (Plaid's convention). A range varies by day.
  amount: number | [number, number];
  days: number[];
  // Only these months (1–12); every month when left out.
  months?: number[];
};

export type Once = Omit<Recurring, "days" | "months"> & { offsets: number[] };

export type Acct = {
  key: string;
  name: string;
  mask: string;
  type: string;
  subtype: string;
  balance: number;
  limit?: number;
};

export type Position = {
  account: string;
  key: string;
  quantity: number;
  basis: number;
  cash?: number;
};

export type Card = {
  account: string;
  apr: number;
  balance: number;
  minimum: number;
  overdue?: boolean;
};
type Mortgage = {
  account: string;
  rate: number;
  original: number;
  payment: number;
  pmi: boolean;
  escrow: number;
  yearsLeft: number;
};
type Student = {
  account: string;
  rate: number;
  original: number;
  minimum: number;
  yearsLeft: number;
};
type Auto = {
  account: string;
  rate: number;
  principal: number;
  original: number;
  payment: number;
  yearsLeft: number;
};

type Def = {
  accounts: Acct[];
  monthly: Recurring[];
  once: Once[];
  cards: Card[];
  mortgage?: Mortgage;
  student?: Student;
  auto?: Auto;
  positions: Position[];
};

const R = (
  key: string,
  account: string,
  name: string,
  category: PfcDetailed,
  amount: Recurring["amount"],
  days: number[],
  merchant: string | null = name,
  months?: number[],
): Recurring => ({ key, account, name, merchant, category, amount, days, months });

const O = (
  key: string,
  account: string,
  name: string,
  category: PfcDetailed,
  amount: Once["amount"],
  offsets: number[],
  merchant: string | null = name,
): Once => ({ key, account, name, merchant, category, amount, offsets });

// The things nearly everyone pays, so each life has groceries and a phone bill.
const living = (account: string, groceries: [number, number], phone: number, power: number) => [
  R(
    "groceries",
    account,
    "KROGER",
    "FOOD_AND_DRINK_GROCERIES",
    groceries,
    [3, 9, 16, 23, 28],
    "Kroger",
  ),
  R("phone", account, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE", phone, [12], "Verizon"),
  R(
    "power",
    account,
    "CITY POWER & LIGHT",
    "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    [power * 0.8, power * 1.2],
    [18],
    "City Power & Light",
  ),
];

const streaming = (
  account: string,
  ...which: ("netflix" | "spotify" | "hulu" | "gym" | "icloud")[]
) =>
  which.map((w) =>
    w === "netflix"
      ? R("netflix", account, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES", 15.49, [7], "Netflix")
      : w === "spotify"
        ? R(
            "spotify",
            account,
            "SPOTIFY USA",
            "ENTERTAINMENT_MUSIC_AND_AUDIO",
            11.99,
            [11],
            "Spotify",
          )
        : w === "hulu"
          ? R("hulu", account, "HULU", "ENTERTAINMENT_TV_AND_MOVIES", 17.99, [14], "Hulu")
          : w === "gym"
            ? R(
                "gym",
                account,
                "PLANET FITNESS",
                "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
                49,
                [5],
                "Planet Fitness",
              )
            : R(
                "icloud",
                account,
                "APPLE.COM/BILL",
                "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
                9.99,
                [20],
                "Apple",
              ),
  );

const DEFS: Record<PersonId, Def> = {
  // 24, first job at a small company, renting, a card balance, overdrafts, a thin 401(k).
  renter: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "1001",
        type: "depository",
        subtype: "checking",
        balance: 1120.4,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "1002",
        type: "depository",
        subtype: "savings",
        balance: 640,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "1003",
        type: "credit",
        subtype: "credit card",
        balance: 1940.2,
        limit: 3000,
      },
      {
        key: "student",
        name: "Demo Student Loan",
        mask: "1004",
        type: "loan",
        subtype: "student",
        balance: 14200,
      },
      {
        key: "retirement",
        name: "Demo 401(k)",
        mask: "1005",
        type: "investment",
        subtype: "401k",
        balance: 0,
      },
    ],
    monthly: [
      R("pay", "checking", "BRIGHTLY INC PAYROLL", "INCOME_SALARY", -1640, [1, 15], null),
      R(
        "rent",
        "checking",
        "OAKWOOD APARTMENTS",
        "RENT_AND_UTILITIES_RENT",
        1450,
        [1],
        "Oakwood Apartments",
      ),
      R(
        "student",
        "checking",
        "NELNET STUDENT LOAN",
        "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
        160,
        [20],
        "Nelnet",
      ),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        90,
        [25],
        null,
      ),
      R(
        "internet",
        "checking",
        "XFINITY",
        "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        74.99,
        [9],
        "Xfinity",
      ),
      R(
        "dining",
        "card",
        "CHIPOTLE",
        "FOOD_AND_DRINK_RESTAURANT",
        [60, 110],
        [4, 11, 19, 26],
        "Chipotle",
      ),
      R("interest", "card", "INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE", 46.4, [26], null),
      ...living("checking", [38, 72], 62, 58),
      ...streaming("card", "netflix", "spotify", "hulu", "gym", "icloud"),
    ],
    once: [
      O(
        "overdraft",
        "checking",
        "OVERDRAFT FEE",
        "BANK_FEES_OVERDRAFT_FEES",
        35,
        [-200, -75, -12],
        null,
      ),
    ],
    cards: [{ account: "card", apr: 26.99, balance: 1940.2, minimum: 58 }],
    student: { account: "student", rate: 5.5, original: 16000, minimum: 160, yearsLeft: 8 },
    positions: [
      { account: "retirement", key: "NSTDX", quantity: 78.4, basis: 1900 },
      { account: "retirement", key: "CASH", quantity: 0, basis: 0, cash: 0 },
    ],
  },
  // Two earners, two kids, a mortgage with PMI, childcare, a car loan.
  family: {
    accounts: [
      {
        key: "checking",
        name: "Demo Joint Checking",
        mask: "2001",
        type: "depository",
        subtype: "checking",
        balance: 4280.6,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "2002",
        type: "depository",
        subtype: "savings",
        balance: 9100,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "2003",
        type: "credit",
        subtype: "credit card",
        balance: 3120,
        limit: 12000,
      },
      {
        key: "mortgage",
        name: "Demo Home Loan",
        mask: "2004",
        type: "loan",
        subtype: "mortgage",
        balance: 338000,
      },
      {
        key: "auto",
        name: "Demo Car Loan",
        mask: "2005",
        type: "loan",
        subtype: "auto",
        balance: 21400,
      },
      {
        key: "retirement",
        name: "Demo 401(k)",
        mask: "2006",
        type: "investment",
        subtype: "401k",
        balance: 0,
      },
    ],
    monthly: [
      R("pay1", "checking", "NORTHWIND HEALTH PAYROLL", "INCOME_SALARY", -2850, [1, 15], null),
      R("pay2", "checking", "SPRINGFIELD SCHOOLS PAYROLL", "INCOME_SALARY", -2480, [5, 20], null),
      R(
        "mortgage",
        "checking",
        "CHASE MORTGAGE",
        "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
        2412.6,
        [1],
        "Chase",
      ),
      R(
        "car",
        "checking",
        "HONDA FINANCIAL",
        "LOAN_PAYMENTS_CAR_PAYMENT",
        468,
        [8],
        "Honda Financial",
      ),
      R(
        "childcare",
        "checking",
        "BRIGHT HORIZONS",
        "GENERAL_SERVICES_CHILDCARE",
        1650,
        [3],
        "Bright Horizons",
      ),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        650,
        [24],
        null,
      ),
      R(
        "kids",
        "card",
        "YMCA YOUTH SPORTS",
        "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
        95,
        [6],
        "YMCA",
      ),
      R(
        "dining",
        "card",
        "OLIVE GARDEN",
        "FOOD_AND_DRINK_RESTAURANT",
        [70, 150],
        [7, 14, 21],
        "Olive Garden",
      ),
      R(
        "autoins",
        "checking",
        "STATE FARM AUTO",
        "GENERAL_SERVICES_INSURANCE",
        212,
        [10],
        "State Farm",
      ),
      R(
        "homeins",
        "checking",
        "STATE FARM HOME",
        "GENERAL_SERVICES_INSURANCE",
        138,
        [10],
        "State Farm",
      ),
      R(
        "water",
        "checking",
        "CITY WATER",
        "RENT_AND_UTILITIES_WATER",
        [48, 66],
        [15],
        "City Water",
      ),
      R(
        "internet",
        "checking",
        "XFINITY",
        "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        89.99,
        [9],
        "Xfinity",
      ),
      ...living("checking", [210, 340], 148, 190),
      ...streaming("card", "netflix", "spotify", "hulu", "gym"),
      R("disney", "card", "DISNEY PLUS", "ENTERTAINMENT_TV_AND_MOVIES", 13.99, [17], "Disney+"),
    ],
    once: [],
    cards: [{ account: "card", apr: 21.49, balance: 3120, minimum: 78 }],
    mortgage: {
      account: "mortgage",
      rate: 3.25,
      original: 372000,
      payment: 2412.6,
      pmi: true,
      escrow: 5100,
      yearsLeft: 26,
    },
    auto: {
      account: "auto",
      rate: 5.4,
      principal: 21400,
      original: 29000,
      payment: 468,
      yearsLeft: 4,
    },
    positions: [
      { account: "retirement", key: "NSTDX", quantity: 2610, basis: 52000 },
      { account: "retirement", key: "KTSIX", quantity: 190, basis: 21000 },
      { account: "retirement", key: "CASH", quantity: 0, basis: 0, cash: 1800 },
    ],
  },
  // Paid by clients at irregular times; no tax withheld; solo.
  freelancer: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "3001",
        type: "depository",
        subtype: "checking",
        balance: 5320.75,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "3002",
        type: "depository",
        subtype: "savings",
        balance: 6400,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "3003",
        type: "credit",
        subtype: "credit card",
        balance: 1180,
        limit: 9000,
      },
    ],
    monthly: [
      R(
        "client1",
        "checking",
        "STRIPE TRANSFER - ALDER DESIGN",
        "INCOME_CONTRACTOR",
        [-4200, -1500],
        [4],
        null,
        [1, 2, 4, 5, 7, 8, 10, 11],
      ),
      R(
        "client2",
        "checking",
        "PAYPAL TRANSFER",
        "INCOME_CONTRACTOR",
        [-3600, -900],
        [19],
        null,
        [1, 3, 4, 6, 7, 9, 10, 12],
      ),
      R(
        "client3",
        "checking",
        "ZELLE FROM HARBOR MEDIA",
        "INCOME_CONTRACTOR",
        [-2800, -1200],
        [27],
        null,
        [2, 3, 5, 6, 8, 9, 11, 12],
      ),
      R(
        "rent",
        "checking",
        "WESTSIDE PROPERTIES",
        "RENT_AND_UTILITIES_RENT",
        1850,
        [1],
        "Westside Properties",
      ),
      R(
        "health",
        "checking",
        "HEALTHCARE.GOV MARKETPLACE",
        "GENERAL_SERVICES_INSURANCE",
        412,
        [3],
        "Healthcare Marketplace",
      ),
      R("cowork", "card", "WEWORK", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", 285, [2], "WeWork"),
      R(
        "adobe",
        "card",
        "ADOBE CREATIVE CLOUD",
        "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        59.99,
        [8],
        "Adobe",
      ),
      R("figma", "card", "FIGMA", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", 15, [13], "Figma"),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        1180,
        [24],
        null,
      ),
      R(
        "dining",
        "card",
        "BLUE BOTTLE COFFEE",
        "FOOD_AND_DRINK_COFFEE",
        [18, 42],
        [5, 12, 20, 26],
        "Blue Bottle",
      ),
      ...living("checking", [60, 120], 70, 70),
      ...streaming("card", "netflix", "spotify"),
    ],
    once: [],
    cards: [{ account: "card", apr: 19.99, balance: 1180, minimum: 35 }],
    positions: [],
  },
  // Big salary, RSUs, a big house, idle cash.
  equity: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "4001",
        type: "depository",
        subtype: "checking",
        balance: 14200,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "4002",
        type: "depository",
        subtype: "savings",
        balance: 92000,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "4003",
        type: "credit",
        subtype: "credit card",
        balance: 3400,
        limit: 30000,
      },
      {
        key: "mortgage",
        name: "Demo Home Loan",
        mask: "4004",
        type: "loan",
        subtype: "mortgage",
        balance: 910000,
      },
      {
        key: "retirement",
        name: "Demo 401(k)",
        mask: "4005",
        type: "investment",
        subtype: "401k",
        balance: 0,
      },
      {
        key: "brokerage",
        name: "Demo Brokerage",
        mask: "4006",
        type: "investment",
        subtype: "brokerage",
        balance: 0,
      },
      {
        key: "stock_plan",
        name: "Demo Stock Plan",
        mask: "4007",
        type: "investment",
        subtype: "stock plan",
        balance: 0,
      },
      {
        key: "hsa",
        name: "Demo HSA",
        mask: "4008",
        type: "investment",
        subtype: "hsa",
        balance: 0,
      },
    ],
    monthly: [
      R("pay", "checking", "ACME CORP PAYROLL", "INCOME_SALARY", -5400, [1, 15], null),
      R(
        "mortgage",
        "checking",
        "WELLS FARGO HOME MORTGAGE",
        "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
        5980.4,
        [1],
        "Wells Fargo",
      ),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        3400,
        [24],
        null,
      ),
      R("dining", "card", "NOBU", "FOOD_AND_DRINK_RESTAURANT", [140, 380], [5, 12, 19, 26], "Nobu"),
      R(
        "travel",
        "card",
        "UNITED AIRLINES",
        "TRAVEL_FLIGHTS",
        [320, 980],
        [9],
        "United Airlines",
        [2, 5, 8, 11],
      ),
      R("homeins", "checking", "CHUBB HOME", "GENERAL_SERVICES_INSURANCE", 410, [10], "Chubb"),
      ...living("checking", [260, 420], 165, 240),
      ...streaming("card", "netflix", "spotify", "hulu", "gym", "icloud"),
    ],
    once: [],
    cards: [{ account: "card", apr: 20.24, balance: 3400, minimum: 85 }],
    mortgage: {
      account: "mortgage",
      rate: 6.9,
      original: 940000,
      payment: 5980.4,
      pmi: false,
      escrow: 14800,
      yearsLeft: 28,
    },
    positions: [
      { account: "retirement", key: "NSTDX", quantity: 2900, basis: 61000 },
      { account: "retirement", key: "CASH", quantity: 0, basis: 0, cash: 2000 },
      { account: "brokerage", key: "KTSIX", quantity: 260, basis: 29000 },
      { account: "brokerage", key: "CASH", quantity: 0, basis: 0, cash: 4200 },
      { account: "stock_plan", key: "ACME", quantity: 1900, basis: 170000 },
      { account: "stock_plan", key: "CASH", quantity: 0, basis: 0, cash: 0 },
      { account: "hsa", key: "CASH", quantity: 0, basis: 0, cash: 1900 },
    ],
  },
  // Early 60s, working, home nearly paid, big 401(k).
  preretire: {
    accounts: [
      {
        key: "checking",
        name: "Demo Joint Checking",
        mask: "5001",
        type: "depository",
        subtype: "checking",
        balance: 9100,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "5002",
        type: "depository",
        subtype: "savings",
        balance: 58000,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "5003",
        type: "credit",
        subtype: "credit card",
        balance: 1640,
        limit: 20000,
      },
      {
        key: "mortgage",
        name: "Demo Home Loan",
        mask: "5004",
        type: "loan",
        subtype: "mortgage",
        balance: 61500,
      },
      {
        key: "retirement",
        name: "Demo 401(k)",
        mask: "5005",
        type: "investment",
        subtype: "401k",
        balance: 0,
      },
      {
        key: "brokerage",
        name: "Demo Brokerage",
        mask: "5006",
        type: "investment",
        subtype: "brokerage",
        balance: 0,
      },
    ],
    monthly: [
      R("pay1", "checking", "MERIDIAN LOGISTICS PAYROLL", "INCOME_SALARY", -3250, [1, 15], null),
      R("pay2", "checking", "COUNTY LIBRARY PAYROLL", "INCOME_SALARY", -1650, [5, 20], null),
      R(
        "mortgage",
        "checking",
        "US BANK MORTGAGE",
        "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
        1210,
        [1],
        "U.S. Bank",
      ),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        1640,
        [24],
        null,
      ),
      R("autoins", "checking", "AAA AUTO", "GENERAL_SERVICES_INSURANCE", 164, [10], "AAA"),
      R("homeins", "checking", "AAA HOME", "GENERAL_SERVICES_INSURANCE", 121, [10], "AAA"),
      R(
        "dining",
        "card",
        "CARRABBAS",
        "FOOD_AND_DRINK_RESTAURANT",
        [60, 140],
        [6, 13, 27],
        "Carrabba's",
      ),
      R("travel", "card", "DELTA AIR LINES", "TRAVEL_FLIGHTS", [250, 700], [8], "Delta", [4, 9]),
      ...living("checking", [150, 240], 110, 170),
      ...streaming("card", "netflix", "spotify"),
    ],
    once: [],
    cards: [{ account: "card", apr: 17.99, balance: 1640, minimum: 40 }],
    mortgage: {
      account: "mortgage",
      rate: 3.5,
      original: 240000,
      payment: 1210,
      pmi: false,
      escrow: 3300,
      yearsLeft: 5,
    },
    positions: [
      { account: "retirement", key: "ACME", quantity: 1700, basis: 90000 },
      { account: "retirement", key: "NSTDX", quantity: 6200, basis: 118000 },
      { account: "retirement", key: "KTBIX", quantity: 2400, basis: 24000 },
      { account: "retirement", key: "CASH", quantity: 0, basis: 0, cash: 0 },
      { account: "brokerage", key: "KTSIX", quantity: 310, basis: 38000 },
      { account: "brokerage", key: "CASH", quantity: 0, basis: 0, cash: 7200 },
    ],
  },
  // 71, Social Security and a pension, withdrawing from an IRA, owns outright.
  retiree: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "6001",
        type: "depository",
        subtype: "checking",
        balance: 7400,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "6002",
        type: "depository",
        subtype: "savings",
        balance: 64000,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "6003",
        type: "credit",
        subtype: "credit card",
        balance: 420,
        limit: 8000,
      },
      {
        key: "ira",
        name: "Demo Traditional IRA",
        mask: "6004",
        type: "investment",
        subtype: "ira",
        balance: 0,
      },
    ],
    monthly: [
      R("ss", "checking", "SSA TREAS 310 XXSOC SEC", "INCOME_OTHER", -2680, [3], null),
      R(
        "pension",
        "checking",
        "STATE TEACHERS RETIREMENT",
        "INCOME_RETIREMENT_PENSION",
        -1840,
        [1],
        null,
      ),
      R(
        "irawd",
        "checking",
        "IRA DISTRIBUTION",
        "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
        -1500,
        [15],
        null,
        [1, 4, 7, 10],
      ),
      R(
        "medicare",
        "checking",
        "CMS MEDICARE PREMIUM",
        "MEDICAL_OTHER_MEDICAL",
        174.7,
        [3],
        "Medicare",
      ),
      R("partd", "checking", "HUMANA PART D", "GENERAL_SERVICES_INSURANCE", 38, [5], "Humana"),
      R(
        "medigap",
        "checking",
        "AARP MEDICARE SUPPLEMENT",
        "GENERAL_SERVICES_INSURANCE",
        241,
        [5],
        "AARP",
      ),
      R(
        "homeins",
        "checking",
        "ALLSTATE HOME",
        "GENERAL_SERVICES_INSURANCE",
        132,
        [10],
        "Allstate",
      ),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        420,
        [24],
        null,
      ),
      R(
        "pharmacy",
        "card",
        "CVS PHARMACY",
        "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
        [24, 80],
        [8, 22],
        "CVS",
      ),
      R("sirius", "card", "SIRIUSXM", "ENTERTAINMENT_MUSIC_AND_AUDIO", 23.99, [14], "SiriusXM"),
      R(
        "aarp",
        "card",
        "NEWSPAPER DIGITAL",
        "ENTERTAINMENT_OTHER_ENTERTAINMENT",
        19.99,
        [16],
        "Daily Herald",
      ),
      R(
        "cable",
        "checking",
        "XFINITY",
        "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        168,
        [9],
        "Xfinity",
      ),
      ...living("checking", [90, 150], 55, 140),
      ...streaming("card", "netflix"),
    ],
    once: [],
    cards: [{ account: "card", apr: 16.99, balance: 420, minimum: 25 }],
    positions: [
      { account: "ira", key: "NSTDX", quantity: 7800, basis: 190000 },
      { account: "ira", key: "KTBIX", quantity: 8200, basis: 82000 },
      { account: "ira", key: "CASH", quantity: 0, basis: 0, cash: 24000 },
    ],
  },
  // Many cards near their limits, overdrafts, a payday loan, a car loan.
  debt: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "7001",
        type: "depository",
        subtype: "checking",
        balance: 38.2,
      },
      {
        key: "card",
        name: "Demo Credit Card A",
        mask: "7002",
        type: "credit",
        subtype: "credit card",
        balance: 4720,
        limit: 5000,
      },
      {
        key: "card2",
        name: "Demo Credit Card B",
        mask: "7003",
        type: "credit",
        subtype: "credit card",
        balance: 3880,
        limit: 4000,
      },
      {
        key: "card3",
        name: "Demo Store Card",
        mask: "7004",
        type: "credit",
        subtype: "credit card",
        balance: 1490,
        limit: 1500,
      },
      {
        key: "auto",
        name: "Demo Car Loan",
        mask: "7005",
        type: "loan",
        subtype: "auto",
        balance: 12800,
      },
    ],
    monthly: [
      R("pay", "checking", "SUNRISE STAFFING PAYROLL", "INCOME_SALARY", -1210, [1, 15], null),
      R(
        "rent",
        "checking",
        "PARKVIEW APARTMENTS",
        "RENT_AND_UTILITIES_RENT",
        1180,
        [2],
        "Parkview Apartments",
      ),
      R(
        "car",
        "checking",
        "CREDIT ACCEPTANCE",
        "LOAN_PAYMENTS_CAR_PAYMENT",
        396,
        [8],
        "Credit Acceptance",
      ),
      R("paya", "checking", "CARD A PAYMENT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", 140, [20], null),
      R("payb", "checking", "CARD B PAYMENT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", 110, [21], null),
      R(
        "payday",
        "checking",
        "ADVANCE AMERICA LOAN",
        "LOAN_PAYMENTS_CASH_ADVANCES",
        345,
        [16],
        "Advance America",
      ),
      R("interesta", "card", "INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE", 108, [20], null),
      R("interestb", "card2", "INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE", 94, [21], null),
      R("interestc", "card3", "INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE", 36, [22], null),
      R(
        "fast",
        "card",
        "MCDONALDS",
        "FOOD_AND_DRINK_FAST_FOOD",
        [14, 28],
        [4, 10, 17, 24],
        "McDonald's",
      ),
      ...living("checking", [28, 54], 58, 66),
      ...streaming("card2", "netflix", "hulu", "gym"),
    ],
    once: [
      O(
        "overdraft",
        "checking",
        "OVERDRAFT FEE",
        "BANK_FEES_OVERDRAFT_FEES",
        35,
        [-300, -250, -190, -130, -70, -20],
        null,
      ),
      O("late", "card", "LATE FEE", "BANK_FEES_LATE_FEES", 40, [-220, -140, -60], null),
      O(
        "nsf",
        "checking",
        "INSUFFICIENT FUNDS FEE",
        "BANK_FEES_INSUFFICIENT_FUNDS",
        30,
        [-160, -45],
        null,
      ),
    ],
    cards: [
      { account: "card", apr: 29.99, balance: 4720, minimum: 165, overdue: true },
      { account: "card2", apr: 27.99, balance: 3880, minimum: 130 },
      { account: "card3", apr: 31.99, balance: 1490, minimum: 55 },
    ],
    auto: {
      account: "auto",
      rate: 17.9,
      principal: 12800,
      original: 16000,
      payment: 396,
      yearsLeft: 3,
    },
    positions: [],
  },
  // Runs a shop through an LLC; business and personal money mixed.
  owner: {
    accounts: [
      {
        key: "checking",
        name: "Demo Checking",
        mask: "8001",
        type: "depository",
        subtype: "checking",
        balance: 11800.3,
      },
      {
        key: "savings",
        name: "Demo Savings",
        mask: "8002",
        type: "depository",
        subtype: "savings",
        balance: 28000,
      },
      {
        key: "card",
        name: "Demo Credit Card",
        mask: "8003",
        type: "credit",
        subtype: "credit card",
        balance: 6900,
        limit: 15000,
      },
      {
        key: "auto",
        name: "Demo Equipment Loan",
        mask: "8004",
        type: "loan",
        subtype: "auto",
        balance: 24500,
      },
    ],
    monthly: [
      R("sales", "checking", "SQUARE DEPOSIT", "INCOME_OTHER", [-9800, -6200], [2, 9, 16, 23, 30]),
      R(
        "rent",
        "checking",
        "MAIN ST COMMERCIAL RENT",
        "RENT_AND_UTILITIES_RENT",
        2400,
        [1],
        "Main St Commercial",
      ),
      R("homerent", "checking", "HOME RENT", "RENT_AND_UTILITIES_RENT", 1650, [1], null),
      R(
        "payroll",
        "checking",
        "GUSTO PAYROLL",
        "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
        4300,
        [14, 28],
        "Gusto",
      ),
      R(
        "supplies",
        "card",
        "SYSCO FOODSERVICE",
        "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
        [1800, 2600],
        [5, 19],
        "Sysco",
      ),
      R(
        "equip",
        "checking",
        "KUBOTA CREDIT",
        "LOAN_PAYMENTS_OTHER_PAYMENT",
        612,
        [12],
        "Kubota Credit",
      ),
      R("grocery", "card", "COSTCO", "FOOD_AND_DRINK_GROCERIES", [180, 290], [7, 21], "Costco"),
      R(
        "qb",
        "card",
        "INTUIT QUICKBOOKS",
        "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
        45,
        [10],
        "QuickBooks",
      ),
      R("sqfee", "checking", "SQUARE FEES", "BANK_FEES_OTHER_BANK_FEES", [180, 260], [3]),
      R(
        "cardpay",
        "checking",
        "CARD PAYMENT THANK YOU",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        900,
        [24],
        null,
      ),
      R(
        "salestax",
        "checking",
        "STATE DEPT OF REVENUE SALES TAX",
        "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        [980, 1300],
        [20],
        "State Dept of Revenue",
        [1, 4, 7, 10],
      ),
      ...living("checking", [80, 140], 120, 180),
      ...streaming("card", "netflix", "spotify"),
    ],
    once: [],
    cards: [{ account: "card", apr: 23.49, balance: 6900, minimum: 180 }],
    auto: {
      account: "auto",
      rate: 8.9,
      principal: 24500,
      original: 31000,
      payment: 612,
      yearsLeft: 4,
    },
    positions: [],
  },
};

// What a lane adds to a person's life, so the lanes' detectors have signals to find without
// editing this file together: one file per lane in ./people-extras, each a map from person id
// to extra recurring charges, one-offs, accounts, cards and holdings, merged here. Keys
// (transaction keys, account keys) must be unique across all files.
export type PersonExtra = Partial<
  Pick<Def, "accounts" | "monthly" | "once" | "cards" | "positions">
>;

const merged = (id: PersonId): Def => {
  const base = DEFS[id];
  const extras = PEOPLE_EXTRAS.flatMap((lane) => lane[id] ?? []);
  return {
    ...base,
    accounts: [...base.accounts, ...extras.flatMap((e) => e.accounts ?? [])],
    monthly: [...base.monthly, ...extras.flatMap((e) => e.monthly ?? [])],
    once: [...base.once, ...extras.flatMap((e) => e.once ?? [])],
    cards: [...base.cards, ...extras.flatMap((e) => e.cards ?? [])],
    positions: [...base.positions, ...extras.flatMap((e) => e.positions ?? [])],
  };
};

const defOf = (demo: DemoSeed): Def =>
  merged(((demo.person ?? "family") in DEFS ? demo.person : "family") as PersonId);

export const isPersonSeed = (demo: DemoSeed) => Boolean(demo.person && demo.person in DEFS);

export function personTransactions(
  demo: DemoSeed,
  after: string | null,
  through: string,
): Transaction[] {
  const def = defOf(demo);
  const start = after ?? addDays(through, -365);
  const inRange = (day: string) => day > start && day <= through;
  const out: Transaction[] = [];
  const make = (t: Omit<Recurring, "days" | "months">, day: string): Transaction => {
    const [low, high] = Array.isArray(t.amount) ? t.amount : [t.amount, t.amount];
    const amount =
      Math.round((low + random(`${demo.seed}|${t.key}|${day}`) * (high - low)) * 100) / 100;
    return {
      transaction_id: `demo-${demo.seed}-${t.key}-${day}`,
      account_id: accountId(demo.seed, t.account),
      date: day,
      amount,
      name: t.name,
      merchant_name: t.merchant,
      pending: false,
      personal_finance_category: {
        primary: primaryOf(t.category),
        detailed: t.category,
        confidence_level: "VERY_HIGH",
      },
    } as unknown as Transaction;
  };
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${through}T00:00:00Z`);
  for (
    let y = first.getUTCFullYear(), m = first.getUTCMonth();
    y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth());
    m === 11 ? ((m = 0), (y += 1)) : (m += 1)
  ) {
    for (const t of def.monthly) {
      if (t.months && !t.months.includes(m + 1)) continue;
      for (const dayOfMonth of t.days) {
        const d = Math.min(dayOfMonth, lastDayOfMonth(y, m));
        const day = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (inRange(day)) out.push(make(t, day));
      }
    }
  }
  for (const t of def.once) {
    for (const offset of t.offsets) {
      const day = addDays(demo.anchor, offset);
      if (inRange(day)) out.push(make(t, day));
    }
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.transaction_id.localeCompare(b.transaction_id),
  );
}

// Plaid-shaped accounts. An investment account's balance is filled in from what it holds.
export function personAccounts(demo: DemoSeed): AccountBase[] {
  return defOf(demo).accounts.map(
    (a) =>
      ({
        account_id: accountId(demo.seed, a.key),
        name: a.name,
        official_name: null,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        balances: {
          current: a.balance,
          available: null,
          limit: a.limit ?? null,
          iso_currency_code: "USD",
        },
      }) as unknown as AccountBase,
  );
}

// What each investment account holds; the cash row's dollars are given, the rest are
// quantities at the demo prices.
export function personPositions(demo: DemoSeed) {
  return defOf(demo).positions.map((p) => ({ ...p, account: accountId(demo.seed, p.account) }));
}

export function personLiabilities(demo: DemoSeed, today: string): LiabilitiesObject {
  const def = defOf(demo);
  const { seed, anchor } = demo;
  return {
    credit: def.cards.map((c) => ({
      account_id: accountId(seed, c.account),
      aprs: [
        {
          apr_percentage: c.apr,
          apr_type: "purchase_apr",
          balance_subject_to_apr: c.balance,
          interest_charge_amount: Math.round(((c.balance * c.apr) / 1200) * 100) / 100,
        },
      ],
      is_overdue: c.overdue ?? false,
      last_payment_amount: c.minimum,
      last_payment_date: null,
      last_statement_issue_date: lastDayOfMonthOn(today, 1),
      last_statement_balance: c.balance,
      minimum_payment_amount: c.minimum,
      next_payment_due_date: nextDayOfMonth(today, 26),
    })),
    mortgage: def.mortgage
      ? [
          {
            account_id: accountId(seed, def.mortgage.account),
            account_number: null,
            current_late_fee: null,
            escrow_balance: def.mortgage.escrow,
            has_pmi: def.mortgage.pmi,
            has_prepayment_penalty: false,
            interest_rate: { percentage: def.mortgage.rate, type: "fixed" },
            last_payment_amount: def.mortgage.payment,
            last_payment_date: null,
            loan_term: "30 year",
            loan_type_description: "Conventional 30 year fixed",
            maturity_date: yearsAfter(anchor, def.mortgage.yearsLeft),
            next_monthly_payment: def.mortgage.payment,
            next_payment_due_date: nextDayOfMonth(today, 1),
            origination_date: null,
            origination_principal_amount: def.mortgage.original,
            past_due_amount: 0,
            property_address: null,
            ytd_interest_paid: null,
            ytd_principal_paid: null,
          },
        ]
      : [],
    student: def.student
      ? [
          {
            account_id: accountId(seed, def.student.account),
            account_number: null,
            disbursement_dates: null,
            expected_payoff_date: yearsAfter(anchor, def.student.yearsLeft),
            guarantor: null,
            interest_rate_percentage: def.student.rate,
            is_overdue: false,
            last_payment_amount: def.student.minimum,
            last_payment_date: null,
            last_statement_issue_date: null,
            loan_name: "Federal loan",
            loan_status: { end_date: null, type: "repayment" },
            minimum_payment_amount: def.student.minimum,
            next_payment_due_date: nextDayOfMonth(today, 20),
            origination_date: null,
            origination_principal_amount: def.student.original,
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
            ytd_interest_paid: null,
            ytd_principal_paid: null,
          },
        ]
      : [],
    loan: def.auto
      ? [
          {
            account_id: accountId(seed, def.auto.account),
            account_number: null,
            interest_rate: { percentage: def.auto.rate, type: "fixed" },
            principal_balance: def.auto.principal,
            origination_principal_amount: def.auto.original,
            origination_date: null,
            loan_term_months: def.auto.yearsLeft * 12,
            maturity_date: yearsAfter(anchor, def.auto.yearsLeft),
            payment_count: null,
            payment_frequency: null,
            next_payment_amount: def.auto.payment,
            next_payment_due_date: nextDayOfMonth(today, 8),
            last_payment_amount: def.auto.payment,
            last_payment_date: null,
            payoff_amount: null,
            ytd_interest_paid: null,
            compounding_period: null,
          },
        ]
      : [],
  } as unknown as LiabilitiesObject;
}
