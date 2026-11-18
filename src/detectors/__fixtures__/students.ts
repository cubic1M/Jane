import type { ProfileInput, ProfileTx } from "@/profile/build";

// Two made-up Stanford students, for the money detectors' tests and the before-and-after count of
// what a thin-data student is offered (suggest-money lane, 11-18). Sample data only: no real
// person, account or merchant number.
//
// - `undergrad`: one checking account, five weeks of data, a campus job paid on the 7th and 22nd,
//   money from a parent, no card and no loan, full-price subscriptions, a phone bill, one overdraft.
// - `grad`: two months of checking, savings and one card; a research assistant's pay, off-campus
//   rent, card interest against idle savings, a health plan premium beside the student bill, two
//   music services, a phone and an internet bill.

const STUDENT_TODAY = "2026-11-18";

type Row = [date: string, cents: number, description: string, pfc: string];

const rows = (accountId: string, list: readonly Row[]): ProfileTx[] =>
  list.map(([date, amountCents, description, pfc]) => ({
    date,
    amountCents,
    description,
    pfc,
    accountId,
  }));

const UG = "ug-checking";

const undergradRows: Row[] = [
  ["2026-10-12", 6_420, "STANFORD BOOKSTORE", "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
  ["2026-10-13", 1_250, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"],
  ["2026-10-14", 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-10-15", -40_000, "ZELLE FROM PARENT", "TRANSFER_IN_ACCOUNT_TRANSFER"],
  ["2026-10-16", 1_799, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES"],
  ["2026-10-17", 1_499, "AMAZON PRIME*MEMBERSHIP", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
  ["2026-10-18", 7_500, "T-MOBILE", "RENT_AND_UTILITIES_TELEPHONE"],
  ["2026-10-19", 2_860, "DOORDASH*CHIPOTLE", "FOOD_AND_DRINK_FAST_FOOD"],
  ["2026-10-21", 3_412, "TRADER JOE'S", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-10-22", -41_250, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-10-24", 1_840, "UBER *TRIP", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"],
  ["2026-10-27", 2_290, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"],
  ["2026-10-31", 1_200, "MONTHLY MAINTENANCE FEE", "BANK_FEES_OTHER_BANK_FEES"],
  ["2026-11-01", 4_600, "DOORDASH*THAI HOUSE", "FOOD_AND_DRINK_RESTAURANT"],
  ["2026-11-02", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"],
  ["2026-11-03", 2_310, "STANFORD BOOKSTORE", "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS"],
  ["2026-11-07", -41_250, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-11-09", 2_975, "TRADER JOE'S", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-11-12", 1_640, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"],
  ["2026-11-14", 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-11-15", -40_000, "ZELLE FROM PARENT", "TRANSFER_IN_ACCOUNT_TRANSFER"],
  ["2026-11-16", 1_799, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES"],
  ["2026-11-17", 1_499, "AMAZON PRIME*MEMBERSHIP", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
];

export const undergrad = (): ProfileInput => ({
  today: STUDENT_TODAY,
  told: {},
  transactions: rows(UG, undergradRows),
  accounts: [
    { id: UG, name: "Checking", type: "depository", subtype: "checking", balanceCents: 84_200 },
  ],
  liabilities: [],
  state: "CA",
  householdSize: 1,
});

const GC = "grad-checking";
const GS = "grad-savings";
const CARD = "grad-card";

const gradChecking: Row[] = [
  ["2026-09-01", 210_000, "ESSEX PORTOLA APTS RENT", "RENT_AND_UTILITIES_RENT"],
  ["2026-09-07", -165_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-09-10", 8_500, "COMCAST XFINITY", "RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
  ["2026-09-12", 9_000, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE"],
  ["2026-09-14", 41_000, "BLUE SHIELD OF CA PREMIUM", "GENERAL_SERVICES_INSURANCE"],
  ["2026-09-20", 10_000, "CHASE CREDIT CRD AUTOPAY", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
  ["2026-09-22", -165_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-10-01", 210_000, "ESSEX PORTOLA APTS RENT", "RENT_AND_UTILITIES_RENT"],
  ["2026-10-07", -165_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-10-10", 8_500, "COMCAST XFINITY", "RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
  ["2026-10-12", 9_000, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE"],
  ["2026-10-14", 41_000, "BLUE SHIELD OF CA PREMIUM", "GENERAL_SERVICES_INSURANCE"],
  ["2026-10-20", 10_000, "CHASE CREDIT CRD AUTOPAY", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
  ["2026-10-22", -165_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-11-01", 210_000, "ESSEX PORTOLA APTS RENT", "RENT_AND_UTILITIES_RENT"],
  ["2026-11-07", -165_000, "STANFORD UNIVERSITY PAYROLL", "INCOME_WAGES"],
  ["2026-11-10", 8_500, "COMCAST XFINITY", "RENT_AND_UTILITIES_INTERNET_AND_CABLE"],
  ["2026-11-12", 9_000, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE"],
  ["2026-11-14", 41_000, "BLUE SHIELD OF CA PREMIUM", "GENERAL_SERVICES_INSURANCE"],
];

const gradCard: Row[] = [
  ["2026-09-16", 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-09-18", 1_099, "APPLE.COM/BILL APPLE MUSIC", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-09-19", 8_420, "SAFEWAY", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-09-25", 4_812, "INTEREST CHARGE ON PURCHASES", "BANK_FEES_INTEREST_CHARGE"],
  ["2026-09-27", 6_350, "TRADER JOE'S", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-10-16", 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-10-18", 1_099, "APPLE.COM/BILL APPLE MUSIC", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-10-19", 9_140, "SAFEWAY", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-10-25", 4_968, "INTEREST CHARGE ON PURCHASES", "BANK_FEES_INTEREST_CHARGE"],
  ["2026-10-29", 5_230, "TRADER JOE'S", "FOOD_AND_DRINK_GROCERIES"],
  ["2026-11-16", 1_199, "SPOTIFY USA", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
  ["2026-11-17", 1_099, "APPLE.COM/BILL APPLE MUSIC", "ENTERTAINMENT_MUSIC_AND_AUDIO"],
];

export const grad = (): ProfileInput => ({
  today: STUDENT_TODAY,
  told: {},
  transactions: [...rows(GC, gradChecking), ...rows(CARD, gradCard)],
  accounts: [
    { id: GC, name: "Checking", type: "depository", subtype: "checking", balanceCents: 318_000 },
    { id: GS, name: "Savings", type: "depository", subtype: "savings", balanceCents: 740_000 },
    {
      id: CARD,
      name: "Credit card",
      type: "credit",
      subtype: "credit card",
      balanceCents: 235_000,
      limitCents: 300_000,
    },
  ],
  liabilities: [{ accountId: CARD, kind: "credit", aprBps: 2_799, hasPmi: null, payoffDate: null }],
  state: "CA",
  householdSize: 1,
});

export const STUDENTS = { undergrad, grad } as const;
