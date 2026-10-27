import type { PfcDetailed, PfcPrimary } from "@/categorize/taxonomy";
import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import type { AccountKind } from "@/data-sources/types";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, daysBetween } from "@/detection/units";

// The CSV accuracy bench's people (2026-10-27): 20 synthetic people, each with 3 to 6 months of
// true transactions on 2 or 3 accounts and the truth for everything Jane should say about them.
// ./render.ts writes each account as its bank exports it (./layouts.ts), mess and all; ./score.ts
// runs the upload path on those files and scores it against this truth. Nothing here is a real
// person or a real account. A fixed seed makes the same people every time.

export const CSV_SEED = 20_261_027;
export const CSV_AS_OF = "2026-10-24";
export const CSV_PEOPLE_COUNT = 20;
export const CSV_HELD_OUT_SEED = 61_803_398;
export type CsvSet = "tuning" | "held-out";

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
  category: PfcDetailed;
  cents: number;
  rise?: number;
  // Software and news have no category of their own: any of these is right.
  alsoOk?: PfcPrimary[];
};
const DIGITAL: PfcPrimary[] = ["GENERAL_SERVICES", "GENERAL_MERCHANDISE", "ENTERTAINMENT"];
const SUBSCRIPTIONS: Sub[] = [
  { descriptor: "NETFLIX.COM", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1549, rise: 1799 },
  { descriptor: "SPOTIFY USA", category: "ENTERTAINMENT_MUSIC_AND_AUDIO", cents: 1199, rise: 1299 },
  { descriptor: "HULU 877-8244858", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 1799 },
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
    { descriptor: "SLING TV", category: "ENTERTAINMENT_TV_AND_MOVIES", cents: 4000, rise: 4500 },
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

function person(index: number, set: CsvSet = "tuning"): CsvPerson {
  const r = rng((set === "tuning" ? CSV_SEED : CSV_HELD_OUT_SEED) + index * 104_729);
  const id = `${set === "tuning" ? "c" : "d"}${String(index + 1).padStart(2, "0")}`;
  const P = set === "tuning" ? TUNING : HELD_OUT;
  const archetype = ARCHETYPES[index % ARCHETYPES.length];
  const months = 3 + (index % 4);
  const asOf = CSV_AS_OF;
  const start = addMonths(asOf, -months, 1);
  const L = new Ledger(id, start, asOf);
  // The held-out set banks elsewhere: the same plans, shifted.
  const plan = PLANS[set === "tuning" ? index : (index + 7) % PLANS.length];

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
  const landlord = r.pick(P.landlords);
  L.monthly(1, (date) =>
    L.add(
      zelleRent
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
    ),
  );

  // Bills: power moves with the season, internet and phone are fixed, water every 3 months.
  const power = r.pick(P.power);
  const powerBase = r.cents(45, 120);
  const powerDay = r.int(8, 20);
  L.monthly(powerDay, (date) => {
    const month = Number(date.slice(5, 7));
    const season = month >= 6 && month <= 9 ? 1.6 : 1;
    L.add({
      account: chk,
      date,
      amountCents: Math.round(powerBase * season * (0.85 + r.next() * 0.3)),
      descriptor: power,
      category: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
      kind: "spending",
      flow: "ach_out",
    });
  });
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
  if (r.chance(0.5)) {
    const water = r.cents(60, 140);
    let date = addMonths(start, r.int(0, 2), 18);
    for (; date <= asOf; date = addMonths(date, 3, 18)) {
      L.add({
        account: chk,
        date,
        amountCents: water + r.int(-1500, 1500),
        descriptor: P.water,
        category: "RENT_AND_UTILITIES_WATER",
        kind: "spending",
        flow: "ach_out",
      });
    }
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
    const rows: string[] = [];
    const before: number[] = [];
    L.monthly(day, (date, i) => {
      const cents = i >= riseAt ? sub.rise! : sub.cents;
      const row = L.add(spend(onCard, date, cents, sub));
      if (row) {
        rows.push(row.id);
        if (i < riseAt) before.push(cents);
      }
    });
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
    }
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
    L.monthly(r.int(25, 28), (date) =>
      fee(chk, date, 1200, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    );
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
  const cardFees: { id: string; cents: number; account: string }[] = [];
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
      L.add({
        account: chk,
        date: due,
        amountCents: paid,
        descriptor: "card_payment",
        category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        alsoOk: ["TRANSFER_OUT"],
        kind: "moving",
        flow: "card_payment_out",
      });
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
    truth: { findings: L.findings, traps: L.traps, neutral: L.neutral },
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
