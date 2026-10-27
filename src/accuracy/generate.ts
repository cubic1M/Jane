import { normalizeMerchant } from "@/data-sources/merchant";
import { addLife, type LifeLabels } from "./life";

// The accuracy bench's people (founder, 2026-10-26: "build Jane's accuracy test bench"): 40
// synthetic bank histories, made the way real exports look (the messy-bank person's lessons:
// card payments written by the card company, transfers to savings and to oneself, reversed
// fees, processor prefixes, uneven pay, overlapping noise), each with the ground truth for every
// detector. A fixed seed makes the same people every time; scripts write them to
// src/accuracy/__fixtures__/histories.json, which is what the bench and its CI gate read.
//
// Two sets (docs/accuracy.md). The tuning set is what the detectors' rules were fixed on:
// #766's 40 people, unchanged, and 20 more who carry each known cause of a miss or a false
// alarm. The held-out set is 40 people from another seed, with the same causes under names the
// tuning set never uses (other card companies, ticket sellers, utilities, yearly plans), and
// is only scored, never tuned on, so a gain that holds there is real. A second held-out set,
// with names neither of the others uses, is kept for checking fixes the first one's mistakes
// suggested: once a set's mistakes have been read, it is no longer a clean check.

export const SEED = 20261026;
export const PEOPLE_COUNT = 60;
// The first ORIGINAL_COUNT tuning people are #766's, row for row; the rest add the causes.
export const ORIGINAL_COUNT = 40;
export const HELD_OUT_SEED = 77_031_337;
export const HELD_OUT_COUNT = 40;
export const HELD_OUT_2_SEED = 90_210_455;
export const HELD_OUT_3_SEED = 31_415_927;
export const AS_OF = "2026-10-21";

export type BenchSet = "tuning" | "held-out" | "held-out-2" | "held-out-3";

export type RawRow = {
  id: string;
  accountId: string;
  date: string;
  // Plaid's sign: positive is money out of the account.
  amountCents: number;
  description: string;
  // What the bank's own export says (a card's category, a checking row's type).
  bankCategory?: string;
  bankType?: string;
};

export type HistoryAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string;
  balanceCents: number;
};

// The truth for every detector. Merchants are normalizeMerchant keys; rows are row ids.
export type Labels = {
  subscriptions: string[];
  priceRises: string[];
  feeAccounts: string[];
  duplicates: string[];
  idleCash: boolean;
  interestAccounts: string[];
  bills: string[];
  income: string[];
  transfers: string[];
  // What their life is like (./life.ts): the truth for the profile's life facts.
  life: LifeLabels;
};

export type History = {
  id: string;
  set: BenchSet;
  archetype: Archetype;
  asOf: string;
  months: number;
  accounts: HistoryAccount[];
  rows: RawRow[];
  labels: Labels;
};

export type Archetype = "salaried" | "hourly" | "freelancer" | "retiree" | "struggling" | "saver";
const ARCHETYPES: readonly Archetype[] = [
  "salaried",
  "hourly",
  "freelancer",
  "retiree",
  "struggling",
  "saver",
];

// mulberry32: small, fast and the same everywhere.
function rng(seed: number) {
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
type Rng = ReturnType<typeof rng>;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(toDate(date).getTime() + n * DAY));
function addMonths(date: string, n: number, day?: number): string {
  const d = toDate(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day ?? d.getUTCDate(), last));
  return iso(target);
}
const keyOf = (description: string) => normalizeMerchant(description)?.key ?? description;

const SUBSCRIPTIONS = [
  { description: "NETFLIX.COM", cents: 1549 },
  { description: "PAYPAL *NETFLIX 402-935-7733 CA", cents: 1799 },
  { description: "SPOTIFY USA", cents: 1199 },
  { description: "HULU 877-8244858 CA", cents: 799 },
  { description: "DISNEY PLUS 888-905-7888", cents: 1399 },
  { description: "PLANET FITNESS 800-1234567 NH", cents: 2499 },
  { description: "ADOBE *CREATIVE CLD 408-536-6000", cents: 2299 },
  { description: "DROPBOX*7GH2K4", cents: 1199 },
  { description: "NYTIMES*NYTDIGITAL", cents: 400 },
  { description: "AUDIBLE*2K94LM", cents: 1495 },
  { description: "PELOTON* MEMBERSHIP", cents: 4400 },
  { description: "DUOLINGO PLUS", cents: 1299 },
] as const;
const EMPLOYERS = ["ACME CORP", "NORTHWIND LLC", "GLOBEX INC", "INITECH", "UMBRELLA HEALTH"];
const LANDLORDS = ["RIVERSIDE PROPERTY MGMT RENT", "OAK PARK PROPERTY MANAGEMENT", "BILT RENT"];
const CARD_PAYMENT_OUT = [
  "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
  "AMEX EPAYMENT ACH PMT W4562",
  "CAPITAL ONE ONLINE PMT 9F2K",
  "DISCOVER E-PAYMENT 7731",
  "CITI AUTOPAY PAYMENT 4410",
  // A card company the keyword rules don't know: real exports have them.
  "BARCLAYCARD US PAYMENT 0041",
];
// Where the everyday spending eats out (also read by ./life.ts for how someone eats).
const RESTAURANTS = [
  "TST* SHAKE SHACK 1234",
  "SQ *TACO STAND 88",
  "CHIPOTLE 2210",
  "DOORDASH*DASHPASS ORDER",
] as const;
const SHOPS = [
  { description: "BEST BUY 00012345", category: "Shopping", lo: 40, hi: 300 },
  { description: "TARGET 00023456", category: "Shopping", lo: 15, hi: 120 },
  { description: "HOME DEPOT #6612", category: "Home", lo: 20, hi: 250 },
  { description: "CVS/PHARMACY #04321", category: "Health & Wellness", lo: 10, hi: 60 },
  { description: "AMZN Mktp US*2K4L91Z3", category: "Shopping", lo: 12, hi: 90 },
];

// The causes, under the names each set uses. A fix that works by knowing a name can't pass the
// held-out set.
type Plan = { description: string; cents: number };
type OneOff = { description: string; category: string; lo: number; hi: number };
const CAUSES: Record<
  BenchSet,
  {
    // Card companies no keyword rule knows.
    unknownIssuers: string[];
    // Places where two of the same price, bought together, is normal: a seat each.
    perSeat: { description: string; category: string }[];
    // Usage bills from utilities whose names say so, but not in the keyword list by name.
    utilities: string[];
    // Plans paid once a year.
    yearly: Plan[];
    // App stores that bill several subscriptions as one merchant.
    platforms: string[];
    // One-off purchases at merchants that also sell subscriptions.
    oneOffs: OneOff[];
    // Where real double charges happen.
    shops: (typeof SHOPS)[number][];
  }
> = {
  tuning: {
    unknownIssuers: [
      "BARCLAYCARD US PAYMENT 0041",
      "FNBO CARD PMT 2231",
      "ELAN FINANCIAL SVC PYMT",
    ],
    perSeat: [
      { description: "TICKETMASTER 800-653-8000", category: "Entertainment" },
      { description: "LIVE NATION TICKETS 8001", category: "Entertainment" },
      { description: "DELTA AIR 0062312345678", category: "Travel" },
    ],
    utilities: [
      "XCEL ENERGY-PSCO PPD ID: 8840011",
      "SEATTLE CITY LIGHT UTILITIES",
      "SOUTHERN CALIFORNIA EDISON",
    ],
    yearly: [
      { description: "AMAZON PRIME*2K4AB7XY0", cents: 13_900 },
      { description: "DUOLINGO PLUS", cents: 8_399 },
      { description: "DROPBOX*7GH2K4", cents: 11_988 },
    ],
    platforms: ["APPLE.COM/BILL 866-712-7753 CA"],
    oneOffs: [
      { description: "AUDIBLE*2K94LM", category: "Entertainment", lo: 8, hi: 30 },
      { description: "AMAZON PRIME VIDEO*2K4AB", category: "Entertainment", lo: 3, hi: 7 },
      { description: "APPLE.COM/BILL 866-712-7753 CA", category: "Shopping", lo: 1, hi: 20 },
    ],
    shops: SHOPS,
  },
  "held-out": {
    unknownIssuers: ["GS BANK USA PAYMENT 7710", "NAVY FEDERAL CU PMT", "TD BANK CARD PYMT 0918"],
    perSeat: [
      { description: "STUBHUB 866-788-2482", category: "Entertainment" },
      { description: "SEATGEEK* TICKETS", category: "Entertainment" },
      { description: "AMC THEATRES 2201", category: "Entertainment" },
      { description: "UNITED AIRLINES 0162345678901", category: "Travel" },
    ],
    utilities: [
      "DOMINION ENERGY PPD ID: 3301",
      "GEORGIA POWER CO",
      "CITY OF AUSTIN UTILITIES",
      "PSE&G PAYMENT",
    ],
    yearly: [
      { description: "ADOBE *CREATIVE CLD 408-536-6000", cents: 23_988 },
      { description: "NYTIMES*NYTDIGITAL", cents: 19_500 },
      { description: "AUDIBLE*2K94LM", cents: 14_950 },
    ],
    platforms: ["APPLE.COM/BILL 866-712-7753 CA", "GOOGLE *GOOGLE PLAY APPS"],
    oneOffs: [
      { description: "PRIME VIDEO*2K4AB", category: "Entertainment", lo: 3, hi: 7 },
      { description: "GOOGLE *GOOGLE PLAY APPS", category: "Shopping", lo: 1, hi: 20 },
      { description: "ADOBE STOCK 408-536-6000", category: "Shopping", lo: 30, hi: 90 },
    ],
    shops: [
      { description: "WALGREENS #1234", category: "Health & Wellness", lo: 15, hi: 70 },
      { description: "LOWE'S #1188", category: "Home", lo: 25, hi: 300 },
      { description: "COSTCO WHSE #0123", category: "Shopping", lo: 40, hi: 250 },
    ],
  },
  "held-out-2": {
    unknownIssuers: ["MERRICK BANK PYMT 2201", "PENFED CARD PAYMENT", "FIRST PREMIER BANKCARD PMT"],
    perSeat: [
      { description: "VIVID SEATS 866-848-8499", category: "Entertainment" },
      { description: "HARKINS THEATRES 0412", category: "Entertainment" },
      { description: "SOUTHWEST AIR 5262123456789", category: "Travel" },
    ],
    utilities: [
      "ENTERGY ARKANSAS PPD ID: 7710",
      "ALABAMA POWER BILL PAY",
      "FPL DIRECT DEBIT",
      "PUGET SOUND ENERGY",
    ],
    yearly: [
      { description: "MICROSOFT*MICROSOFT 365 P", cents: 9_999 },
      { description: "AMAZON PRIME*8H2LK1QZ0", cents: 13_900 },
      { description: "DROPBOX*K2L9QX", cents: 11_988 },
    ],
    platforms: ["APPLE.COM/BILL 866-712-7753 CA", "ITUNES.COM/BILL"],
    oneOffs: [
      { description: "AUDIBLE*7KL2QX", category: "Entertainment", lo: 8, hi: 30 },
      { description: "APPLE.COM/BILL 866-712-7753 CA", category: "Shopping", lo: 1, hi: 60 },
      { description: "PELOTON* APPAREL", category: "Shopping", lo: 60, hi: 120 },
    ],
    shops: [
      { description: "KOHLS #0912", category: "Shopping", lo: 20, hi: 150 },
      { description: "WALMART.COM 8009256278", category: "Shopping", lo: 15, hi: 200 },
      { description: "PETSMART #1123", category: "Shopping", lo: 15, hi: 120 },
    ],
  },
  // Made (2026-10-27) before any fix for the second held-out set's misses was written, and
  // scored only: the clean check for those fixes.
  "held-out-3": {
    unknownIssuers: ["SYNCHRONY BANK PAYMENT", "USAA CREDIT CARD PMT 4471", "BREAD FINANCIAL PYMT"],
    perSeat: [
      { description: "EVENTBRITE*SPRING GALA", category: "Entertainment" },
      { description: "REGAL CINEMAS 0921", category: "Entertainment" },
      { description: "JETBLUE 2792112345678", category: "Travel" },
    ],
    utilities: [
      "DUKE ENERGY PAYMENT",
      "AMEREN ILLINOIS UTILITY PMT",
      "NATIONAL GRID ELECTRIC",
      "EVERSOURCE ENERGY",
    ],
    yearly: [
      { description: "MSFT * MICROSOFT 365 FAMILY", cents: 12_999 },
      { description: "LINKEDIN PREMIUM", cents: 23_988 },
      { description: "PATREON* MEMBERSHIP", cents: 6_000 },
    ],
    platforms: ["APPLE.COM/BILL 866-712-7753 CA", "GOOGLE *GOOGLE PLAY APPS"],
    oneOffs: [
      { description: "NYTIMES*STORE", category: "Shopping", lo: 50, hi: 150 },
      { description: "DUOLINGO*MERCH SHOP", category: "Shopping", lo: 50, hi: 90 },
      { description: "APPLE.COM/BILL 866-712-7753 CA", category: "Shopping", lo: 1, hi: 60 },
    ],
    shops: [
      { description: "MARSHALLS #0441", category: "Shopping", lo: 20, hi: 150 },
      { description: "ACE HARDWARE #1207", category: "Home", lo: 10, hi: 120 },
      { description: "ULTA BEAUTY #331", category: "Health & Wellness", lo: 15, hi: 90 },
    ],
  },
};

class Builder {
  rows: RawRow[] = [];
  labels: Labels = {
    subscriptions: [],
    priceRises: [],
    feeAccounts: [],
    duplicates: [],
    idleCash: false,
    interestAccounts: [],
    bills: [],
    income: [],
    transfers: [],
    life: undefined as unknown as LifeLabels,
  };
  private n = 0;
  constructor(
    readonly id: string,
    readonly start: string,
    readonly asOf: string,
  ) {}
  add(row: Omit<RawRow, "id">): RawRow {
    if (row.date < this.start || row.date > this.asOf) return { ...row, id: "" };
    const full = { ...row, id: `${this.id}-t${(this.n += 1)}` };
    this.rows.push(full);
    return full;
  }
  // Every month on the given day, from the first one inside the history.
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
  daily(make: (date: string, weekday: number) => void) {
    for (let date = this.start; date <= this.asOf; date = addDays(date, 1)) {
      make(date, toDate(date).getUTCDay());
    }
  }
  // A bill keeps coming: due again within the next month.
  bill(description: string) {
    const key = keyOf(description);
    if (!this.labels.bills.includes(key)) this.labels.bills.push(key);
  }
  // A yearly plan is a bill only when it renews within the next month.
  renewal(paid: string, description: string) {
    if (addMonths(paid, 12) <= addDays(this.asOf, 31)) this.bill(description);
  }
}

function person(index: number, set: BenchSet = "tuning"): History {
  const base = {
    tuning: SEED,
    "held-out": HELD_OUT_SEED,
    "held-out-2": HELD_OUT_2_SEED,
    "held-out-3": HELD_OUT_3_SEED,
  }[set];
  const seed = base + index * 7919;
  const r: Rng = rng(seed);
  // The causes draw from their own stream, so #766's people stay row for row.
  const x: Rng = rng(seed ^ 0x5eed);
  const causes = set !== "tuning" || index >= ORIGINAL_COUNT ? CAUSES[set] : null;
  const archetype = ARCHETYPES[index % ARCHETYPES.length];
  const drawnMonths = r.pick([2, 3, 4, 6, 8, 12, 12, 14]);
  // Short histories: two charges of everything.
  const months = causes && x.chance(0.25) ? 2 : drawnMonths;
  const id = `${{ tuning: "p", "held-out": "h", "held-out-2": "k", "held-out-3": "m" }[set]}${String(index + 1).padStart(2, "0")}`;
  const start = addMonths(AS_OF, -months);
  const b = new Builder(id, start, AS_OF);
  const chk = `${id}-chk`;
  const sav = r.chance(archetype === "saver" ? 1 : 0.7) ? `${id}-sav` : null;
  const card = r.chance(0.8) ? `${id}-card` : null;
  const spendOn = card ?? chk;
  const onCard = (category: string) =>
    spendOn === card ? { bankCategory: category } : { bankType: "DEBIT_CARD" };
  let monthlySpendCents = 0;

  // --- Income -------------------------------------------------------------------------
  const employer = r.pick(EMPLOYERS);
  if (archetype === "salaried" || archetype === "saver" || archetype === "struggling") {
    const base = r.cents(
      archetype === "struggling" ? 900 : 1800,
      archetype === "saver" ? 4200 : 3200,
    );
    const steady = r.chance(0.6);
    b.every(14, addDays(start, r.int(0, 13)), (date) => {
      const amount = steady ? base : Math.round(base * (0.9 + r.next() * 0.2));
      const row = b.add({
        accountId: chk,
        date,
        amountCents: -amount,
        description: `${employer} PAYROLL PPD ID: 9876543210`,
        bankType: "ACH_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
  }
  if (archetype === "hourly") {
    b.every(14, addDays(start, r.int(0, 13)), (date) => {
      const row = b.add({
        accountId: chk,
        date,
        amountCents: -r.cents(700, 1900),
        description: `${employer} DIR DEP PPD ID: 4455667788`,
        bankType: "ACH_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
  }
  if (archetype === "freelancer") {
    b.daily((date) => {
      if (!r.chance(0.09)) return;
      const source = r.pick([
        "STRIPE TRANSFER ST-K3J9Q2 PPD ID: 4270465600",
        "UPWORK ESCROW INC 8810",
        "SHOPIFY PAYOUT 2210",
      ]);
      const row = b.add({
        accountId: chk,
        date,
        amountCents: -r.cents(250, 2400),
        description: source,
        bankType: "ACH_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
  }
  if (archetype === "retiree") {
    b.monthly(3, (date) => {
      const row = b.add({
        accountId: chk,
        date,
        amountCents: -r.cents(1800, 2600),
        description: "SSA TREAS 310 XXSOC SEC",
        bankType: "ACH_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
    b.monthly(1, (date) => {
      const row = b.add({
        accountId: chk,
        date,
        amountCents: -r.cents(600, 1400),
        description: "STATE TEACHERS RETIREMENT SYS PENSION",
        bankType: "ACH_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
  }
  if (sav) {
    b.monthly(28, (date) => {
      const row = b.add({
        accountId: sav,
        date,
        amountCents: -r.int(5, 900),
        description: "INTEREST PAYMENT",
        bankType: "MISC_CREDIT",
      });
      if (row.id) b.labels.income.push(row.id);
    });
  }

  // --- Housing and bills --------------------------------------------------------------
  let hasLandlord = false;
  if (archetype !== "retiree" || r.chance(0.4)) {
    hasLandlord = true;
    const landlord = r.pick(LANDLORDS);
    const rent = r.cents(900, 2600);
    b.monthly(1, (date) =>
      b.add({
        accountId: chk,
        date,
        amountCents: rent,
        description: `${landlord} PPD ID: 5550001`,
        bankType: "ACH_DEBIT",
      }),
    );
    b.bill(`${landlord} PPD ID: 5550001`);
    monthlySpendCents += rent;
  }
  const phone = r.pick([
    "VERIZON WIRELESS PAYMENTS PPD ID: 1223344556",
    "T-MOBILE AUTO PAY 8800",
    "AT&T MOBILITY ONLINE PMT",
  ]);
  const phoneCents = r.cents(45, 140);
  b.monthly(r.int(5, 20), (date) =>
    b.add({
      accountId: chk,
      date,
      amountCents: phoneCents,
      description: phone,
      bankType: "ACH_DEBIT",
    }),
  );
  b.bill(phone);
  monthlySpendCents += phoneCents;
  // Usage bills move with the season: still bills, never price rises.
  const drawnPower = r.pick([
    "PG&E WEB ONLINE PPD ID: 9471234567",
    "CON ED OF NY INTELL CK",
    "DUKE ENERGY PAYMENT",
  ]);
  const power = causes && x.chance(0.5) ? x.pick(causes.utilities) : drawnPower;
  // A seasonal bill: twice as much at the height of winter as in spring and autumn.
  const seasonal = (date: string) =>
    1 + 0.6 * Math.cos(((toDate(date).getUTCMonth() + 1) * Math.PI) / 6);
  b.monthly(r.int(8, 18), (date) => {
    const cents = r.cents(60, 190);
    b.add({
      accountId: chk,
      date,
      amountCents: causes ? Math.round(9_000 * seasonal(date) * (0.85 + x.next() * 0.3)) : cents,
      description: power,
      bankType: "ACH_DEBIT",
    });
  });
  b.bill(power);
  monthlySpendCents += 12_000;
  const hasCar = r.chance(0.6);
  if (hasCar) {
    const insurance = r.cents(90, 210);
    b.monthly(r.int(2, 26), (date) =>
      b.add({
        accountId: chk,
        date,
        amountCents: insurance,
        description: "GEICO *AUTO 800-841-3000 DC",
        bankType: "ACH_DEBIT",
      }),
    );
    b.bill("GEICO *AUTO 800-841-3000 DC");
    monthlySpendCents += insurance;
  }

  // --- Subscriptions ------------------------------------------------------------------
  const count = r.int(0, archetype === "struggling" ? 5 : 4);
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(r.int(0, SUBSCRIPTIONS.length - 1));
  // Only one Netflix.
  if (chosen.has(0) && chosen.has(1)) chosen.delete(1);
  const riseFor = r.chance(0.35) ? [...chosen][r.int(0, Math.max(0, chosen.size - 1))] : -1;
  for (const s of chosen) {
    const sub = SUBSCRIPTIONS[s];
    const day = r.int(1, 28);
    // One in five was cancelled a few months ago: no longer a subscription they pay for.
    const cancelledAt = months >= 6 && r.chance(0.2) ? addMonths(AS_OF, -r.int(3, 4)) : null;
    const charges: string[] = [];
    b.monthly(day, (date) => {
      if (cancelledAt && date > cancelledAt) return;
      charges.push(date);
    });
    const rises = s === riseFor && charges.length >= 4 && !cancelledAt ? r.int(1, 2) : 0;
    const higher = Math.round(sub.cents * (1.1 + r.next() * 0.15));
    charges.forEach((date, i) => {
      const amount = i >= charges.length - rises ? higher : sub.cents;
      b.add({
        accountId: spendOn,
        date,
        amountCents: amount,
        description: sub.description,
        ...onCard("Entertainment"),
      });
    });
    if (cancelledAt || charges.length === 0) continue;
    b.labels.subscriptions.push(keyOf(sub.description));
    b.bill(sub.description);
    if (rises > 0) b.labels.priceRises.push(keyOf(sub.description));
    monthlySpendCents += sub.cents;
  }
  // Apple bills every subscription bought through it as one merchant, at mixed amounts.
  if (r.chance(0.25)) {
    const amounts = [99, r.pick([299, 1099, 1499])];
    amounts.forEach((cents, i) =>
      b.monthly(5 + i * 9, (date) =>
        b.add({
          accountId: spendOn,
          date,
          amountCents: cents,
          description: "APPLE.COM/BILL 866-712-7753 CA",
          ...onCard("Shopping"),
        }),
      ),
    );
    b.labels.subscriptions.push(keyOf("APPLE.COM/BILL 866-712-7753 CA"));
    b.bill("APPLE.COM/BILL 866-712-7753 CA");
  }
  // A yearly one: seen once (or twice in a long history). Paid before the history starts, the
  // data can't show it, so it isn't in the truth either.
  if (r.chance(0.3)) {
    const renews = addMonths(AS_OF, -r.int(1, 11), r.int(1, 28));
    const paid = b.add({
      accountId: spendOn,
      date: renews,
      amountCents: 13_900,
      description: "AMAZON PRIME*2K4AB7XY0",
      ...onCard("Shopping"),
    });
    b.add({
      accountId: spendOn,
      date: addMonths(renews, -12),
      amountCents: 13_900,
      description: "AMAZON PRIME*2K4AB7XY0",
      ...onCard("Shopping"),
    });
    if (paid.id) {
      b.labels.subscriptions.push(keyOf("AMAZON PRIME*2K4AB7XY0"));
      b.renewal(renews, "AMAZON PRIME*2K4AB7XY0");
    }
  }
  if (causes) {
    // Several subscriptions billed through one app store, each at its own price and day.
    if (x.chance(0.5)) {
      const platform = x.pick(causes.platforms);
      const prices = [99, 299, 999, 1099, 1499, 1999];
      const picked = new Set<number>();
      for (let n = x.int(1, 3); picked.size < n;) picked.add(x.pick(prices));
      [...picked].forEach((cents, i) =>
        b.monthly(3 + i * 8, (date) =>
          b.add({
            accountId: spendOn,
            date,
            amountCents: cents,
            description: platform,
            ...onCard("Shopping"),
          }),
        ),
      );
      if (!b.labels.subscriptions.includes(keyOf(platform)))
        b.labels.subscriptions.push(keyOf(platform));
      b.bill(platform);
    }
    // A yearly plan, paid once in the last year.
    if (x.chance(0.5)) {
      const plan = x.pick(causes.yearly);
      const key = keyOf(plan.description);
      const renews = addMonths(AS_OF, -x.int(1, 11), x.int(1, 28));
      if (!b.labels.subscriptions.includes(key)) {
        const paid = b.add({
          accountId: spendOn,
          date: renews,
          amountCents: plan.cents,
          description: plan.description,
          ...onCard("Entertainment"),
        });
        if (paid.id) {
          b.labels.subscriptions.push(key);
          b.renewal(renews, plan.description);
        }
      }
    }
    // One-off purchases where subscriptions are also sold: a book, a rental, an app.
    if (x.chance(0.6)) {
      for (let n = x.int(1, 3); n > 0; n -= 1) {
        const buy = x.pick(causes.oneOffs);
        b.add({
          accountId: spendOn,
          date: addDays(AS_OF, -x.int(1, months * 28)),
          amountCents: x.cents(buy.lo, buy.hi),
          description: buy.description,
          ...onCard(buy.category),
        });
      }
    }
    // A short history: two purchases at one shop a month apart, at nearly the same price.
    if (months <= 3 && x.chance(0.6)) {
      const shop = x.pick(causes.shops);
      const cents = x.cents(Math.max(20, shop.lo), shop.hi);
      const first = addDays(AS_OF, -x.int(35, 50));
      b.add({
        accountId: spendOn,
        date: first,
        amountCents: cents,
        description: shop.description,
        ...onCard(shop.category),
      });
      b.add({
        accountId: spendOn,
        date: addDays(first, x.int(28, 32)),
        amountCents: Math.round(cents * (0.96 + x.next() * 0.08)),
        description: shop.description,
        ...onCard(shop.category),
      });
    }
  }

  // --- Everyday spending: regular, but never subscriptions ------------------------------
  const grocer = r.pick(["WHOLEFDS MKT 10234", "SAFEWAY #1820", "TRADER JOE S #552"]);
  const coffee = r.pick(["SQ *JOES COFFEE 4421", "STARBUCKS STORE 09912", "TST* BLUE DOOR CAFE"]);
  const coffeeDays = r.pick([[1, 3, 5], [1, 2, 3, 4, 5], [6]]);
  const coffeePrice = r.cents(3.5, 6.5);
  b.daily((date, weekday) => {
    if (weekday === 6 && r.chance(0.9)) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: r.cents(45, 160),
        description: grocer,
        ...onCard("Groceries"),
      });
    }
    if (coffeeDays.includes(weekday) && r.chance(0.85)) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: coffeePrice + r.pick([0, 0, 50, 75]),
        description: coffee,
        ...onCard("Food & Drink"),
      });
    }
    if (r.chance(0.12)) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: r.cents(14, 85),
        description: r.pick(RESTAURANTS),
        ...onCard("Food & Drink"),
      });
    }
    if (hasCar && r.chance(0.08)) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: r.cents(30, 70),
        description: "SHELL OIL 57444",
        ...onCard("Gas"),
      });
    }
    if (r.chance(0.07)) {
      const shop = r.pick(SHOPS);
      b.add({
        accountId: spendOn,
        date,
        amountCents: r.cents(shop.lo, shop.hi),
        description: shop.description,
        ...onCard(shop.category),
      });
    }
    if (r.chance(0.05)) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: r.cents(9, 45),
        description: "UBER *TRIP HELP.UBER.COM",
        ...onCard("Travel"),
      });
    }
  });
  monthlySpendCents += 4 * 9_000 + 15 * 500 + 4 * 4_000;
  // A return, and a big one-off purchase.
  if (r.chance(0.5)) {
    const date = addDays(AS_OF, -r.int(5, months * 28));
    const amount = r.cents(20, 80);
    b.add({
      accountId: spendOn,
      date,
      amountCents: amount,
      description: "AMZN Mktp US*2K4L91Z3",
      ...onCard("Shopping"),
    });
    b.add({
      accountId: spendOn,
      date: addDays(date, r.int(3, 10)),
      amountCents: -amount,
      description: "AMZN Mktp US*2K4L91Z3",
      ...(spendOn === card
        ? { bankCategory: "Shopping", bankType: "Return" }
        : { bankType: "DEBIT_CARD" }),
    });
  }
  if (r.chance(0.3)) {
    b.add({
      accountId: spendOn,
      date: addDays(AS_OF, -r.int(5, months * 28)),
      amountCents: r.cents(800, 2200),
      description: "BEST BUY 00012345",
      ...onCard("Shopping"),
    });
  }

  // --- Double charges, and look-alikes that aren't --------------------------------------
  if (r.chance(0.3)) {
    const shop = r.pick(SHOPS);
    const date = addDays(AS_OF, -r.int(3, 45));
    const amount = r.cents(Math.max(15, shop.lo), shop.hi);
    b.add({
      accountId: spendOn,
      date,
      amountCents: amount,
      description: shop.description,
      ...onCard(shop.category),
    });
    const second = b.add({
      accountId: spendOn,
      date: addDays(date, r.int(0, 1)),
      amountCents: amount,
      description: shop.description,
      ...onCard(shop.category),
    });
    if (second.id) b.labels.duplicates.push(second.id);
  }
  if (r.chance(0.12)) {
    // Two tickets, bought one after the other: the same amount twice, and not a mistake.
    const date = addDays(AS_OF, -r.int(3, 40));
    const amount = r.cents(45, 140);
    for (let i = 0; i < 2; i += 1) {
      b.add({
        accountId: spendOn,
        date,
        amountCents: amount,
        description: "TICKETMASTER 800-653-8000",
        ...onCard("Entertainment"),
      });
    }
  }
  if (r.chance(0.2)) {
    // Charged twice and already refunded: nothing to do.
    const date = addDays(AS_OF, -r.int(10, 40));
    const amount = r.cents(25, 120);
    const target = { accountId: spendOn, description: "TARGET 00023456", ...onCard("Shopping") };
    b.add({ ...target, date, amountCents: amount });
    b.add({ ...target, date, amountCents: amount });
    b.add({ ...target, date: addDays(date, 4), amountCents: -amount });
  }
  if (causes) {
    // A seat each: two tickets or two fares, the same price on the same day.
    if (x.chance(0.4)) {
      const seat = x.pick(causes.perSeat);
      const date = addDays(AS_OF, -x.int(3, 40));
      const amount = x.cents(25, 400);
      for (let i = x.int(2, 3); i > 0; i -= 1) {
        b.add({
          accountId: spendOn,
          date,
          amountCents: amount,
          description: seat.description,
          ...onCard(seat.category),
        });
      }
    }
    // A real double charge, and one the shop already gave back.
    if (x.chance(0.4)) {
      const shop = x.pick(causes.shops);
      const date = addDays(AS_OF, -x.int(3, 45));
      const amount = x.cents(Math.max(15, shop.lo), shop.hi);
      const row = { accountId: spendOn, description: shop.description, ...onCard(shop.category) };
      b.add({ ...row, date, amountCents: amount });
      const second = b.add({ ...row, date: addDays(date, x.int(0, 1)), amountCents: amount });
      if (second.id) b.labels.duplicates.push(second.id);
    }
    if (x.chance(0.3)) {
      const shop = x.pick(causes.shops);
      const date = addDays(AS_OF, -x.int(10, 40));
      const amount = x.cents(Math.max(15, shop.lo), shop.hi);
      const row = { accountId: spendOn, description: shop.description, ...onCard(shop.category) };
      b.add({ ...row, date, amountCents: amount });
      b.add({ ...row, date, amountCents: amount });
      b.add({ ...row, date: addDays(date, x.int(2, 6)), amountCents: -amount });
    }
  }

  // --- Card: payments from checking, interest, fees -------------------------------------
  const debt = archetype === "struggling" || (archetype === "hourly" && r.chance(0.5));
  if (card) {
    const drawnPayOut = r.pick(CARD_PAYMENT_OUT);
    const payOut = causes && x.chance(0.5) ? x.pick(causes.unknownIssuers) : drawnPayOut;
    b.monthly(r.int(20, 27), (date) => {
      const spent = b.rows
        .filter(
          (t) =>
            t.accountId === card &&
            t.amountCents > 0 &&
            t.date < date &&
            t.date >= addMonths(date, -1),
        )
        .reduce((s, t) => s + t.amountCents, 0);
      if (spent <= 0) return;
      const amount = debt ? Math.max(3_500, Math.round(spent * 0.1)) : spent;
      const out = b.add({
        accountId: chk,
        date,
        amountCents: amount,
        description: payOut,
        bankType: "ACH_DEBIT",
      });
      const back = b.add({
        accountId: card,
        // The card company can post the payment a day or two after checking does.
        date: causes ? addDays(date, x.int(0, 2)) : date,
        amountCents: -amount,
        description: r.pick(["Payment Thank You-Mobile", "AUTOMATIC PAYMENT - THANK YOU"]),
        bankType: "Payment",
      });
      for (const row of [out, back]) if (row.id) b.labels.transfers.push(row.id);
    });
    // "Coming up" calls any card payment "Credit card payment".
    b.bill("Credit card payment");
    if (debt) {
      b.monthly(r.int(10, 18), (date) =>
        b.add({
          accountId: card,
          date,
          amountCents: r.cents(25, 95),
          description: "PURCHASE INTEREST CHARGE",
          bankCategory: "Fees & Adjustments",
          bankType: "Fee",
        }),
      );
      b.labels.interestAccounts.push(card);
    }
    if (r.chance(0.2)) {
      const date = addDays(AS_OF, -r.int(10, months * 28));
      b.add({
        accountId: card,
        date,
        amountCents: r.cents(30, 90),
        description: "CAFE DE FLORE PARIS FR",
        bankCategory: "Food & Drink",
      });
      b.add({
        accountId: card,
        date,
        amountCents: r.cents(1, 3),
        description: "FOREIGN TRANSACTION FEE",
        bankCategory: "Fees & Adjustments",
        bankType: "Fee",
      });
      b.labels.feeAccounts.push(card);
    }
  }
  // Overdrafts, some given back.
  if (archetype === "struggling" || r.chance(0.15)) {
    let kept = false;
    for (let i = r.int(1, 4); i > 0; i -= 1) {
      const date = addDays(AS_OF, -r.int(2, months * 28));
      b.add({
        accountId: chk,
        date,
        amountCents: 3_400,
        description: "OVERDRAFT FEE",
        bankType: "FEE_TRANSACTION",
      });
      if (r.chance(0.4)) {
        b.add({
          accountId: chk,
          date: addDays(date, r.int(1, 5)),
          amountCents: -3_400,
          description: "OVERDRAFT FEE REVERSAL",
          bankType: "REFUND_TRANSACTION",
        });
      } else kept = true;
    }
    if (kept) b.labels.feeAccounts.push(chk);
  }
  if (r.chance(0.15)) {
    b.monthly(r.int(1, 28), (date) =>
      b.add({
        accountId: chk,
        date,
        amountCents: 1_200,
        description: "MONTHLY SERVICE FEE",
        bankType: "FEE_TRANSACTION",
      }),
    );
    if (!b.labels.feeAccounts.includes(chk)) b.labels.feeAccounts.push(chk);
    // Taken every month, so it's coming up like any bill.
    b.bill("MONTHLY SERVICE FEE");
  }

  // --- Moving one's own money -----------------------------------------------------------
  if (sav) {
    const amount = r.cents(100, archetype === "saver" ? 1500 : 400);
    b.monthly(r.int(2, 12), (date, i) => {
      const n = `${index}${i}23456`;
      const out = b.add({
        accountId: chk,
        date,
        amountCents: amount,
        description: `Online Transfer to SAV ...4521 transaction#: ${n}`,
        bankType: "ACCT_XFER",
      });
      const into = b.add({
        accountId: sav,
        date,
        amountCents: -amount,
        description: `Online Transfer from CHK ...9012 transaction#: ${n}`,
        bankType: "ACCT_XFER",
      });
      for (const row of [out, into]) if (row.id) b.labels.transfers.push(row.id);
    });
  }
  if (r.chance(0.4)) {
    b.daily((date) => {
      if (!r.chance(0.02)) return;
      const row = r.chance(0.5)
        ? b.add({
            accountId: chk,
            date,
            amountCents: -r.cents(40, 300),
            description: "VENMO CASHOUT PPD ID: 5264681992",
            bankType: "ACH_CREDIT",
          })
        : b.add({
            accountId: chk,
            date,
            amountCents: r.cents(100, 500),
            description: "Zelle payment to Self JPM99B7K2QX",
            bankType: "QUICKPAY_DEBIT",
          });
      if (row.id) b.labels.transfers.push(row.id);
    });
  }

  // --- Their life: kids, a pet, school, the commute, travel, the gym, how they eat ---------
  // A separate dice stream, so none of the other detectors' people change.
  b.labels.life = addLife(rng(base + index * 104729 + 17), {
    add: (row) => b.add(row),
    bill: (description) => b.bill(description),
    subscription: (description) => {
      const key = keyOf(description);
      if (!b.labels.subscriptions.includes(key)) b.labels.subscriptions.push(key);
    },
    income: (rowId) => b.labels.income.push(rowId),
    start,
    asOf: AS_OF,
    months,
    archetype,
    account: chk,
    hasCar,
    hasLandlord,
    hasGymSubscription: b.rows.some((row) => /PLANET FITNESS|PELOTON/i.test(row.description)),
    food: { grocer, coffee, restaurants: RESTAURANTS },
    rows: () => b.rows,
  });

  // --- Balances: idle cash for savers, a thin cushion for others -------------------------
  const months_ = monthlySpendCents;
  const liquid =
    archetype === "saver"
      ? months_ * r.int(9, 14)
      : archetype === "struggling"
        ? r.cents(20, 400)
        : Math.round(months_ * (0.3 + r.next() * 1.4));
  b.labels.idleCash = archetype === "saver";
  const accounts: HistoryAccount[] = [
    {
      id: chk,
      name: "Checking",
      type: "depository",
      subtype: "checking",
      balanceCents: sav ? Math.round(liquid * 0.3) : liquid,
    },
  ];
  if (sav)
    accounts.push({
      id: sav,
      name: "Savings",
      type: "depository",
      subtype: "savings",
      balanceCents: liquid - Math.round(liquid * 0.3),
    });
  if (card)
    accounts.push({
      id: card,
      name: "Credit card",
      type: "credit",
      subtype: "credit card",
      balanceCents: debt ? r.cents(1500, 9000) : r.cents(200, 1500),
    });

  b.rows.sort((a, c) => a.date.localeCompare(c.date) || a.id.localeCompare(c.id));
  return { id, set, archetype, asOf: AS_OF, months, accounts, rows: b.rows, labels: b.labels };
}

export function generateHistories(count = PEOPLE_COUNT): History[] {
  return Array.from({ length: count }, (_, i) => person(i));
}

export function generateHeldOut(count = HELD_OUT_COUNT, set: BenchSet = "held-out"): History[] {
  return Array.from({ length: count }, (_, i) => person(i, set));
}

// The checked-in form (src/accuracy/__fixtures__/histories.json): each row as a tuple, which
// keeps the file about half the size of keyed rows.
type RowTuple = [string, string, string, number, string, string?, string?];
export type FixtureHistory = Omit<History, "rows"> & { rows: RowTuple[] };

export const toFixture = (histories: readonly History[]): FixtureHistory[] =>
  histories.map((h) => ({
    ...h,
    rows: h.rows.map((r) => {
      const tuple: RowTuple = [r.id, r.accountId, r.date, r.amountCents, r.description];
      if (r.bankCategory || r.bankType) tuple.push(r.bankCategory ?? "", r.bankType ?? "");
      return tuple;
    }),
  }));

export const fromFixture = (fixture: readonly FixtureHistory[]): History[] =>
  fixture.map((h) => ({
    ...h,
    rows: h.rows.map(([id, accountId, date, amountCents, description, bankCategory, bankType]) => ({
      id,
      accountId,
      date,
      amountCents,
      description,
      ...(bankCategory ? { bankCategory } : {}),
      ...(bankType ? { bankType } : {}),
    })),
  }));
