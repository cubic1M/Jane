import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import type { AccountKind } from "@/data-sources/types";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, daysBetween } from "@/detection/units";

// The CSV accuracy bench's people (2026-10-27): 20 synthetic people, each with 3 to 6 months of
// true transactions on 2 or 3 accounts and the truth for everything Jane should say about them.
// ./render.ts writes each account as its bank exports it (./layouts.ts), mess and all; ./score.ts
// runs the upload path on those files and scores it against this truth. Nothing here is a real
// person or a real account. A fixed seed makes the same people every time.

// The ways a bank words money sent to a brokerage or an investing app (read-only beta).
const INVESTING_TRANSFERS: readonly { descriptor: string }[] = [
  { descriptor: "ROBINHOOD DEBITS XXXXXX3412" },
  { descriptor: "FID BKG SVC LLC MONEYLINE" },
  { descriptor: "VANGUARD BUY INVESTMENT" },
  { descriptor: "SCHWAB BROKERAGE MONEYLINK" },
  { descriptor: "COINBASE" },
  { descriptor: "E*TRADE ACH DEPOSIT" },
  { descriptor: "TD AMERITRADE CLEARING" },
  { descriptor: "ACORNS INVEST 8123" },
];

export const CSV_SEED = 20_261_027;
export const CSV_AS_OF = "2026-10-24";
export const CSV_PEOPLE_COUNT = 20;
export const CSV_HELD_OUT_SEED = 61_803_398;
export type CsvSet = "tuning" | "tuning-2" | "held-out" | "held-out-2" | "held-out-3";
export const CSV_HELD_OUT_2_SEED = 14_142_135;
export const CSV_HELD_OUT_3_SEED = 27_182_818;
export const CSV_TUNING_2_SEED = 16_180_339;

export type Layout =
  | "chase_checking"
  | "chase_credit_card"
  | "bofa_checking"
  | "bofa_credit_card"
  | "wells_fargo"
  | "capital_one_360"
  | "capital_one_credit_card"
  | "citi_credit_card"
  | "amex"
  | "discover_credit_card"
  // A credit union's export in no layout Jane knows: semicolons, day-first dates, through the
  // column picker with Jane's own guesses accepted.
  | "custom";

export type CsvAccount = {
  id: string;
  layout: Layout;
  kind: AccountKind;
  name: string;
  mask: string;
  // Balance the day before the history starts (a card's is what's owed, positive).
  openingCents: number;
  // Whether the person types today's balance on /import (it's optional there).
  typesBalance: boolean;
};

// How a row counts in the spending chart: spending, income, money moved between the person's own
// accounts or to other people, or either (rent paid by Zelle: a transfer to Plaid, rent to the
// person), which is left out of the totals.
export type Kind = "spending" | "income" | "moving" | "either";

export type TrueRow = {
  id: string;
  account: string;
  // The day it posted, as the export dates it.
  date: string;
  // Plaid's sign: positive is money out of the account.
  amountCents: number;
  // The merchant as the card network passes it; ./layouts.ts dresses it as each bank does.
  descriptor: string;
  // What it is, as a person would say: the category Jane should give it.
  category: PfcDetailed;
  // Other primaries that are also right (a Zelle rent payment is rent, or a transfer).
  alsoOk?: PfcPrimary[];
  kind: Kind;
  // What it is for the bank's own columns.
  flow: Flow;
  // Rows in a pending state in an earlier export (Citi's Status column): that export carries
  // a pending copy, dated and priced as authorised, that later posted as this row.
  pendingCopy?: { date: string; amountCents: number };
};

export type Flow =
  | "purchase"
  | "refund"
  | "payroll"
  | "deposit"
  | "ach_out"
  | "card_payment_out"
  | "card_payment_in"
  | "transfer_out"
  | "transfer_in"
  | "zelle_out"
  | "zelle_in"
  | "venmo_out"
  | "venmo_in"
  | "atm"
  | "fee"
  | "fee_refund"
  | "interest_charge"
  | "interest_earned"
  | "reward"
  | "check";

// A finding Jane should make, by what it's about: the rows that show it.
export type TrueFinding = {
  type:
    | "subscription_review"
    | "price_increase"
    | "bank_fees"
    | "card_interest"
    | "duplicate_charge"
    | "idle_cash"
    | "trial_conversion";
  // A merchant's rows, an account, the second of a double charge, or the person.
  rows?: string[];
  account?: string;
  // What it's worth a year, as Jane counts it (docs/accuracy.md).
  annualCents: number | null;
  note: string;
};

export type CsvPerson = {
  id: string;
  archetype: Archetype;
  asOf: string;
  months: number;
  start: string;
  accounts: CsvAccount[];
  rows: TrueRow[];
  truth: {
    findings: TrueFinding[];
    // Things that look like a finding and aren't, by row: a group's tickets, a pending copy,
    // a refunded double charge, a coffee at the same price every day.
    traps: { type: TrueFinding["type"]; rows: string[]; note: string }[];
    // Recurring charges Jane may or may not call subscriptions without being wrong either way
    // (a trial with one full charge so far).
    neutral: string[][];
    // What's coming up in the next 31 days ("Coming up" and the cash forecast), by the rows of
    // each bill so far; and bills Jane may list or not (a trial's first full charge).
    bills: { rows: string[]; note: string }[];
    neutralBills: string[][];
  };
};

export type Archetype = "salaried" | "hourly" | "gig" | "retiree" | "struggling" | "saver";

// --- Randomness -------------------------------------------------------------------------------

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    cents: (lo: number, hi: number) => Math.round((lo + next() * (hi - lo)) * 100),
  };
}
export type Rng = ReturnType<typeof rng>;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  isoOf(new Date(toDate(date).getTime() + n * DAY));
export function addMonths(date: string, n: number, day?: number): string {
  const d = toDate(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day ?? d.getUTCDate(), last));
  return isoOf(target);
}
export const weekday = (date: string) => toDate(date).getUTCDay();

// --- Merchants --------------------------------------------------------------------------------

type Merchant = { descriptor: string; category: PfcDetailed; lo: number; hi: number };

const GROCERS: Merchant[] = [
  { descriptor: "TRADER JOE S #552", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 110 },
  { descriptor: "SAFEWAY #1784", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
  { descriptor: "WHOLEFDS MKT 10234", category: "FOOD_AND_DRINK_GROCERIES", lo: 30, hi: 160 },
  { descriptor: "KROGER #0451", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 130 },
  { descriptor: "PUBLIX #1123", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 120 },
  { descriptor: "H-E-B #602", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 150 },
];
const RESTAURANTS: Merchant[] = [
  { descriptor: "SQ *TAQUERIA EL FAROLITO", category: "FOOD_AND_DRINK_RESTAURANT", lo: 12, hi: 40 },
  { descriptor: "TST* THE COUNTER CAFE", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 75 },
  { descriptor: "CHIPOTLE 2291", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 10, hi: 25 },
  { descriptor: "MCDONALD'S F3378", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 6, hi: 18 },
  { descriptor: "DOORDASH*SWEETGREEN", category: "FOOD_AND_DRINK_RESTAURANT", lo: 15, hi: 45 },
  { descriptor: "UBER   *EATS", category: "FOOD_AND_DRINK_RESTAURANT", lo: 15, hi: 50 },
  { descriptor: "OLIVE GARDEN 0041", category: "FOOD_AND_DRINK_RESTAURANT", lo: 30, hi: 90 },
];
const COFFEE: Merchant[] = [
  { descriptor: "STARBUCKS STORE 05423", category: "FOOD_AND_DRINK_COFFEE", lo: 5.45, hi: 5.45 },
  { descriptor: "SQ *BLUE BOTTLE COFFEE", category: "FOOD_AND_DRINK_COFFEE", lo: 6.5, hi: 6.5 },
  { descriptor: "DUNKIN 348812", category: "FOOD_AND_DRINK_COFFEE", lo: 3.89, hi: 3.89 },
];
const SHOPS: Merchant[] = [
  {
    descriptor: "AMAZON.COM*RT4KL2MN0",
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    lo: 12,
    hi: 120,
  },
  {
    descriptor: "AMZN Mktp US*2K4L91Z3",
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    lo: 9,
    hi: 80,
  },
  { descriptor: "TARGET 00023456", category: "GENERAL_MERCHANDISE_SUPERSTORES", lo: 15, hi: 140 },
  { descriptor: "WAL-MART #2281", category: "GENERAL_MERCHANDISE_SUPERSTORES", lo: 15, hi: 120 },
  { descriptor: "BEST BUY 00012345", category: "GENERAL_MERCHANDISE_ELECTRONICS", lo: 30, hi: 260 },
  {
    descriptor: "CVS/PHARMACY #04321",
    category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
    lo: 8,
    hi: 55,
  },
  { descriptor: "HOME DEPOT #6612", category: "HOME_IMPROVEMENT_HARDWARE", lo: 15, hi: 220 },
  {
    descriptor: "TJ MAXX #0811",
    category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    lo: 20,
    hi: 90,
  },
];
const GAS: Merchant[] = [
  { descriptor: "SHELL OIL 57444212", category: "TRANSPORTATION_GAS", lo: 30, hi: 65 },
  { descriptor: "CHEVRON 0204417", category: "TRANSPORTATION_GAS", lo: 30, hi: 70 },
  { descriptor: "EXXONMOBIL 4471", category: "TRANSPORTATION_GAS", lo: 28, hi: 60 },
];
const RIDES: Merchant[] = [
  { descriptor: "UBER   *TRIP", category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", lo: 9, hi: 38 },
  {
    descriptor: "LYFT   *RIDE THU 8PM",
    category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    lo: 8,
    hi: 30,
  },
];

type Sub = {
  descriptor: string;
  // Other ways the same charge is written from month to month ("NETFLIX.COM 866-579-7172").
  variants?: string[];
  category: PfcDetailed;
  cents: number;
  rise?: number;
  // Software and news have no category of their own: any of these is right.
  alsoOk?: PfcPrimary[];
};
const DIGITAL: PfcPrimary[] = ["GENERAL_SERVICES", "GENERAL_MERCHANDISE", "ENTERTAINMENT"];
const SUBSCRIPTIONS: Sub[] = [
  {
    descriptor: "NETFLIX.COM",
    variants: ["NETFLIX.COM 866-579-7172"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cents: 1549,
    rise: 1799,
  },
  {
    descriptor: "SPOTIFY USA",
    variants: ["SPOTIFY P1A2B3C4D5"],
    category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    cents: 1199,
    rise: 1299,
  },
  {
    descriptor: "HULU 877-8244858",
    variants: ["PAYPAL *HULU"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cents: 1799,
  },
  { descriptor: "DISNEY PLUS", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1399, rise: 1599 },
  { descriptor: "PLANET FITNESS", category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", cents: 2499 },
  {
    descriptor: "ADOBE *CREATIVE CLD",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    cents: 2299,
    alsoOk: DIGITAL,
  },
  {
    descriptor: "APPLE.COM/BILL",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    cents: 299,
    alsoOk: DIGITAL,
  },
  {
    descriptor: "OPENAI *CHATGPT SUBSCR",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    cents: 2000,
    alsoOk: DIGITAL,
  },
  { descriptor: "GOOGLE *YouTubePremium", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1399 },
  { descriptor: "AUDIBLE*2K94LM", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1495 },
  {
    descriptor: "NYTIMES*NYTDIGITAL",
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    cents: 400,
    rise: 625,
    alsoOk: DIGITAL,
  },
  {
    descriptor: "PELOTON* MEMBERSHIP",
    category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    cents: 4400,
  },
  { descriptor: "PARAMOUNT+", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1199 },
  { descriptor: "MAX.COM", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1699 },
  // A name no rule knows, written two ways: the service and its website.
  {
    descriptor: "DIRECTV STREAM",
    variants: ["DIRECTV.COM"],
    category: "ENTERTAINMENT_TV_AND_MOVIES",
    cents: 7999,
  },
];
// Free or $1 trials that turned into the full price.
const TRIALS: Sub[] = [
  { descriptor: "STARZ", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1099 },
  { descriptor: "SIRIUSXM", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1099 },
  { descriptor: "PEACOCK", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
];
// A group's tickets: two or three at one price on one day.
const SEATS: Merchant[] = [
  {
    descriptor: "TICKETMASTER",
    category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    lo: 45,
    hi: 140,
  },
  { descriptor: "AMC 0517 ONLINE", category: "ENTERTAINMENT_TV_AND_MOVIES", lo: 14, hi: 22 },
  { descriptor: "SOUTHWES 5262123456789", category: "TRAVEL_FLIGHTS", lo: 120, hi: 320 },
];

const EMPLOYERS = ["ACME CORP", "NORTHWIND TRADERS", "GLOBEX INC", "HOOLI INC", "STARK INDUSTRIES"];
const LANDLORDS = ["AVALON COMMUNITIES", "GREYSTAR RE PAYMENT", "ESSEX PROPERTY TR"];
const POWER = ["PG&E WEB ONLINE", "CON ED OF NY", "DUKE ENERGY", "COMED", "XCEL ENERGY"];
const INTERNET = ["COMCAST XFINITY", "SPECTRUM", "VERIZON FIOS", "AT&T U-VERSE"];
const PHONES = ["VERIZON WIRELESS", "T-MOBILE", "AT&T MOBILITY"];
const INSURERS = ["GEICO *AUTO", "STATE FARM INSURANCE", "PROGRESSIVE INS"];
const FRIENDS = ["ALEX KIM", "JORDAN LEE", "SAM PATEL", "TAYLOR NGUYEN", "CASEY BROWN"];

type Pool = {
  grocers: Merchant[];
  restaurants: Merchant[];
  coffee: Merchant[];
  shops: Merchant[];
  gas: Merchant[];
  rides: Merchant[];
  subscriptions: Sub[];
  trials: Sub[];
  seats: Merchant[];
  employers: string[];
  landlords: string[];
  power: string[];
  internet: string[];
  phones: string[];
  insurers: string[];
  friends: string[];
  water: string;
  // A plan paid once a year, and places abroad (a trip, with the card's foreign fee).
  yearly: Sub;
  abroad: Merchant[];
  // Bills that come when they come: the dentist, a car repair.
  irregular: Merchant[];
  // One price every month and no name a rule knows, but not a subscription: a loan payment,
  // insurance, a church, a bakery, a bar (QA round 28).
  notPlans: Merchant[];
  // A plan billed twice on the same day every month (two accounts, or one for a family member).
  twin: Sub;
  // Charges that come on a cadence other than monthly (round 16): a meal kit every week, a plan
  // every four weeks (13 a year, not 12), a water bill or insurance every quarter. A plan is a
  // subscription; the rest are bills. Only some pools have them.
  cadences?: (Merchant & { everyDays: number; plan: boolean })[];
  // A plan that moved to another card part-way, one billed on the month's last day, and one
  // service paid twice from two cards on different days (two people's accounts). Round 19.
  moved?: Sub[];
  // A plan switched from monthly to yearly: the monthly charges stop, one yearly charge comes
  // (round 21). The yearly one is the subscription now.
  toYearly?: {
    descriptor: string;
    category: PfcDetailed;
    monthly: number;
    yearly: number;
    alsoOk?: PfcPrimary[];
  }[];
  // A plan paused for a month and picked up again (a gym's freeze, a box skipped): still a
  // subscription (round 18). Only some pools have them.
  paused?: Sub[];
  // Same-price pairs on one day that aren't double charges: a service paid per person (two kids'
  // haircuts, two copays), and two orders from one shop with their own order numbers (round 14).
  // Only some pools have them; the rows come from their own dice.
  perPerson?: Merchant[];
  orders?: { prefix: string; category: PfcDetailed };
  // Two plans from one service at two prices, each on its own day every month (QA round 30).
  pricePlans: {
    descriptor: string;
    category: PfcDetailed;
    cents: [number, number];
    alsoOk?: PfcPrimary[];
  };
};

const TUNING: Pool = {
  grocers: GROCERS,
  restaurants: RESTAURANTS,
  coffee: COFFEE,
  shops: SHOPS,
  gas: GAS,
  rides: RIDES,
  subscriptions: SUBSCRIPTIONS,
  trials: TRIALS,
  seats: SEATS,
  employers: EMPLOYERS,
  landlords: LANDLORDS,
  power: POWER,
  internet: INTERNET,
  phones: PHONES,
  insurers: INSURERS,
  friends: FRIENDS,
  water: "CITY OF SPRINGFIELD UTILITY BILLING",
  yearly: {
    descriptor: "AMAZON PRIME*2K4AB7XY0",
    category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    cents: 13_900,
    alsoOk: DIGITAL,
  },
  twin: { descriptor: "TIDAL.COM", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1099 },
  pricePlans: {
    descriptor: "BLINKIST",
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    cents: [1499, 2499],
    alsoOk: DIGITAL,
  },
  notPlans: [
    {
      descriptor: "HARBOR CREDIT UNION PMT",
      category: "LOAN_PAYMENTS_OTHER_PAYMENT",
      lo: 85,
      hi: 85,
    },
    { descriptor: "LEMONADE INSURANCE", category: "GENERAL_SERVICES_INSURANCE", lo: 18, hi: 18 },
    {
      descriptor: "PARKSIDE COMMUNITY CHURCH",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 50,
      hi: 50,
    },
    {
      descriptor: "BLUE HERON BAKERY",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 14.3,
      hi: 14.3,
    },
    { descriptor: "HOLLOW OAK TAVERN", category: "FOOD_AND_DRINK_RESTAURANT", lo: 46.1, hi: 46.1 },
  ],
  irregular: [
    { descriptor: "SMILE DENTAL GROUP", category: "MEDICAL_DENTAL_CARE", lo: 90, hi: 420 },
    { descriptor: "JIFFY LUBE #1234", category: "GENERAL_SERVICES_AUTOMOTIVE", lo: 60, hi: 380 },
  ],
  abroad: [
    {
      descriptor: "PRET A MANGER LONDON GBR",
      category: "FOOD_AND_DRINK_RESTAURANT",
      lo: 8,
      hi: 18,
    },
    {
      descriptor: "TFL TRAVEL CH LONDON",
      category: "TRANSPORTATION_PUBLIC_TRANSIT",
      lo: 3,
      hi: 12,
    },
    {
      descriptor: "UBER *TRIP LONDON",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 10,
      hi: 35,
    },
  ],
};

// The held-out set (2026-10-27): the same kinds of people and mess, under names the tuning set
// never uses, written before any rule was fixed on it and only ever scored. A rule that knows
// the tuning set's names can't pass it; what it shows is how far the rules reach on their own
// (on a live upload, Claude places what they don't).
const HELD_OUT: Pool = {
  grocers: [
    { descriptor: "SHOPRITE #0412", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 140 },
    { descriptor: "PIGGLY WIGGLY #88", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 110 },
    { descriptor: "RALEYS #112", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 130 },
    { descriptor: "WINN-DIXIE #0203", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 120 },
    { descriptor: "SMART & FINAL 451", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 150 },
  ],
  restaurants: [
    { descriptor: "TST* PHO HOA NOODLE", category: "FOOD_AND_DRINK_RESTAURANT", lo: 14, hi: 45 },
    { descriptor: "SQ *CORNER BISTRO", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 70 },
    { descriptor: "RED LOBSTER 0442", category: "FOOD_AND_DRINK_RESTAURANT", lo: 35, hi: 95 },
    { descriptor: "P.F. CHANG'S #9921", category: "FOOD_AND_DRINK_RESTAURANT", lo: 30, hi: 90 },
    { descriptor: "JERSEY MIKES 31015", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 9, hi: 22 },
    { descriptor: "GRUBHUB*THAIHOUSE", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 50 },
    { descriptor: "PANDA EXPRESS #1712", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 8, hi: 20 },
  ],
  coffee: [
    { descriptor: "PEETS COFFEE 00121", category: "FOOD_AND_DRINK_COFFEE", lo: 4.95, hi: 4.95 },
    { descriptor: "DUTCH BROS #221", category: "FOOD_AND_DRINK_COFFEE", lo: 5.25, hi: 5.25 },
    { descriptor: "TIM HORTONS #8812", category: "FOOD_AND_DRINK_COFFEE", lo: 3.49, hi: 3.49 },
  ],
  shops: [
    {
      descriptor: "EBAY O*12-34567-89012",
      category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      lo: 10,
      hi: 90,
    },
    {
      descriptor: "COSTCO WHSE #0123",
      category: "GENERAL_MERCHANDISE_SUPERSTORES",
      lo: 40,
      hi: 250,
    },
    { descriptor: "IKEA US 0123", category: "HOME_IMPROVEMENT_FURNITURE", lo: 30, hi: 300 },
    {
      descriptor: "WALGREENS #1234",
      category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
      lo: 8,
      hi: 50,
    },
    { descriptor: "LOWE'S #1188", category: "HOME_IMPROVEMENT_HARDWARE", lo: 15, hi: 220 },
    {
      descriptor: "OLD NAVY ON-LINE",
      category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
      lo: 20,
      hi: 90,
    },
    { descriptor: "ULTA BEAUTY #331", category: "PERSONAL_CARE_HAIR_AND_BEAUTY", lo: 15, hi: 80 },
    { descriptor: "PETCO 1234", category: "GENERAL_MERCHANDISE_PET_SUPPLIES", lo: 15, hi: 90 },
  ],
  gas: [
    { descriptor: "SUNOCO 0363774600", category: "TRANSPORTATION_GAS", lo: 30, hi: 65 },
    { descriptor: "76 - FUEL 0211", category: "TRANSPORTATION_GAS", lo: 30, hi: 70 },
    { descriptor: "MARATHON PETRO44", category: "TRANSPORTATION_GAS", lo: 28, hi: 60 },
  ],
  rides: [
    {
      descriptor: "CURB SVC NYC TAXI",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 12,
      hi: 40,
    },
    {
      descriptor: "UBER *TRIP HELP.UBER.COM",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 9,
      hi: 35,
    },
  ],
  subscriptions: [
    { descriptor: "NETFLIX.COM", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1549, rise: 1799 },
    {
      descriptor: "CRUNCHYROLL*MEMBERSHIP",
      variants: ["CRUNCHYROLL 415-503-9235"],
      category: "ENTERTAINMENT_TV_AND_MOVIES",
      cents: 799,
      rise: 999,
    },
    { descriptor: "AMAZON MUSIC*AB12C", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1099 },
    { descriptor: "MICROSOFT*XBOX", category: "ENTERTAINMENT_VIDEO_GAMES", cents: 1699 },
    {
      descriptor: "HEADSPACE",
      category: "PERSONAL_CARE_OTHER_PERSONAL_CARE",
      cents: 1299,
      alsoOk: [...DIGITAL, "PERSONAL_CARE"],
    },
    {
      descriptor: "STRAVA",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      cents: 1199,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "GRAMMARLY",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1200,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "CANVA* 04321",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1499,
      alsoOk: DIGITAL,
    },
    { descriptor: "ESPN PLUS", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1099, rise: 1199 },
    {
      descriptor: "SLING TV",
      variants: ["SLING.COM"],
      category: "ENTERTAINMENT_TV_AND_MOVIES",
      cents: 4000,
      rise: 4500,
    },
    {
      descriptor: "SPOTIFY USA",
      category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
      cents: 1199,
      rise: 1299,
    },
    { descriptor: "LA FITNESS", category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", cents: 3499 },
    {
      descriptor: "CALM.COM",
      category: "PERSONAL_CARE_OTHER_PERSONAL_CARE",
      cents: 1499,
      alsoOk: [...DIGITAL, "PERSONAL_CARE"],
    },
  ],
  trials: [
    { descriptor: "FUBOTV", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 7999 },
    { descriptor: "PHILO", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 2800 },
    { descriptor: "DISCOVERY PLUS", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 899 },
  ],
  seats: [
    { descriptor: "ALAMO DRAFTHOUSE 042", category: "ENTERTAINMENT_TV_AND_MOVIES", lo: 14, hi: 24 },
    {
      descriptor: "VIVID SEATS 866-848-8499",
      category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
      lo: 50,
      hi: 160,
    },
    { descriptor: "UNITED 0162345678901", category: "TRAVEL_FLIGHTS", lo: 150, hi: 380 },
  ],
  employers: [
    "WAYNE ENTERPRISES",
    "INITECH LLC",
    "SOYLENT CORP",
    "CYBERDYNE SYS",
    "MASSIVE DYNAMIC",
  ],
  landlords: ["CORTLAND MGMT LLC", "MAA RENT 0012", "CAMDEN LIVING"],
  power: ["AMEREN MISSOURI", "PEPCO", "SDGE", "AEP OHIO", "EVERSOURCE"],
  internet: ["COX COMMUNICATIONS", "OPTIMUM", "GOOGLE FIBER", "FRONTIER COMM"],
  phones: ["MINT MOBILE", "CRICKET WIRELESS", "VISIBLE"],
  insurers: ["ALLSTATE INS CO", "LIBERTY MUTUAL", "USAA P&C"],
  friends: ["RILEY ADAMS", "QUINN FOSTER", "AVERY CHEN", "DREW MARTIN", "SKYLER WOODS"],
  water: "RIVERSIDE PUBLIC WORKS",
  yearly: {
    descriptor: "COSTCO *ANNUAL RENEWAL",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    cents: 6_500,
    alsoOk: DIGITAL,
  },
  twin: { descriptor: "DEEZER", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1199 },
  pricePlans: {
    descriptor: "MEDIUM.COM",
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    cents: [500, 1500],
    alsoOk: DIGITAL,
  },
  notPlans: [
    { descriptor: "CANYON CU LOAN PMT", category: "LOAN_PAYMENTS_OTHER_PAYMENT", lo: 95, hi: 95 },
    { descriptor: "ROOT INSURANCE CO", category: "GENERAL_SERVICES_INSURANCE", lo: 42, hi: 42 },
    {
      descriptor: "GRACE MINISTRIES TITHE",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 75,
      hi: 75,
    },
    {
      descriptor: "SUNRISE BAKERY",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 12.5,
      hi: 12.5,
    },
    { descriptor: "KINGS HEAD PUB", category: "FOOD_AND_DRINK_RESTAURANT", lo: 38, hi: 38 },
  ],
  irregular: [
    { descriptor: "BRIGHT NOW DENTAL", category: "MEDICAL_DENTAL_CARE", lo: 90, hi: 420 },
    { descriptor: "MIDAS #221", category: "GENERAL_SERVICES_AUTOMOTIVE", lo: 60, hi: 380 },
  ],
  abroad: [
    {
      descriptor: "CAFE DE FLORE PARIS FRA",
      category: "FOOD_AND_DRINK_RESTAURANT",
      lo: 12,
      hi: 40,
    },
    { descriptor: "SNCF INTERNET PARIS", category: "TRAVEL_OTHER_TRAVEL", lo: 25, hi: 90 },
    { descriptor: "MONOPRIX PARIS 11", category: "FOOD_AND_DRINK_GROCERIES", lo: 10, hi: 45 },
  ],
};

// --- The people -------------------------------------------------------------------------------

// Who banks where. Every layout appears at least twice; the custom file twice.
const PLANS: { checking: Layout; cards: Layout[]; savings?: Layout }[] = [
  { checking: "chase_checking", cards: ["chase_credit_card"] },
  { checking: "bofa_checking", cards: ["bofa_credit_card"] },
  { checking: "wells_fargo", cards: ["discover_credit_card"] },
  { checking: "capital_one_360", cards: ["capital_one_credit_card"], savings: "capital_one_360" },
  { checking: "chase_checking", cards: ["amex"] },
  { checking: "bofa_checking", cards: ["citi_credit_card"] },
  { checking: "wells_fargo", cards: ["chase_credit_card", "amex"] },
  { checking: "capital_one_360", cards: ["citi_credit_card", "discover_credit_card"] },
  { checking: "chase_checking", cards: ["capital_one_credit_card"], savings: "chase_checking" },
  { checking: "bofa_checking", cards: ["amex", "discover_credit_card"] },
  { checking: "custom", cards: ["citi_credit_card"] },
  { checking: "wells_fargo", cards: ["bofa_credit_card"] },
  { checking: "chase_checking", cards: ["discover_credit_card"], savings: "capital_one_360" },
  { checking: "capital_one_360", cards: ["amex"] },
  { checking: "bofa_checking", cards: ["chase_credit_card"], savings: "bofa_checking" },
  { checking: "chase_checking", cards: ["citi_credit_card", "capital_one_credit_card"] },
  { checking: "wells_fargo", cards: ["amex"] },
  { checking: "capital_one_360", cards: ["bofa_credit_card"] },
  { checking: "custom", cards: ["discover_credit_card"] },
  { checking: "chase_checking", cards: ["bofa_credit_card", "citi_credit_card"] },
];
const ARCHETYPES: Archetype[] = ["salaried", "hourly", "gig", "retiree", "struggling", "saver"];

const BANK_NAMES: Record<Layout, string> = {
  chase_checking: "Chase",
  chase_credit_card: "Chase",
  bofa_checking: "Bank of America",
  bofa_credit_card: "Bank of America",
  wells_fargo: "Wells Fargo",
  capital_one_360: "Capital One",
  capital_one_credit_card: "Capital One",
  citi_credit_card: "Citi",
  amex: "American Express",
  discover_credit_card: "Discover",
  custom: "Credit union",
};
export const ISSUER: Record<Layout, string> = BANK_NAMES;

class Ledger {
  rows: TrueRow[] = [];
  findings: TrueFinding[] = [];
  traps: CsvPerson["truth"]["traps"] = [];
  neutral: string[][] = [];
  bills: { rows: string[]; note: string }[] = [];
  neutralBills: string[][] = [];
  // A recurring series is a bill once it has two charges.
  bill(rows: string[], note: string) {
    if (rows.length >= 2) this.bills.push({ rows, note });
  }
  private n = 0;
  constructor(
    readonly id: string,
    readonly start: string,
    readonly asOf: string,
  ) {}
  add(row: Omit<TrueRow, "id">): TrueRow | null {
    if (row.date < this.start || row.date > this.asOf) return null;
    const full = { ...row, id: `${this.id}-r${(this.n += 1)}` };
    this.rows.push(full);
    return full;
  }
  monthly(day: number, make: (date: string, i: number) => void) {
    let date = addMonths(this.start, 0, day);
    if (date < this.start) date = addMonths(this.start, 1, day);
    for (let i = 0; date <= this.asOf; i += 1, date = addMonths(date, 1, day)) make(date, i);
  }
  every(days: number, first: string, make: (date: string, i: number) => void) {
    for (let i = 0, date = first; date <= this.asOf; i += 1, date = addDays(date, days)) {
      if (date >= this.start) make(date, i);
    }
  }
  days(make: (date: string, weekday: number) => void) {
    for (let date = this.start; date <= this.asOf; date = addDays(date, 1))
      make(date, weekday(date));
  }
}

const spend = (
  account: string,
  date: string,
  cents: number,
  m: Pick<Merchant, "descriptor" | "category"> & { alsoOk?: PfcPrimary[] },
) => ({
  account,
  date,
  amountCents: cents,
  descriptor: m.descriptor,
  category: m.category,
  ...(m.alsoOk ? { alsoOk: m.alsoOk } : {}),
  kind: "spending" as const,
  flow: "purchase" as const,
});

// The second held-out set (2026-10-27, made and scored before any fix it could check): the same
// kinds of people and mess under names neither other set uses.
const HELD_OUT_2: Pool = {
  grocers: [
    { descriptor: "FOOD 4 LESS #0332", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 130 },
    { descriptor: "LUCKY STORES 712", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 120 },
    { descriptor: "SAVE A LOT 18822", category: "FOOD_AND_DRINK_GROCERIES", lo: 15, hi: 90 },
    { descriptor: "INGLES MARKETS #41", category: "FOOD_AND_DRINK_GROCERIES", lo: 25, hi: 140 },
  ],
  restaurants: [
    { descriptor: "TST* SALT & SMOKE", category: "FOOD_AND_DRINK_RESTAURANT", lo: 20, hi: 70 },
    { descriptor: "SQ *MAMAS KITCHEN", category: "FOOD_AND_DRINK_RESTAURANT", lo: 14, hi: 45 },
    { descriptor: "CRACKER BARREL #221", category: "FOOD_AND_DRINK_RESTAURANT", lo: 25, hi: 70 },
    { descriptor: "QDOBA 2204", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 9, hi: 20 },
    { descriptor: "SEAMLESS*GOLDEN WOK", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 50 },
    { descriptor: "ZAXBYS #0412", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 8, hi: 18 },
  ],
  coffee: [
    { descriptor: "CARIBOU COFFEE #33", category: "FOOD_AND_DRINK_COFFEE", lo: 4.75, hi: 4.75 },
    { descriptor: "SQ *DIGNITY ROASTERS", category: "FOOD_AND_DRINK_COFFEE", lo: 5.5, hi: 5.5 },
  ],
  shops: [
    {
      descriptor: "ETSY.COM*SHOP 3321",
      category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      lo: 12,
      hi: 80,
    },
    {
      descriptor: "BJS WHOLESALE #0611",
      category: "GENERAL_MERCHANDISE_SUPERSTORES",
      lo: 40,
      hi: 220,
    },
    { descriptor: "WAYFAIR*4K2L9", category: "HOME_IMPROVEMENT_FURNITURE", lo: 40, hi: 320 },
    {
      descriptor: "RITE AID #05532",
      category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
      lo: 8,
      hi: 45,
    },
    { descriptor: "MENARDS 3301", category: "HOME_IMPROVEMENT_HARDWARE", lo: 15, hi: 200 },
    {
      descriptor: "BURLINGTON STORES 712",
      category: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
      lo: 20,
      hi: 90,
    },
    { descriptor: "SEPHORA.COM", category: "PERSONAL_CARE_HAIR_AND_BEAUTY", lo: 20, hi: 90 },
    { descriptor: "CHEWY.COM", category: "GENERAL_MERCHANDISE_PET_SUPPLIES", lo: 20, hi: 100 },
  ],
  gas: [
    { descriptor: "CIRCLE K 2700412", category: "TRANSPORTATION_GAS", lo: 28, hi: 60 },
    { descriptor: "QT 0471 OUTSIDE", category: "TRANSPORTATION_GAS", lo: 30, hi: 65 },
    { descriptor: "WAWA 8812", category: "TRANSPORTATION_GAS", lo: 25, hi: 55 },
  ],
  rides: [
    { descriptor: "ALTO RIDES", category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", lo: 12, hi: 40 },
    {
      descriptor: "LYFT   *RIDE MON 9AM",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 9,
      hi: 30,
    },
  ],
  subscriptions: [
    {
      descriptor: "SPOTIFY USA",
      category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
      cents: 1199,
      rise: 1299,
    },
    {
      descriptor: "APPLE TV+",
      variants: ["APPLE.COM/BILL"],
      category: "ENTERTAINMENT_TV_AND_MOVIES",
      cents: 999,
    },
    { descriptor: "MUBI", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1499, rise: 1599 },
    { descriptor: "BRITBOX", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 899 },
    {
      descriptor: "NOOM INC",
      variants: ["NOOM.COM"],
      category: "PERSONAL_CARE_OTHER_PERSONAL_CARE",
      cents: 5900,
      alsoOk: [...DIGITAL, "PERSONAL_CARE"],
    },
    {
      descriptor: "1PASSWORD",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 299,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "NOTION LABS",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1000,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "MASTERCLASS",
      category: "GENERAL_SERVICES_EDUCATION",
      cents: 1500,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "ORANGETHEORY FITNESS",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      cents: 5900,
    },
    { descriptor: "SIRIUSXM", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1099, rise: 1299 },
    {
      descriptor: "PATREON* MEMBERSHIP",
      category: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
      cents: 800,
      alsoOk: DIGITAL,
    },
  ],
  trials: [
    {
      descriptor: "HELLOFRESH",
      category: "FOOD_AND_DRINK_GROCERIES",
      cents: 6999,
      alsoOk: ["FOOD_AND_DRINK"],
    },
    {
      descriptor: "KINDLE UNLIMITED",
      category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
      cents: 1199,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "BUMBLE",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 2999,
      alsoOk: DIGITAL,
    },
  ],
  seats: [
    { descriptor: "ANGELIKA FILM CENTER", category: "ENTERTAINMENT_TV_AND_MOVIES", lo: 15, hi: 22 },
    {
      descriptor: "GAMETIME*TICKETS",
      category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
      lo: 40,
      hi: 140,
    },
    { descriptor: "FRONTIER AIRLINES 4222345678901", category: "TRAVEL_FLIGHTS", lo: 90, hi: 260 },
  ],
  employers: ["TYRELL CORP", "OSCORP HOLDINGS", "VANDELAY IND", "PIED PIPER INC", "DUNDER MIFFLIN"],
  landlords: ["LINCOLN APARTMENTS", "BRIDGE PROPERTY GRP", "WILLOW CREEK HOMES"],
  power: ["ENTERGY TEXAS", "TECO ENERGY", "NV ENERGY", "PSEG LONG ISLAND", "OG&E"],
  internet: ["WOW INTERNET", "ASTOUND BROADBAND", "METRONET", "RCN"],
  phones: ["US CELLULAR", "GOOGLE FI", "BOOST MOBILE"],
  insurers: ["ERIE INSURANCE", "TRAVELERS INS", "AMICA MUTUAL"],
  friends: ["JAMIE ORTIZ", "MORGAN BELL", "ROWAN PRICE", "EMERY SHAW", "HAYDEN COLE"],
  water: "METRO WATER SERVICES",
  yearly: {
    descriptor: "SAMS CLUB MEMBERSHIP",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    cents: 5000,
    alsoOk: DIGITAL,
  },
  twin: { descriptor: "PANDORA", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1099 },
  pricePlans: {
    descriptor: "SCRIBD",
    category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
    cents: [1199, 1699],
    alsoOk: DIGITAL,
  },
  notPlans: [
    {
      descriptor: "SUMMIT FCU LOAN PMT",
      category: "LOAN_PAYMENTS_OTHER_PAYMENT",
      lo: 120,
      hi: 120,
    },
    { descriptor: "HIPPO INSURANCE", category: "GENERAL_SERVICES_INSURANCE", lo: 31, hi: 31 },
    {
      descriptor: "FIRST BAPTIST CHURCH",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 40,
      hi: 40,
    },
    {
      descriptor: "SWEET CRUMB BAKERY",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 11.75,
      hi: 11.75,
    },
    { descriptor: "RUSTY NAIL PUB", category: "FOOD_AND_DRINK_RESTAURANT", lo: 42, hi: 42 },
  ],
  irregular: [
    { descriptor: "ASPEN DENTAL", category: "MEDICAL_DENTAL_CARE", lo: 90, hi: 420 },
    {
      descriptor: "FIRESTONE COMPLETE AUTO",
      category: "GENERAL_SERVICES_AUTOMOTIVE",
      lo: 60,
      hi: 380,
    },
  ],
  abroad: [
    { descriptor: "TIM HORTONS TORONTO CAN", category: "FOOD_AND_DRINK_COFFEE", lo: 3, hi: 9 },
    { descriptor: "TTC PRESTO TORONTO", category: "TRANSPORTATION_PUBLIC_TRANSIT", lo: 3, hi: 12 },
    { descriptor: "LOBLAWS TORONTO", category: "FOOD_AND_DRINK_GROCERIES", lo: 15, hi: 60 },
  ],
};

// A second tuning set (2026-10-27, round 13): the first one's shops and bills, with the
// subscriptions people miss on real statements. A membership at a company that sells something
// else (Uber One, DashPass, Walmart+, Instacart+), software over $100 a month, a yearly renewal at
// a warehouse club, plans billed through a processor ("PAYPAL *", "SQ *"). Rules may be fixed on
// it, like the first.
const MEMBERSHIP_OK: PfcPrimary[] = [...DIGITAL, "TRANSPORTATION", "FOOD_AND_DRINK"];
const TUNING_2: Pool = {
  ...TUNING,
  subscriptions: [
    {
      descriptor: "UBER *ONE MEMBERSHIP",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 999,
      alsoOk: MEMBERSHIP_OK,
    },
    {
      descriptor: "DOORDASH DASHPASS",
      variants: ["DD *DOORDASH DASHPASS"],
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 999,
      alsoOk: MEMBERSHIP_OK,
    },
    {
      descriptor: "LYFT *PINK MEMBERSHIP",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 999,
      alsoOk: MEMBERSHIP_OK,
    },
    {
      descriptor: "INSTACART+ MEMBERSHIP",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 999,
      alsoOk: MEMBERSHIP_OK,
    },
    {
      descriptor: "WALMART+ 800-925-6278",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1295,
      alsoOk: MEMBERSHIP_OK,
    },
    {
      descriptor: "AUTODESK INC",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 24_500,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "INTUIT *QBOOKS ONLINE",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 3500,
      rise: 3800,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "PAYPAL *SIRIUS XM",
      variants: ["SIRIUS XM RADIO"],
      category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
      cents: 1099,
    },
    {
      descriptor: "SQ *IRON TEMPLE GYM",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      cents: 6500,
    },
    {
      descriptor: "KINDLE SVCS*KINDLE UNLTD",
      category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
      cents: 1199,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "MICROSOFT*XBOX GAME PASS",
      category: "ENTERTAINMENT_VIDEO_GAMES",
      cents: 1699,
      rise: 1999,
    },
    {
      descriptor: "SHOPIFY* 21389442",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 3900,
      alsoOk: DIGITAL,
    },
  ],
  trials: [
    {
      descriptor: "BABBEL.COM",
      category: "GENERAL_SERVICES_EDUCATION",
      cents: 1395,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "HEADSPACE",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1299,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "MASTERCLASS",
      category: "GENERAL_SERVICES_EDUCATION",
      cents: 1500,
      alsoOk: DIGITAL,
    },
  ],
  yearly: {
    descriptor: "COSTCO *ANNUAL RENEWAL",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    cents: 6500,
    alsoOk: DIGITAL,
  },
  twin: {
    descriptor: "NINTENDO *SWITCH ONLINE",
    category: "ENTERTAINMENT_VIDEO_GAMES",
    cents: 399,
  },
  toYearly: [
    {
      descriptor: "AMAZON PRIME*4K2LM90",
      category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      monthly: 1499,
      yearly: 13_900,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "DROPBOX*PLUS",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      monthly: 1199,
      yearly: 11_988,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "QZ NOTES PRO",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      monthly: 899,
      yearly: 7999,
      alsoOk: DIGITAL,
    },
  ],
  moved: [
    { descriptor: "SPOTIFY USA", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1199 },
    { descriptor: "NETFLIX.COM", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1549 },
    {
      descriptor: "QZ CLOUD BACKUP",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 999,
      alsoOk: DIGITAL,
    },
  ],
  paused: [
    {
      descriptor: "SQ *CORE YOGA STUDIO",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      cents: 9900,
    },
    { descriptor: "PAYPAL *CRUNCHYROLL", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
    {
      descriptor: "QZ STUDIO PASS",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 2500,
      alsoOk: DIGITAL,
    },
  ],
  cadences: [
    {
      descriptor: "HELLOFRESH 646-846-3663",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 74.99,
      hi: 74.99,
      everyDays: 7,
      plan: true,
    },
    {
      descriptor: "FACTOR75 MEALS",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 89.99,
      hi: 89.99,
      everyDays: 7,
      plan: true,
    },
    {
      descriptor: "SQ *ORANGETHEORY 4WK",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      lo: 59,
      hi: 59,
      everyDays: 28,
      plan: true,
    },
    {
      descriptor: "BARKBOX",
      category: "GENERAL_MERCHANDISE_PET_SUPPLIES",
      lo: 35,
      hi: 35,
      everyDays: 28,
      plan: true,
    },
    {
      descriptor: "MILLBROOK WATER DEPT",
      category: "RENT_AND_UTILITIES_WATER",
      lo: 88,
      hi: 141,
      everyDays: 91,
      plan: false,
    },
    {
      descriptor: "STATE FARM INSURANCE QTRLY",
      category: "GENERAL_SERVICES_INSURANCE",
      lo: 312,
      hi: 312,
      everyDays: 91,
      plan: false,
    },
  ],
  perPerson: [
    { descriptor: "GREAT CLIPS 4412", category: "PERSONAL_CARE_HAIR_AND_BEAUTY", lo: 22, hi: 22 },
    { descriptor: "RIVERSIDE PEDIATRICS", category: "MEDICAL_PRIMARY_CARE", lo: 30, hi: 30 },
    { descriptor: "BRIGHT SMILE DENTAL", category: "MEDICAL_DENTAL_CARE", lo: 45, hi: 45 },
  ],
  orders: { prefix: "AMZN Mktp US*", category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" },
  // Fixed monthly amounts that aren't plans, of the kinds real statements carry: a buy-now-pay-later
  // instalment, a car loan, home insurance by its premium, a chapel and a temple, a homeowners'
  // association, a robo-investing deposit and a pastry shop (round 14).
  notPlans: [
    {
      descriptor: "AFFIRM *PAY 3K9L2",
      category: "LOAN_PAYMENTS_OTHER_PAYMENT",
      lo: 58.33,
      hi: 58.33,
    },
    { descriptor: "KLARNA* NIKE", category: "LOAN_PAYMENTS_OTHER_PAYMENT", lo: 31.25, hi: 31.25 },
    { descriptor: "LAKESHORE AUTO FIN", category: "LOAN_PAYMENTS_CAR_PAYMENT", lo: 96, hi: 96 },
    { descriptor: "HOMESHIELD PREMIUM", category: "GENERAL_SERVICES_INSURANCE", lo: 64, hi: 64 },
    {
      descriptor: "NEW HOPE CHAPEL",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 75,
      hi: 75,
    },
    {
      descriptor: "BETH SHALOM TEMPLE",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 36,
      hi: 36,
    },
    { descriptor: "OAK RIDGE HOA", category: "RENT_AND_UTILITIES_OTHER_UTILITIES", lo: 85, hi: 85 },
    {
      descriptor: "ACORNS INVEST",
      category: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
      lo: 25,
      hi: 25,
    },
    {
      descriptor: "SUNNYSIDE PASTRY",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 12.5,
      hi: 12.5,
    },
  ],
  pricePlans: {
    descriptor: "GOOGLE *GOOGLE ONE",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    cents: [299, 999],
    alsoOk: DIGITAL,
  },
};

// A third held-out set (2026-10-27, after round 12): written to check whether round 12's chain
// names reach past the merchant pools they were seen beside. Its names were picked without
// looking at the rules: real chains of every size (national, regional, and written the way
// statements cut them: "CULVERS", "OLLIES", "HOBBY-LOBBY") and local places no list can know.
// Only ever scored.
const HELD_OUT_3: Pool = {
  grocers: [
    { descriptor: "FOOD CITY #0681", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "GIANT 6134", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "HARVEST MARKET 22", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "RALEY'S #112", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "BROOKSHIRE BROS #45", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "NEW SEASONS MARKET", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
    { descriptor: "STOP & SHOP 0441", category: "FOOD_AND_DRINK_GROCERIES", lo: 20, hi: 140 },
  ],
  restaurants: [
    { descriptor: "SQ *MAMA LUCIAS", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 70 },
    { descriptor: "TST* LITTLE SPOON", category: "FOOD_AND_DRINK_RESTAURANT", lo: 20, hi: 80 },
    { descriptor: "PANERA BREAD 601234", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 9, hi: 24 },
    { descriptor: "CULVERS OF MADISON", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 8, hi: 22 },
    { descriptor: "ZAXBYS #42101", category: "FOOD_AND_DRINK_FAST_FOOD", lo: 8, hi: 20 },
    { descriptor: "GRUBHUB*PHOLICIOUS", category: "FOOD_AND_DRINK_RESTAURANT", lo: 18, hi: 45 },
    { descriptor: "SWEET BASIL THAI", category: "FOOD_AND_DRINK_RESTAURANT", lo: 22, hi: 60 },
    { descriptor: "EL TORO LOCO", category: "FOOD_AND_DRINK_RESTAURANT", lo: 15, hi: 50 },
  ],
  coffee: [
    { descriptor: "DUTCH BROS #0412", category: "FOOD_AND_DRINK_COFFEE", lo: 4.75, hi: 4.75 },
    { descriptor: "SQ *MOXIE ROASTERS", category: "FOOD_AND_DRINK_COFFEE", lo: 5.25, hi: 5.25 },
    { descriptor: "BIGGBY COFFEE #221", category: "FOOD_AND_DRINK_COFFEE", lo: 4.1, hi: 4.1 },
  ],
  shops: [
    {
      descriptor: "AMAZON.COM*AB12CD34E",
      category: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      lo: 12,
      hi: 120,
    },
    {
      descriptor: "KOHLS #0921",
      category: "GENERAL_MERCHANDISE_DEPARTMENT_STORES",
      lo: 20,
      hi: 110,
    },
    {
      descriptor: "WALGREENS #5521",
      category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
      lo: 8,
      hi: 50,
    },
    { descriptor: "MENARDS 3311", category: "HOME_IMPROVEMENT_HARDWARE", lo: 15, hi: 200 },
    {
      descriptor: "OLLIES BARGAIN #112",
      category: "GENERAL_MERCHANDISE_DISCOUNT_STORES",
      lo: 10,
      hi: 60,
    },
    {
      descriptor: "BATH & BODY WORKS 0442",
      category: "PERSONAL_CARE_OTHER_PERSONAL_CARE",
      lo: 12,
      hi: 55,
    },
    {
      descriptor: "HOBBY-LOBBY #0412",
      category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      lo: 10,
      hi: 80,
    },
    { descriptor: "MEIJER #221", category: "GENERAL_MERCHANDISE_SUPERSTORES", lo: 20, hi: 140 },
    {
      descriptor: "FLEET FARM #12",
      category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      lo: 15,
      hi: 150,
    },
  ],
  gas: [
    { descriptor: "MAVERIK #427", category: "TRANSPORTATION_GAS", lo: 28, hi: 65 },
    { descriptor: "RACETRAC 2231", category: "TRANSPORTATION_GAS", lo: 28, hi: 65 },
    { descriptor: "HOLIDAY 0221", category: "TRANSPORTATION_GAS", lo: 28, hi: 65 },
    { descriptor: "KUM&GO 0614", category: "TRANSPORTATION_GAS", lo: 28, hi: 65 },
  ],
  rides: [
    {
      descriptor: "LYFT   *RIDE SAT 11PM",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 8,
      hi: 30,
    },
    {
      descriptor: "UBER   *TRIP HELP.UBER.COM",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 9,
      hi: 38,
    },
  ],
  subscriptions: [
    { descriptor: "NETFLIX.COM", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1549, rise: 1799 },
    { descriptor: "CRUNCHYROLL*MEMBERSHIP", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
    { descriptor: "FUBOTV INC", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 7999 },
    {
      descriptor: "NOOM INC",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 5900,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "PATREON* MEMBERSHIP",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 500,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "DUOLINGO PLUS",
      category: "GENERAL_SERVICES_EDUCATION",
      cents: 1299,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "SIMPLISAFE INC",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 2799,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "EXPRESSVPN",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 1295,
      alsoOk: DIGITAL,
    },
    {
      descriptor: "WSJ DIGITAL",
      category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
      cents: 1299,
      alsoOk: DIGITAL,
    },
    { descriptor: "XBOX GAME PASS", category: "ENTERTAINMENT_VIDEO_GAMES", cents: 1699 },
    {
      descriptor: "CRUNCH FITNESS",
      category: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      cents: 2499,
    },
    {
      descriptor: "RING BASIC PLAN",
      category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      cents: 499,
      alsoOk: DIGITAL,
    },
  ],
  trials: [
    { descriptor: "SHUDDER", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
    { descriptor: "ACORN TV", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
    { descriptor: "BRITBOX", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 799 },
  ],
  seats: [
    { descriptor: "FANDANGO", category: "ENTERTAINMENT_TV_AND_MOVIES", lo: 13, hi: 21 },
    {
      descriptor: "SEATGEEK",
      category: "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
      lo: 40,
      hi: 160,
    },
    { descriptor: "FRONTIER AI 4222123456789", category: "TRAVEL_FLIGHTS", lo: 90, hi: 260 },
  ],
  employers: [
    "INITECH LLC",
    "UMBRELLA CORP",
    "WAYNE ENTERPRISES",
    "SOYLENT CORP",
    "VANDELAY INDUSTRIES",
  ],
  landlords: ["MORGAN PROPERTIES", "CORTLAND PARTNERS", "SUMMIT RIDGE APTS"],
  power: ["GEORGIA POWER", "AMEREN MISSOURI", "TECO ENERGY", "OHIO EDISON"],
  internet: ["COX COMMUNICATIONS", "GOOGLE FIBER", "ZIPLY FIBER", "ASTOUND BROADBAND"],
  phones: ["VISIBLE SERVICE", "US CELLULAR", "CONSUMER CELLULAR"],
  insurers: ["AMICA MUTUAL INS", "ERIE INSURANCE GRP", "ROOT INSURANCE"],
  friends: ["RILEY OKAFOR", "MORGAN SILVA", "AVERY COHEN", "QUINN MURPHY", "DREW TANAKA"],
  water: "CITY OF RIVERTON WATER SVC",
  yearly: {
    descriptor: "SAMS CLUB MEMBERSHIP",
    category: "GENERAL_MERCHANDISE_SUPERSTORES",
    cents: 5000,
    alsoOk: DIGITAL,
  },
  twin: { descriptor: "PANDORA*PLUS", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 499 },
  pricePlans: {
    descriptor: "MIDJOURNEY INC.",
    category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    cents: [1000, 3000],
    alsoOk: DIGITAL,
  },
  notPlans: [
    {
      descriptor: "SUMMIT FCU LOAN PYMT",
      category: "LOAN_PAYMENTS_OTHER_PAYMENT",
      lo: 140,
      hi: 140,
    },
    { descriptor: "AMICA AUTO PREMIUM", category: "GENERAL_SERVICES_INSURANCE", lo: 92, hi: 92 },
    {
      descriptor: "GRACE FELLOWSHIP",
      category: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      lo: 40,
      hi: 40,
    },
    {
      descriptor: "SUNRISE DONUT",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 9.5,
      hi: 9.5,
    },
    { descriptor: "THE RUSTY ANCHOR", category: "FOOD_AND_DRINK_RESTAURANT", lo: 38, hi: 38 },
  ],
  irregular: [
    { descriptor: "VALLEY VIEW DENTAL", category: "MEDICAL_DENTAL_CARE", lo: 80, hi: 450 },
    { descriptor: "MIDAS #2231", category: "GENERAL_SERVICES_AUTOMOTIVE", lo: 70, hi: 520 },
  ],
  abroad: [
    {
      descriptor: "PAUL BOULANGERIE PARIS FRA",
      category: "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK",
      lo: 6,
      hi: 18,
    },
    { descriptor: "RATP PARIS", category: "TRANSPORTATION_PUBLIC_TRANSIT", lo: 2, hi: 16 },
    {
      descriptor: "G7 TAXI PARIS",
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      lo: 12,
      hi: 45,
    },
  ],
};

function person(index: number, set: CsvSet = "tuning"): CsvPerson {
  const base = {
    tuning: CSV_SEED,
    "tuning-2": CSV_TUNING_2_SEED,
    "held-out": CSV_HELD_OUT_SEED,
    "held-out-2": CSV_HELD_OUT_2_SEED,
    "held-out-3": CSV_HELD_OUT_3_SEED,
  }[set];
  const r = rng(base + index * 104_729);
  const id = `${{ tuning: "c", "tuning-2": "t", "held-out": "d", "held-out-2": "e", "held-out-3": "f" }[set]}${String(index + 1).padStart(2, "0")}`;
  const P = {
    tuning: TUNING,
    "tuning-2": TUNING_2,
    "held-out": HELD_OUT,
    "held-out-2": HELD_OUT_2,
    "held-out-3": HELD_OUT_3,
  }[set];
  const archetype = ARCHETYPES[index % ARCHETYPES.length];
  const months = 3 + (index % 4);
  const asOf = CSV_AS_OF;
  const start = addMonths(asOf, -months, 1);
  const L = new Ledger(id, start, asOf);
  // The held-out set banks elsewhere: the same plans, shifted.
  const plan =
    PLANS[
      {
        tuning: index,
        "tuning-2": (index + 5) % PLANS.length,
        "held-out": (index + 7) % PLANS.length,
        "held-out-2": (index + 13) % PLANS.length,
        "held-out-3": (index + 3) % PLANS.length,
      }[set]
    ];

  const mask = () => String(r.int(1000, 9999));
  const checking: CsvAccount = {
    id: `${id}-chk`,
    layout: plan.checking,
    kind: "checking",
    name: `${BANK_NAMES[plan.checking]} checking`,
    mask: mask(),
    openingCents:
      archetype === "saver"
        ? r.cents(18_000, 30_000)
        : archetype === "struggling"
          ? r.cents(80, 400)
          : r.cents(1_500, 5_000),
    typesBalance: r.chance(0.6),
  };
  const savings: CsvAccount | null = plan.savings
    ? {
        id: `${id}-sav`,
        layout: plan.savings,
        kind: "savings",
        name: `${BANK_NAMES[plan.savings]} savings`,
        mask: mask(),
        openingCents: r.cents(2_000, 12_000),
        typesBalance: r.chance(0.6),
      }
    : null;
  const carriesDebt = archetype === "struggling" || archetype === "hourly" || r.chance(0.2);
  const cards: CsvAccount[] = plan.cards.map((layout, i) => ({
    id: `${id}-card${i + 1}`,
    layout,
    kind: "credit_card",
    name: `${BANK_NAMES[layout]} card`,
    mask: mask(),
    openingCents: carriesDebt && i === 0 ? r.cents(1_800, 6_000) : r.cents(150, 900),
    typesBalance: r.chance(0.6),
  }));
  const accounts = [checking, ...(savings ? [savings] : []), ...cards];
  const card = cards[0];
  const chk = checking.id;

  // Pay.
  const employer = r.pick(P.employers);
  if (archetype === "retiree") {
    const ssa = r.cents(1_400, 2_600);
    L.monthly(3, (date) =>
      L.add({
        account: chk,
        date,
        amountCents: -ssa,
        descriptor: "SSA TREAS 310 XXSOC SEC",
        category: "INCOME_RETIREMENT_PENSION",
        alsoOk: ["INCOME"],
        kind: "income",
        flow: "deposit",
      }),
    );
    const pension = r.cents(600, 1_400);
    L.monthly(1, (date) =>
      L.add({
        account: chk,
        date,
        amountCents: -pension,
        descriptor: "CALPERS RETIREMENT",
        category: "INCOME_RETIREMENT_PENSION",
        kind: "income",
        flow: "deposit",
      }),
    );
  } else if (archetype === "gig") {
    L.every(7, addDays(start, r.int(0, 6)), (date) =>
      L.add({
        account: chk,
        date,
        amountCents: -r.cents(250, 700),
        descriptor: r.chance(0.5) ? "UBER USA 6787 EDI PAYMNT" : "DOORDASH, INC. PAYOUT",
        category: "INCOME_GIG_ECONOMY",
        kind: "income",
        flow: "deposit",
      }),
    );
  } else {
    const net =
      archetype === "saver"
        ? r.cents(3_200, 4_200)
        : archetype === "struggling"
          ? r.cents(900, 1_300)
          : r.cents(1_700, 2_800);
    // Every other Friday.
    let first = addDays(start, r.int(0, 13));
    while (weekday(first) !== 5) first = addDays(first, 1);
    L.every(14, first, (date) =>
      L.add({
        account: chk,
        date,
        amountCents: -(archetype === "hourly" ? r.cents(net / 100 - 250, net / 100 + 250) : net),
        descriptor: `${employer} PAYROLL`,
        category: "INCOME_SALARY",
        kind: "income",
        flow: "payroll",
      }),
    );
  }

  // Rent: by ACH, or by Zelle to the landlord.
  const rent = r.cents(1_100, 2_400);
  const zelleRent = r.chance(0.35);
  // Or by paper check, numbered: nothing in the row says it's rent.
  const checkRent = !zelleRent && r.chance(0.25);
  let checkNo = r.int(1001, 1400);
  const landlord = r.pick(P.landlords);
  const rentRows: string[] = [];
  L.monthly(1, (date) => {
    const row = L.add(
      checkRent
        ? {
            account: chk,
            date,
            amountCents: rent,
            descriptor: `CHECK ${(checkNo += 1)}`,
            category: "RENT_AND_UTILITIES_RENT",
            alsoOk: ["TRANSFER_OUT", "GENERAL_SERVICES", "OTHER"],
            kind: "either",
            flow: "check",
          }
        : zelleRent
          ? {
              account: chk,
              date,
              amountCents: rent,
              descriptor: "ZELLE TO MORGAN REYES",
              category: "RENT_AND_UTILITIES_RENT",
              alsoOk: ["TRANSFER_OUT"],
              kind: "either",
              flow: "zelle_out",
            }
          : {
              account: chk,
              date,
              amountCents: rent,
              descriptor: landlord,
              category: "RENT_AND_UTILITIES_RENT",
              kind: "spending",
              flow: "ach_out",
            },
    );
    if (row) rentRows.push(row.id);
  });
  // Rent by Zelle is a payment to a person: the cash forecast takes it out as a transfer, and
  // "Coming up" may list it or not.
  if (zelleRent || checkRent) L.neutralBills.push(rentRows);
  else L.bill(rentRows, "rent");

  // Bills: power moves with the season, internet and phone are fixed, water every 3 months.
  const power = r.pick(P.power);
  const powerBase = r.cents(45, 120);
  const powerDay = r.int(8, 20);
  const powerRows: string[] = [];
  L.monthly(powerDay, (date) => {
    const month = Number(date.slice(5, 7));
    const season = month >= 6 && month <= 9 ? 1.6 : 1;
    const row = L.add({
      account: chk,
      date,
      amountCents: Math.round(powerBase * season * (0.85 + r.next() * 0.3)),
      descriptor: power,
      category: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
      kind: "spending",
      flow: "ach_out",
    });
    if (row) powerRows.push(row.id);
  });
  L.bill(powerRows, power);
  const internet = {
    descriptor: r.pick(P.internet),
    category: "RENT_AND_UTILITIES_INTERNET_AND_CABLE" as const,
  };
  const internetCents = r.cents(55, 90);
  const internetDay = r.int(5, 25);
  const internetRows: string[] = [];
  L.monthly(internetDay, (date) => {
    const row = L.add(spend(card.id, date, internetCents, internet));
    if (row) internetRows.push(row.id);
  });
  const phone = { descriptor: r.pick(P.phones), category: "RENT_AND_UTILITIES_TELEPHONE" as const };
  const phoneCents = r.cents(45, 140);
  const phoneRows: string[] = [];
  L.monthly(r.int(10, 27), (date) => {
    const row = L.add(spend(card.id, date, phoneCents, phone));
    if (row) phoneRows.push(row.id);
  });
  // A bill, not a subscription to review; Jane isn't wrong either way.
  L.neutral.push(internetRows, phoneRows);
  L.bill(internetRows, internet.descriptor);
  L.bill(phoneRows, phone.descriptor);
  if (r.chance(0.5)) {
    const water = r.cents(60, 140);
    let date = addMonths(start, r.int(0, 2), 18);
    const waterRows: string[] = [];
    let last = date;
    for (; date <= asOf; date = addMonths(date, 3, 18)) {
      last = date;
      const row = L.add({
        account: chk,
        date,
        amountCents: water + r.int(-1500, 1500),
        descriptor: P.water,
        category: "RENT_AND_UTILITIES_WATER",
        kind: "spending",
        flow: "ach_out",
      });
      if (row) waterRows.push(row.id);
    }
    // Every three months: coming up only when the next one is within the month.
    // Two bills three months apart are too few to call.
    if (waterRows.length >= 3 && addMonths(last, 3, 18) <= addDays(asOf, 31))
      L.bill(waterRows, "water");
    else L.neutralBills.push(waterRows);
  }
  // Car insurance: monthly, or every six months.
  if (r.chance(0.6)) {
    const insurer = r.pick(P.insurers);
    const premium = r.cents(90, 180);
    if (r.chance(0.6)) {
      const rows: string[] = [];
      L.monthly(r.int(2, 26), (date) => {
        const row = L.add({
          account: chk,
          date,
          amountCents: premium,
          descriptor: insurer,
          category: "GENERAL_SERVICES_INSURANCE",
          kind: "spending",
          flow: "ach_out",
        });
        if (row) rows.push(row.id);
      });
      L.neutral.push(rows);
      L.bill(rows, insurer);
    } else {
      L.add({
        account: chk,
        date: addMonths(start, 1, 12),
        amountCents: premium * 6,
        descriptor: insurer,
        category: "GENERAL_SERVICES_INSURANCE",
        kind: "spending",
        flow: "ach_out",
      });
    }
  }

  // Subscriptions, on the card mostly. Some rose in price part-way.
  const subs = [...P.subscriptions].sort(() => r.next() - 0.5).slice(0, r.int(2, 6));
  for (const sub of subs) {
    const onCard = r.chance(0.8) ? r.pick(cards).id : chk;
    const day = r.int(1, 28);
    const rises = sub.rise !== undefined && r.chance(0.45);
    const riseAt = rises ? Math.max(2, months - r.int(1, 2)) : Infinity;
    // Cancelled two months ago: no longer a subscription, nor a bill.
    const stopAt = !rises && months >= 4 && r.chance(0.2) ? months - 2 : Infinity;
    const rows: string[] = [];
    const before: number[] = [];
    L.monthly(day, (date, i) => {
      if (i >= stopAt) return;
      const cents = i >= riseAt ? sub.rise! : sub.cents;
      // Billed a day or two late now and then (weekends), and written one of its ways.
      const on = r.chance(0.3) ? addDays(date, r.int(1, 2)) : date;
      const descriptor = sub.variants && r.chance(0.35) ? r.pick(sub.variants) : sub.descriptor;
      const row = L.add(spend(onCard, on, cents, { ...sub, descriptor }));
      if (row) {
        rows.push(row.id);
        if (i < riseAt) before.push(cents);
      }
    });
    if (stopAt !== Infinity) {
      L.traps.push({ type: "subscription_review", rows, note: `${sub.descriptor}, cancelled` });
      continue;
    }
    L.bill(rows, sub.descriptor);
    if (rows.length >= 2) {
      const last = L.rows.find((x) => x.id === rows[rows.length - 1])!;
      L.findings.push({
        type: "subscription_review",
        rows,
        annualCents: last.amountCents * 12,
        note: sub.descriptor,
      });
    }
    if (rises && before.length >= 2 && rows.length > before.length) {
      L.findings.push({
        type: "price_increase",
        rows,
        annualCents: (sub.rise! - sub.cents) * 12,
        note: `${sub.descriptor} ${sub.cents}→${sub.rise}`,
      });
    }
  }

  // A trial that became the full price in the last few weeks.
  if (index % 4 === 1) {
    const trial = P.trials[index % P.trials.length];
    const startOn = addDays(asOf, -r.int(25, 40));
    const full = addDays(startOn, r.int(7, 14));
    const a = L.add({ ...spend(card.id, startOn, r.chance(0.5) ? 100 : 99, trial) });
    const b = L.add(spend(card.id, full, trial.cents, trial));
    if (a && b) {
      L.findings.push({
        type: "trial_conversion",
        rows: [a.id, b.id],
        annualCents: trial.cents,
        note: `${trial.descriptor} trial`,
      });
      L.neutral.push([a.id, b.id]);
      L.neutralBills.push([a.id, b.id]);
    }
  }

  // Bills that come when they come: two or three at uneven gaps, never a subscription or a
  // bill to expect.
  for (const m of P.irregular) {
    if (!r.chance(0.4)) continue;
    const rows: string[] = [];
    let date = addDays(start, r.int(5, 30));
    for (let n = r.int(2, 3); n > 0 && date <= asOf; n -= 1, date = addDays(date, r.int(40, 75))) {
      const row = L.add(spend(r.chance(0.7) ? card.id : chk, date, r.cents(m.lo, m.hi), m));
      if (row) rows.push(row.id);
    }
    if (rows.length >= 2)
      L.traps.push({ type: "subscription_review", rows, note: `${m.descriptor}, irregular` });
  }

  // A roommate's share of the bills, the same each month, by Zelle: money moved, not income.
  if (r.chance(0.3)) {
    const friend = r.pick(P.friends);
    const share = r.cents(40, 120);
    L.monthly(r.int(3, 8), (date) =>
      L.add({
        account: chk,
        date,
        amountCents: -share,
        descriptor: `ZELLE FROM ${friend}`,
        category: "TRANSFER_IN_ACCOUNT_TRANSFER",
        alsoOk: ["TRANSFER_IN"],
        kind: "moving",
        flow: "zelle_in",
      }),
    );
  }

  // A gym's yearly fee, beside its monthly one: still one subscription.
  const gym = subs.find((x) => x.descriptor === "PLANET FITNESS" || x.descriptor === "LA FITNESS");
  if (gym) {
    L.add(
      spend(chk, addDays(start, r.int(20, 50)), 4900, {
        ...gym,
        descriptor: `${gym.descriptor} ANNUAL FEE`,
      }),
    );
  }

  // A yearly plan, paid once in the history.
  if (r.chance(0.35)) {
    const plan = P.yearly;
    const row = L.add(
      spend(card.id, addDays(start, r.int(10, months * 30 - 20)), plan.cents, plan),
    );
    if (row) {
      L.findings.push({
        type: "subscription_review",
        rows: [row.id],
        annualCents: plan.cents,
        note: `${plan.descriptor} yearly`,
      });
    }
  }

  // A trip abroad on a card that charges a foreign transaction fee (3%), each fee its own line.
  const feeCard = cards.find(
    (c) => !["capital_one_credit_card", "discover_credit_card"].includes(c.layout),
  );
  const abroadFees: { id: string; cents: number; account: string }[] = [];
  if (feeCard && r.chance(0.35)) {
    const from = addDays(asOf, -r.int(20, 80));
    for (let d = 0; d < 6; d += 1) {
      const m = r.pick(P.abroad);
      const date = addDays(from, d);
      const cents = r.cents(m.lo, m.hi);
      L.add(spend(feeCard.id, date, cents, m));
      const fx = Math.round(cents * 0.03);
      const row = L.add({
        account: feeCard.id,
        date,
        amountCents: fx,
        descriptor: "FOREIGN TRANSACTION FEE",
        category: "BANK_FEES_FOREIGN_TRANSACTION_FEES",
        kind: "spending",
        flow: "fee",
      });
      if (row) abroadFees.push({ id: row.id, cents: fx, account: feeCard.id });
    }
  }

  // A tax refund, and cash back taken as a statement credit.
  if (r.chance(0.3)) {
    L.add({
      account: chk,
      date: addDays(start, r.int(20, 60)),
      amountCents: -r.cents(300, 1800),
      descriptor: "IRS TREAS 310 TAX REF",
      category: "INCOME_TAX_REFUND",
      kind: "income",
      flow: "deposit",
    });
  }
  if (r.chance(0.5)) {
    L.add({
      account: card.id,
      date: addDays(asOf, -r.int(5, 60)),
      amountCents: -r.cents(15, 80),
      descriptor: "cash back",
      category: "INCOME_OTHER",
      alsoOk: ["TRANSFER_IN", "LOAN_PAYMENTS"],
      kind: "either",
      flow: "reward",
    });
  }

  // Everyday spending: groceries weekly, eating out, coffee at one price, gas, shops, rides.
  const grocer = r.pick(P.grocers);
  const coffee = r.pick(P.coffee);
  const coffeeRows: string[] = [];
  const shops = [r.pick(P.shops), r.pick(P.shops)];
  const pay = () => (r.chance(0.85) ? r.pick(cards).id : chk);
  L.days((date, wd) => {
    if (wd === 6 || r.chance(0.08))
      L.add(spend(pay(), date, r.cents(grocer.lo, grocer.hi), grocer));
    if (r.chance(archetype === "struggling" ? 0.12 : 0.25)) {
      const m = r.pick(P.restaurants);
      L.add(spend(pay(), date, r.cents(m.lo, m.hi), m));
    }
    if (wd >= 1 && wd <= 5 && r.chance(0.45)) {
      const row = L.add(spend(pay(), date, Math.round(coffee.lo * 100), coffee));
      if (row) coffeeRows.push(row.id);
    }
    if (r.chance(0.09)) {
      const m = r.pick(P.gas);
      L.add(spend(pay(), date, r.cents(m.lo, m.hi), m));
    }
    if (r.chance(0.07)) {
      const m = r.pick(shops);
      L.add(spend(pay(), date, r.cents(m.lo, m.hi), m));
    }
    if (r.chance(0.06)) {
      const m = r.pick(P.rides);
      L.add(spend(pay(), date, r.cents(m.lo, m.hi), m));
    }
  });
  if (coffeeRows.length >= 6)
    L.traps.push({
      type: "subscription_review",
      rows: coffeeRows,
      note: `${coffee.descriptor} at one price`,
    });

  // A return: money back on the card.
  if (r.chance(0.6)) {
    const m = P.shops[0];
    const date = addDays(asOf, -r.int(10, 80));
    const cents = r.cents(20, 90);
    L.add(spend(card.id, date, cents, m));
    L.add({ ...spend(card.id, addDays(date, r.int(5, 12)), -cents, m), flow: "refund" });
  }

  // Part of an order sent back.
  if (r.chance(0.4)) {
    const m = P.shops[1];
    const date = addDays(asOf, -r.int(15, 90));
    const cents = r.cents(60, 200);
    L.add(spend(card.id, date, cents, m));
    L.add({
      ...spend(card.id, addDays(date, r.int(6, 15)), -Math.round(cents * 0.4), m),
      flow: "refund",
    });
  }

  // Dinner charged twice (a real double charge at a restaurant), or two lunches at one price
  // on one day (not one).
  if (index % 5 === 2) {
    const m = P.restaurants[1];
    const date = addDays(asOf, -r.int(5, 40));
    const cents = r.cents(45, 95);
    const first = L.add(spend(card.id, date, cents, m));
    const second = L.add(spend(card.id, addDays(date, 1), cents, m));
    if (first && second) {
      L.findings.push({
        type: "duplicate_charge",
        rows: [first.id, second.id],
        annualCents: cents,
        note: `${m.descriptor} dinner twice`,
      });
    }
  } else if (index % 5 === 3) {
    const m = P.restaurants[0];
    const date = addDays(asOf, -r.int(5, 40));
    const cents = 1250;
    const ids = [
      L.add(spend(card.id, date, cents, m))?.id,
      L.add(spend(card.id, date, cents, m))?.id,
    ].filter((x): x is string => !!x);
    L.traps.push({ type: "duplicate_charge", rows: ids, note: "two lunches" });
  }

  // A group's tickets bought together: not a double charge.
  if (r.chance(0.45)) {
    const seat = r.pick(P.seats);
    const date = addDays(asOf, -r.int(5, 50));
    const cents = r.cents(seat.lo, seat.hi);
    const n = r.int(2, 3);
    const ids = Array.from(
      { length: n },
      () => L.add(spend(card.id, date, cents, seat))?.id,
    ).filter((x): x is string => !!x);
    L.traps.push({ type: "duplicate_charge", rows: ids, note: `${n} ${seat.descriptor} seats` });
  }

  // A real double charge (the shop ran the card twice), recent enough to dispute; or one the
  // shop already refunded.
  if (index % 3 === 0) {
    const m = r.pick(P.shops.slice(2));
    const date = addDays(asOf, -r.int(5, 45));
    const cents = r.cents(40, 160);
    const first = L.add(spend(card.id, date, cents, m));
    const second = L.add(spend(card.id, addDays(date, r.int(0, 1)), cents, m));
    if (first && second) {
      L.findings.push({
        type: "duplicate_charge",
        rows: [first.id, second.id],
        annualCents: cents,
        note: `${m.descriptor} twice`,
      });
    }
  } else if (index % 3 === 1) {
    const m = r.pick(P.shops.slice(2));
    const date = addDays(asOf, -r.int(15, 45));
    const cents = r.cents(40, 160);
    const first = L.add(spend(card.id, date, cents, m));
    const second = L.add(spend(card.id, addDays(date, 1), cents, m));
    L.add({ ...spend(card.id, addDays(date, r.int(4, 9)), -cents, m), flow: "refund" });
    if (first && second) {
      L.traps.push({
        type: "duplicate_charge",
        rows: [first.id, second.id],
        note: `${m.descriptor} twice, refunded`,
      });
    }
  }

  // Money moved: to savings, to and from friends on Venmo and Zelle, cash.
  if (savings) {
    const move = r.cents(150, 600);
    L.monthly(r.int(2, 6), (date) => {
      L.add({
        account: chk,
        date,
        amountCents: move,
        descriptor: "TRANSFER TO SAVINGS",
        category: "TRANSFER_OUT_SAVINGS",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "transfer_out",
      });
      L.add({
        account: savings.id,
        date,
        amountCents: -move,
        descriptor: "TRANSFER FROM CHECKING",
        category: "TRANSFER_IN_SAVINGS",
        alsoOk: ["TRANSFER_IN"],
        kind: "moving",
        flow: "transfer_in",
      });
    });
    L.monthly(28, (date) =>
      L.add({
        account: savings.id,
        date,
        amountCents: -Math.round(((savings.openingCents / 100) * 4.0) / 12),
        descriptor: "INTEREST PAID",
        category: "INCOME_INTEREST_EARNED",
        kind: "income",
        flow: "interest_earned",
      }),
    );
  }
  for (let i = 0; i < months; i += 1) {
    const friend = r.pick(P.friends);
    const date = addDays(start, r.int(i * 30, i * 30 + 29));
    if (r.chance(0.6)) {
      L.add({
        account: chk,
        date,
        amountCents: r.cents(12, 80),
        descriptor: `VENMO PAYMENT ${friend}`,
        category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "venmo_out",
      });
    }
    if (r.chance(0.4)) {
      L.add({
        account: chk,
        date: addDays(date, 3),
        amountCents: -r.cents(20, 120),
        descriptor: `ZELLE FROM ${friend}`,
        category: "TRANSFER_IN_ACCOUNT_TRANSFER",
        alsoOk: ["TRANSFER_IN"],
        kind: "moving",
        flow: "zelle_in",
      });
    }
    if (r.chance(0.3)) {
      L.add({
        account: chk,
        date: addDays(date, 6),
        amountCents: -r.cents(40, 200),
        descriptor: "VENMO CASHOUT",
        category: "TRANSFER_IN_ACCOUNT_TRANSFER",
        alsoOk: ["TRANSFER_IN"],
        kind: "moving",
        flow: "venmo_in",
      });
    }
    if (r.chance(0.5)) {
      L.add({
        account: chk,
        date: addDays(date, 9),
        amountCents: r.int(2, 10) * 2000,
        descriptor: "ATM WITHDRAWAL",
        category: "TRANSFER_OUT_WITHDRAWAL",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "atm",
      });
    }
  }

  // Fees on checking: a monthly service fee for some, overdrafts for the struggling (one given
  // back), an out-of-network ATM fee.
  const fees: { id: string; cents: number }[] = [];
  const fee = (
    account: string,
    date: string,
    cents: number,
    descriptor: string,
    category: PfcDetailed,
  ) => {
    const row = L.add({
      account,
      date,
      amountCents: cents,
      descriptor,
      category,
      kind: "spending",
      flow: "fee",
    });
    if (row) fees.push({ id: row.id, cents });
    return row;
  };
  if (r.chance(0.3) && archetype !== "saver") {
    const feeRows: string[] = [];
    L.monthly(r.int(25, 28), (date) => {
      const row = fee(chk, date, 1200, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES");
      if (row) feeRows.push(row.id);
    });
    // It comes every month, so the forecast has to take it out (docs/accuracy.md).
    L.bill(feeRows, "monthly service fee");
  }
  if (archetype === "struggling") {
    const n = r.int(2, 4);
    for (let i = 0; i < n; i += 1) {
      const date = addDays(start, r.int(5, months * 30 - 5));
      const od = fee(chk, date, 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES");
      if (od && i === 0) {
        const back = L.add({
          account: chk,
          date: addDays(date, 2),
          amountCents: -3400,
          descriptor: "OVERDRAFT FEE REVERSAL",
          category: "BANK_FEES_OVERDRAFT_FEES",
          kind: "spending",
          flow: "fee_refund",
        });
        if (back) fees.push({ id: back.id, cents: -3400 });
      }
    }
  }
  if (r.chance(0.35))
    fee(chk, addDays(start, r.int(10, 60)), 300, "NON-NETWORK ATM FEE", "BANK_FEES_ATM_FEES");
  // On a card: an annual fee, a late fee.
  const cardFees: { id: string; cents: number; account: string }[] = [...abroadFees];
  for (const c of cards) {
    if (c.layout === "amex" && r.chance(0.7)) {
      const cents = r.pick([9500, 25_000, 69_500]);
      const row = L.add({
        account: c.id,
        date: addMonths(start, r.int(0, months - 1), 14),
        amountCents: cents,
        descriptor: "ANNUAL MEMBERSHIP FEE",
        category: "BANK_FEES_OTHER_BANK_FEES",
        kind: "spending",
        flow: "fee",
      });
      if (row) cardFees.push({ id: row.id, cents, account: c.id });
    }
  }
  if (archetype === "struggling") {
    const row = L.add({
      account: card.id,
      date: addMonths(start, 1, 22),
      amountCents: 4000,
      descriptor: "LATE FEE",
      category: "BANK_FEES_LATE_FEES",
      kind: "spending",
      flow: "fee",
    });
    if (row) cardFees.push({ id: row.id, cents: 4000, account: card.id });
  }
  const feeTotal = fees.reduce((s, f) => s + f.cents, 0);
  if (feeTotal > 0) {
    L.findings.push({
      type: "bank_fees",
      account: chk,
      rows: fees.map((f) => f.id),
      annualCents: feeTotal,
      note: "checking fees",
    });
  }
  for (const c of cards) {
    const own = cardFees.filter((f) => f.account === c.id);
    if (own.length > 0) {
      L.findings.push({
        type: "bank_fees",
        account: c.id,
        rows: own.map((f) => f.id),
        annualCents: own.reduce((s, f) => s + f.cents, 0),
        note: "card fees",
      });
    }
  }

  // Card statements: each month the card's interest (on carried debt) posts, and checking pays
  // the card: the whole balance, or part of it for those carrying debt.
  for (const c of cards) {
    const interestRows: string[] = [];
    const paidRows: string[] = [];
    let interest = 0;
    const statementDay = r.int(3, 24);
    const dueGap = r.int(18, 23);
    L.monthly(statementDay, (statement) => {
      // What's owed at the statement: opening plus what posted, minus what was paid.
      const owed =
        c.openingCents +
        L.rows
          .filter((x) => x.account === c.id && x.date <= statement)
          .reduce((s, x) => s + x.amountCents, 0);
      if (carriesDebt && c === card && owed > 50_000) {
        const cents = Math.round((owed * 0.2399) / 12);
        const row = L.add({
          account: c.id,
          date: statement,
          amountCents: cents,
          descriptor: "INTEREST CHARGE ON PURCHASES",
          category: "BANK_FEES_INTEREST_CHARGE",
          kind: "spending",
          flow: "interest_charge",
        });
        if (row) {
          interestRows.push(row.id);
          interest += cents;
        }
      }
      if (owed <= 0) return;
      const paid = carriesDebt && c === card ? Math.max(4_000, Math.round(owed * 0.35)) : owed;
      const due = addDays(statement, dueGap);
      // Checking pays the day before the card posts it, or the same day.
      const lag = r.int(0, 2);
      const out = L.add({
        account: chk,
        date: due,
        amountCents: paid,
        descriptor: "card_payment",
        category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "card_payment_out",
      });
      if (out) paidRows.push(out.id);
      L.add({
        account: c.id,
        date: addDays(due, lag),
        amountCents: -paid,
        descriptor: "card_payment",
        category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        alsoOk: ["TRANSFER_IN"],
        kind: "moving",
        flow: "card_payment_in",
      });
    });
    // The card's payment from checking is a bill: it comes every month (docs/accuracy.md).
    L.bill(paidRows, `${c.name} payment`);
    if (interest > 0) {
      L.findings.push({
        type: "card_interest",
        account: c.id,
        rows: interestRows,
        annualCents: interest,
        note: "card interest",
      });
    }
  }

  // Pending copies: a Citi export taken mid-month lists some charges as pending, at the amount
  // authorised (a tip added later) and the day swiped.
  for (const c of cards.filter((x) => x.layout === "citi_credit_card")) {
    const recent = L.rows.filter(
      (x) =>
        x.account === c.id &&
        x.flow === "purchase" &&
        x.date > addDays(asOf, -25) &&
        x.date <= addDays(asOf, -23),
    );
    // The export was taken on the 25th day back (./layouts.ts): swiped then, posted after.
    for (const row of recent.filter((_, i) => i % 2 === 0)) {
      const tip =
        row.category === "FOOD_AND_DRINK_RESTAURANT"
          ? Math.round(row.amountCents / 1.2)
          : row.amountCents;
      row.pendingCopy = { date: addDays(asOf, -25), amountCents: tip };
      if (tip === row.amountCents) {
        L.traps.push({
          type: "duplicate_charge",
          rows: [row.id],
          note: "pending copy of a posted charge",
        });
      }
    }
  }

  // Two fixed monthly amounts that aren't subscriptions, from their own dice so no other row
  // changes: on checking, the same price on the same day every month.
  const q = rng(base + index * 104_729 + 28);
  for (const m of [...P.notPlans].sort(() => q.next() - 0.5).slice(0, 2)) {
    const rows: string[] = [];
    const day = q.int(3, 26);
    L.monthly(day, (date) => {
      const row = L.add({
        ...spend(chk, date, Math.round(m.lo * 100), m),
        alsoOk: m.category.startsWith("FOOD") ? ["FOOD_AND_DRINK"] : undefined,
      });
      if (row) rows.push(row.id);
    });
    L.traps.push({ type: "subscription_review", rows, note: `${m.descriptor}, not a plan` });
    // A loan payment and insurance are bills; a gift or a meal may be listed or not.
    if (m.category.startsWith("LOAN") || m.category.endsWith("INSURANCE"))
      L.bill(rows, m.descriptor);
    else L.neutralBills.push(rows);
  }

  // Round 21, from its own dice: monthly, then switched to yearly two months ago.
  const ty = rng(base + index * 104_729 + 35);
  if (P.toYearly && months >= 5 && ty.chance(0.5)) {
    const plan = ty.pick(P.toYearly);
    const day = ty.int(2, 27);
    const monthlyRows: string[] = [];
    L.monthly(day, (date, i) => {
      if (i < months - 2) {
        const row = L.add(spend(card.id, date, plan.monthly, plan));
        if (row) monthlyRows.push(row.id);
      } else if (i === months - 2) {
        const row = L.add(spend(card.id, date, plan.yearly, plan));
        if (row)
          L.findings.push({
            type: "subscription_review",
            rows: [row.id],
            annualCents: plan.yearly,
            note: `${plan.descriptor}, now yearly`,
          });
      }
    });
    L.traps.push({
      type: "subscription_review",
      rows: monthlyRows,
      note: `${plan.descriptor}, the monthly plan it left`,
    });
  }

  // Investing transfers (read-only beta, 2026-10-28), from its own dice: money sent to a
  // brokerage or an investing app each month, and sometimes an IRA contribution, is moved and never
  // spending, a subscription or a bill, however the bank words it.
  const iv = rng(base + index * 104_729 + 36);
  if (iv.chance(0.55)) {
    const app = INVESTING_TRANSFERS[(index + (iv.int(0, 99) % 5)) % INVESTING_TRANSFERS.length];
    const day = iv.int(2, 26);
    const fixed = iv.chance(0.6);
    const amount = iv.cents(25, 400);
    const rows: string[] = [];
    L.monthly(day, (date) => {
      const row = L.add({
        account: chk,
        date,
        amountCents: fixed ? amount : iv.cents(25, 400),
        descriptor: app.descriptor,
        category: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "ach_out",
      });
      if (row) rows.push(row.id);
    });
    L.traps.push({
      type: "subscription_review",
      rows,
      note: `${app.descriptor}, money sent to an investing account`,
    });
    L.neutralBills.push(rows);
    if (iv.chance(0.35)) {
      L.add({
        account: chk,
        date: addDays(start, iv.int(20, Math.max(21, months * 30 - 5))),
        amountCents: iv.cents(200, 600),
        descriptor: "IRA CONTRIB",
        category: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "ach_out",
      });
    }
  }

  // Round 19, from its own dice: a plan that moved card, one on the month's last day, one service
  // from two cards.
  const mv = rng(base + index * 104_729 + 34);
  if (P.moved && mv.chance(0.6)) {
    const sub = P.moved[index % P.moved.length];
    const kind = (["moved", "monthEnd", "twoCards"] as const)[index % 3];
    const other = cards.length > 1 ? cards[1].id : chk;
    const day = kind === "monthEnd" ? 31 : mv.int(2, 20);
    const moveAt = Math.max(1, months - mv.int(1, 2));
    const runs: { account: string; day: number }[] =
      kind === "twoCards"
        ? [
            { account: card.id, day },
            { account: other, day: day + mv.int(5, 8) },
          ]
        : [{ account: card.id, day }];
    for (const run of runs) {
      const rows: string[] = [];
      L.monthly(run.day, (date, i) => {
        const account = kind === "moved" && i >= moveAt ? other : run.account;
        const row = L.add(spend(account, date, sub.cents, sub));
        if (row) rows.push(row.id);
      });
      L.findings.push({
        type: "subscription_review",
        rows,
        annualCents: sub.cents * 12,
        note: `${sub.descriptor}, ${kind}`,
      });
      L.bill(rows, sub.descriptor);
    }
  }

  // A plan paused for one month in the middle (round 18), from its own dice.
  const pz = rng(base + index * 104_729 + 33);
  if (P.paused && months >= 4 && pz.chance(0.5)) {
    const sub = pz.pick(P.paused);
    const day = pz.int(2, 27);
    const skip = pz.int(1, months - 3);
    const rows: string[] = [];
    L.monthly(day, (date, i) => {
      if (i === skip) return;
      const row = L.add(spend(card.id, date, sub.cents, sub));
      if (row) rows.push(row.id);
    });
    L.findings.push({
      type: "subscription_review",
      rows,
      annualCents: sub.cents * 12,
      note: `${sub.descriptor}, paused a month`,
    });
    L.bill(rows, sub.descriptor);
  }

  // Charges on another cadence (round 16), from their own dice: one or two per person.
  const cd = rng(base + index * 104_729 + 32);
  for (const c of P.cadences
    ? [...P.cadences].sort(() => cd.next() - 0.5).slice(0, cd.int(1, 2))
    : []) {
    const rows: string[] = [];
    const onCard = c.plan ? card.id : chk;
    L.every(c.everyDays, addDays(start, cd.int(0, c.everyDays - 1)), (date) => {
      const row = L.add({
        ...spend(onCard, date, cd.cents(c.lo, c.hi), c),
        alsoOk: c.category.startsWith("FOOD") ? ["FOOD_AND_DRINK"] : undefined,
      });
      if (row) rows.push(row.id);
    });
    if (c.plan && rows.length >= 2) {
      L.findings.push({
        type: "subscription_review",
        rows,
        annualCents: Math.round((c.lo * 100 * 365) / c.everyDays),
        note: `${c.descriptor} every ${c.everyDays} days`,
      });
    }
    // "Coming up" covers the next 31 days: a quarterly bill paid last month isn't due again in
    // them, so it's one Jane may list or not.
    const last = L.rows.find((x) => x.id === rows[rows.length - 1]);
    if (last && addDays(last.date, c.everyDays) <= addDays(asOf, 31)) L.bill(rows, c.descriptor);
    else L.neutralBills.push(rows);
  }

  // Same price, same day, not charged twice (round 14), from their own dice: two people's
  // haircuts or copays, and two orders with their own order numbers.
  const pp = rng(base + index * 104_729 + 31);
  if (P.perPerson && pp.chance(0.5)) {
    const m = pp.pick(P.perPerson);
    const date = addDays(asOf, -pp.int(3, 40));
    const ids = [
      L.add(spend(card.id, date, m.lo * 100, m))?.id,
      L.add(spend(card.id, date, m.lo * 100, m))?.id,
    ];
    L.traps.push({
      type: "duplicate_charge",
      rows: ids.filter((x): x is string => !!x),
      note: `two at ${m.descriptor}`,
    });
  }
  if (P.orders && pp.chance(0.5)) {
    const date = addDays(asOf, -pp.int(3, 40));
    const cents = pp.cents(12, 60);
    const code = () =>
      Array.from({ length: 9 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[pp.int(0, 33)]).join("");
    const order = {
      descriptor: `${P.orders.prefix}${code()}`,
      category: P.orders.category,
      lo: 0,
      hi: 0,
    };
    const ids = [
      L.add(spend(card.id, date, cents, order))?.id,
      L.add(spend(card.id, date, cents, { ...order, descriptor: `${P.orders.prefix}${code()}` }))
        ?.id,
    ];
    L.traps.push({
      type: "duplicate_charge",
      rows: ids.filter((x): x is string => !!x),
      note: "two orders",
    });
  }

  // Two plans billed together, on one card on one day every month: two subscriptions and two
  // bills, never "Charged twice?" (upload QA), from their own dice too.
  const t2 = rng(base + index * 104_729 + 29);
  if (t2.chance(0.35)) {
    const day = t2.int(2, 27);
    const [a, b]: string[][] = [[], []];
    L.monthly(day, (date) => {
      const first = L.add(spend(card.id, date, P.twin.cents, P.twin));
      const second = L.add(spend(card.id, date, P.twin.cents, P.twin));
      if (first && second) {
        a.push(first.id);
        b.push(second.id);
      }
    });
    for (const rows of [a, b]) {
      L.findings.push({
        type: "subscription_review",
        rows,
        annualCents: P.twin.cents * 12,
        note: `${P.twin.descriptor}, one of two`,
      });
      L.bill(rows, P.twin.descriptor);
    }
    L.traps.push({
      type: "duplicate_charge",
      rows: [...a, ...b],
      note: `${P.twin.descriptor}, two plans`,
    });
  }

  // Two plans from one service at two prices, each on its own day every month: two
  // subscriptions and two bills (QA round 30), from their own dice.
  const t3 = rng(base + index * 104_729 + 30);
  if (t3.chance(0.35)) {
    const pp = P.pricePlans;
    pp.cents.forEach((cents, k) => {
      const rows: string[] = [];
      L.monthly(t3.int(2, 27), (date) => {
        const row = L.add(spend(card.id, date, cents, pp));
        if (row) rows.push(row.id);
      });
      L.findings.push({
        type: "subscription_review",
        rows,
        annualCents: cents * 12,
        note: `${pp.descriptor} plan ${k + 1}`,
      });
      L.bill(rows, `${pp.descriptor} plan ${k + 1}`);
    });
  }

  // Idle cash: a saver keeps months of spending in checking.
  L.rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.id.slice(a.id.indexOf("-r") + 2)) - Number(b.id.slice(b.id.indexOf("-r") + 2)),
  );
  // Fees and card interest from a short history are worth a year at their pace (#853): over the
  // months the person's data covers, from their first transaction on any account, as the dock
  // and the report count them (src/detection/rules/fee-totals.ts).
  const days = daysBetween(L.rows[0]!.date, asOf);
  if (days < SHORT_HISTORY_DAYS) {
    const months = Math.min(LOOKBACK_MONTHS, Math.max(1, Math.round(days / DAYS_PER_MONTH)));
    for (const f of L.findings.filter(
      (x) => x.type === "card_interest" || x.type === "bank_fees",
    )) {
      f.annualCents = Math.round((f.annualCents! * MONTHS_PER_YEAR) / months);
    }
  }
  const balanceOf = (a: CsvAccount) =>
    a.openingCents -
    L.rows.filter((x) => x.account === a.id).reduce((s, x) => s + x.amountCents, 0);
  // Idle cash, as Jane defines it (docs/accuracy.md): checking and savings above three months
  // of spending, by at least $1,000.
  const cash = balanceOf(checking) + (savings ? balanceOf(savings) : 0);
  const spent = L.rows
    .filter((x) => x.kind === "spending" && x.amountCents > 0)
    .reduce((s, x) => s + x.amountCents, 0);
  const span = (toDate(asOf).getTime() - toDate(start).getTime()) / DAY / 30.44;
  const excess = cash - 3 * (spent / span);
  if (excess >= 100_000) {
    L.findings.push({
      type: "idle_cash",
      annualCents: null,
      note: `cash ${cash}, excess ${Math.round(excess)}`,
    });
  }

  return {
    id,
    archetype,
    asOf,
    months,
    start,
    accounts,
    rows: L.rows,
    truth: {
      findings: L.findings,
      traps: L.traps,
      neutral: L.neutral,
      bills: L.bills,
      neutralBills: L.neutralBills,
    },
  };
}

export function generateCsvPeople(count = CSV_PEOPLE_COUNT, set: CsvSet = "tuning"): CsvPerson[] {
  return Array.from({ length: count }, (_, i) => person(i, set));
}

// An account's balance at the end of a day: checking and savings hold money, a card is owed.
export function balanceOn(p: CsvPerson, account: CsvAccount, date: string): number {
  const moved = p.rows
    .filter((x) => x.account === account.id && x.date <= date)
    .reduce((s, x) => s + x.amountCents, 0);
  return account.kind === "credit_card"
    ? account.openingCents + moved
    : account.openingCents - moved;
}

export function netWorthOn(p: CsvPerson, date: string): number {
  return p.accounts.reduce(
    (s, a) => s + (a.kind === "credit_card" ? -1 : 1) * balanceOn(p, a, date),
    0,
  );
}

// The month-end net worth line: each month's last day in the history, then today.
export function monthEnds(p: CsvPerson): string[] {
  const out: string[] = [];
  for (let d = addMonths(p.start, 1, 1); d <= p.asOf; d = addMonths(d, 1, 1))
    out.push(addDays(d, -1));
  return [...out, p.asOf];
}
