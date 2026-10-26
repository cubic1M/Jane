import { addDays } from "@/lib/dates";
import type { RawRow } from "./generate";

// The accuracy bench's life (founder, 2026-10-26): kids, a pet, school, where they live, a car,
// the commute, travel, the gym, how they eat, a side gig, health costs, a move, a new baby. Each
// person gets a mix of these from the generator's own dice (a separate stream, so adding them
// never changes the other detectors' people), with the rows a real bank export would show and
// the decoys that must not count (a toy bought as a gift, one pet-shop trip, an online course, a
// single yoga class, two trips). The truth is what the generator decided, never what a detector
// said. src/accuracy/score.ts scores src/profile/life-facts.ts against it.

export type LifeLabels = {
  kids: boolean;
  newBaby: boolean;
  pet: boolean;
  student: boolean;
  housing: "own" | "rent";
  car: boolean;
  work: "commuter" | "remote" | "other";
  travels: boolean;
  gym: boolean;
  eating: "cooks" | "eats_out" | "mixed";
  sideGig: boolean;
  healthCosts: boolean;
  moved: boolean;
};

export type Dice = {
  next: () => number;
  chance: (p: number) => boolean;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  cents: (lo: number, hi: number) => number;
};

// What the builder offers: add a row, mark a bill or subscription as true, and the person's facts.
export type Sink = {
  add: (row: Omit<RawRow, "id">) => RawRow;
  bill: (description: string) => void;
  subscription: (description: string) => void;
  income: (rowId: string) => void;
  start: string;
  asOf: string;
  months: number;
  archetype: string;
  account: string;
  hasCar: boolean;
  hasLandlord: boolean;
  hasGymSubscription: boolean;
  // The food rows the generator already wrote, by description.
  food: { grocer: string; coffee: string; restaurants: readonly string[] };
  rows: () => readonly RawRow[];
};

const debit = { bankType: "DEBIT_CARD" } as const;
const apart = (a: string, b: string) =>
  Math.abs(Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
const daysApart = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

// Probabilities of children by kind of person.
const KIDS_P: Record<string, number> = {
  salaried: 0.35,
  hourly: 0.3,
  struggling: 0.3,
  saver: 0.15,
  freelancer: 0.2,
  retiree: 0.05,
};
const EMPLOYED = ["salaried", "hourly", "saver", "struggling"];

export function addLife(r: Dice, s: Sink): LifeLabels {
  const labels: LifeLabels = {
    kids: false,
    newBaby: false,
    pet: false,
    student: false,
    housing: s.hasLandlord ? "rent" : "own",
    car: s.hasCar,
    work: "other",
    travels: false,
    gym: s.hasGymSubscription,
    eating: "mixed",
    sideGig: false,
    healthCosts: false,
    moved: false,
  };
  const spend = (date: string, description: string, cents: number) =>
    s.add({ accountId: s.account, date, amountCents: cents, description, ...debit });
  // A random day in the history, or in the last `days` days of it.
  const anyDay = () => addDays(s.start, r.int(0, daysApart(s.start, s.asOf)));
  const lateDay = (days: number) =>
    addDays(s.asOf, -r.int(0, Math.min(days, daysApart(s.start, s.asOf))));
  const scatter = (n: number, make: (date: string) => void, from?: string) => {
    for (let i = 0; i < n; i += 1) make(from ? lateDayFrom(from) : anyDay());
  };
  const lateDayFrom = (from: string) => addDays(from, r.int(0, daysApart(from, s.asOf)));

  // --- Children ---------------------------------------------------------------------------
  const kidsRoll = r.chance(KIDS_P[s.archetype] ?? 0.2);
  const babyRoll = kidsRoll && s.months >= 4 && r.chance(0.4);
  if (babyRoll) {
    // A new baby: baby goods lately, nothing for children before.
    labels.kids = true;
    labels.newBaby = true;
    const from = addDays(s.asOf, -Math.min(100, s.months * 28));
    scatter(
      r.int(5, 9),
      (d) =>
        spend(
          d,
          r.pick([
            "BUYBUY BABY #0412",
            "TARGET BABY DEPT 0023",
            "HUGGIES DIAPERS AMZN Mktp US*2K4L",
            "ENFAMIL FORMULA WALGREENS",
          ]),
          r.cents(18, 120),
        ),
      from,
    );
    scatter(1, (d) => spend(d, "PEDIATRIC ASSOCIATES COPAY", r.cents(25, 60)), from);
  } else if (kidsRoll) {
    labels.kids = true;
    if (r.chance(0.5)) {
      // Childcare: the same monthly bill.
      const care = r.pick([
        "BRIGHT HORIZONS 4455 CHILD CARE",
        "LITTLE SPROUTS DAYCARE",
        "KINDERCARE LEARNING CTR 0881",
      ]);
      const cents = r.cents(700, 1800);
      const day = r.int(2, 8);
      for (let date = addDays(s.start, 0); date <= s.asOf; date = addDays(date, 30)) {
        spend(addDays(date, day % 5), care, cents);
      }
      s.bill(care);
    } else {
      // School age: lunch money and fees across months, the pediatrician, kids' clothes.
      const months = Math.max(2, s.months);
      scatter(months * 2, (d) => spend(d, "RIVERDALE SCHOOL DISTRICT LUNCH ACCT", r.cents(15, 55)));
      scatter(Math.ceil(months / 3), (d) =>
        spend(d, "SUNNYSIDE PEDIATRICS COPAY", r.cents(25, 70)),
      );
      scatter(Math.ceil(months / 2), (d) =>
        spend(
          d,
          r.pick([
            "CARTER S 0231",
            "OSHKOSH B GOSH 4410",
            "CHILDREN S PLACE #1177",
            "TARGET KIDS 0023",
          ]),
          r.cents(25, 140),
        ),
      );
    }
  } else if (r.chance(0.15)) {
    // Not a parent: a toy or two as a gift. Must not count.
    scatter(r.int(1, 2), (d) =>
      spend(d, r.pick(["LEGO STORE 0041", "TOYS R US EXPRESS 008"]), r.cents(25, 90)),
    );
  }

  // --- A pet ------------------------------------------------------------------------------
  if (r.chance(0.3)) {
    labels.pet = true;
    scatter(Math.max(3, Math.round(s.months * 0.9)), (d) =>
      spend(d, "CHEWY.COM 800-672-4399 FL", r.cents(38, 95)),
    );
    scatter(r.int(1, 3), (d) =>
      spend(
        d,
        r.pick(["RIVERSIDE ANIMAL HOSPITAL", "BLUE RIDGE VETERINARY CLINIC"]),
        r.cents(80, 400),
      ),
    );
    if (r.chance(0.4)) scatter(r.int(1, 3), (d) => spend(d, "PETSMART #1234", r.cents(15, 70)));
  } else if (r.chance(0.12)) {
    // A pet-shop gift, once.
    spend(anyDay(), "PETCO 1881", r.cents(15, 60));
  }

  // --- School -----------------------------------------------------------------------------
  if (r.chance(s.archetype === "struggling" || s.archetype === "hourly" ? 0.15 : 0.06)) {
    labels.student = true;
    scatter(Math.max(1, Math.round(s.months / 4)), (d) =>
      spend(d, "STATE UNIVERSITY BURSAR PAYMENT", r.cents(1800, 5200)),
    );
    scatter(Math.max(3, Math.round(s.months * 0.8)), (d) =>
      spend(d, "STATE UNIV BOOKSTORE #2", r.cents(12, 160)),
    );
    scatter(r.int(1, 3), (d) => spend(d, "CAMPUS DINING MEAL PLAN", r.cents(150, 600)));
  } else if (r.chance(0.15)) {
    // An online course is not a student: one purchase.
    spend(anyDay(), r.pick(["SKILLSHARE.COM", "COURSERA.ORG", "UDEMY, INC."]), r.cents(12, 60));
  }

  // --- Where they live --------------------------------------------------------------------
  if (labels.housing === "own") {
    // Property tax in spring and autumn; dues monthly for half.
    for (const month of ["04-10", "10-10"]) {
      for (const year of [2025, 2026]) {
        const date = `${year}-${month}`;
        if (date >= s.start && date <= s.asOf)
          spend(date, "COUNTY TAX COLLECTOR PROPERTY TAX", r.cents(900, 2400));
      }
    }
    if (r.chance(0.5)) {
      const hoa = "MAPLE GROVE HOA DUES";
      const cents = r.cents(90, 320);
      for (let date = addDays(s.start, 3); date <= s.asOf; date = addDays(date, 30))
        spend(date, hoa, cents);
      s.bill(hoa);
    }
  }

  // --- The commute ------------------------------------------------------------------------
  if (EMPLOYED.includes(s.archetype)) {
    if (r.chance(0.3)) {
      labels.work = "commuter";
      for (let date = s.start; date <= s.asOf; date = addDays(date, 1)) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday >= 1 && weekday <= 5 && r.chance(0.7))
          spend(date, "MTA*NYCT PAYGO", 290 + r.int(0, 1) * 290);
      }
      if (r.chance(0.4))
        scatter(Math.round(s.months * 1.5), (d) =>
          spend(d, "SP PLUS PARKING 5521", r.cents(8, 24)),
        );
    } else if (!s.hasCar) {
      // No car and no transit: works from home.
      labels.work = "remote";
    }
  }

  // --- Travel -----------------------------------------------------------------------------
  const trips = r.chance(0.25) && s.months >= 6 ? r.int(3, 5) : r.chance(0.2) ? r.int(1, 2) : 0;
  labels.travels = trips >= 3;
  const tripDays: string[] = [];
  for (let i = 0; i < trips; i += 1) {
    let day = anyDay();
    // Trips at least ten days apart.
    for (let tries = 0; tries < 20 && tripDays.some((d) => apart(d, day) < 10); tries += 1) {
      day = anyDay();
    }
    tripDays.push(day);
    spend(
      day,
      r.pick(["DELTA AIR 0062388174455", "UNITED AIRLINES 0162345", "SOUTHWEST AIR 5262"]),
      r.cents(160, 520),
    );
    const stay = addDays(day, r.int(0, 2));
    if (stay <= s.asOf)
      spend(
        stay,
        r.pick(["MARRIOTT HOTELS 5521", "AIRBNB * HM4R2K", "HILTON GARDEN INN"]),
        r.cents(220, 900),
      );
  }

  // --- The gym ----------------------------------------------------------------------------
  // Memberships come from the subscriptions the generator already wrote (Planet Fitness,
  // Peloton), so the subscription detector's people stay the same.
  if (!labels.gym && r.chance(0.1)) {
    // One class is not a gym.
    spend(anyDay(), "YOGA WORKS STUDIO", r.cents(18, 30));
  }

  // --- A side gig -------------------------------------------------------------------------
  if (EMPLOYED.includes(s.archetype) && r.chance(0.22)) {
    labels.sideGig = true;
    scatter(Math.max(3, Math.round(s.months * 0.9)), (d) => {
      const row = s.add({
        accountId: s.account,
        date: d,
        amountCents: -r.cents(40, 400),
        description: r.pick(["ETSY INC DEPOSIT", "EBAY PAYOUT 8821"]),
        bankType: "ACH_CREDIT",
      });
      if (row.id) s.income(row.id);
    });
  }

  // --- Health costs: a cost, never a diagnosis --------------------------------------------
  if (s.months >= 4 && r.chance(0.15)) {
    labels.healthCosts = true;
    scatter(Math.max(8, s.months * 2), (d) =>
      spend(
        d,
        r.pick([
          "RIVERSIDE FAMILY MEDICINE",
          "PHYSICAL THERAPY ASSOC",
          "QUEST DIAGNOSTICS",
          "ORTHOPEDIC SPECIALISTS",
        ]),
        r.cents(90, 320),
      ),
    );
  } else if (r.chance(0.2)) {
    spend(anyDay(), "BRIGHT SMILE DENTAL", r.cents(80, 220));
  }

  // --- A move -----------------------------------------------------------------------------
  if (s.months >= 3 && r.chance(0.13)) {
    labels.moved = true;
    const day = lateDay(40);
    spend(day, "U-HAUL MOVING & STORAGE 0047", r.cents(90, 360));
    const bought = addDays(day, -r.int(0, 8));
    spend(bought < s.start ? day : bought, "IKEA 0042 FURNITURE", r.cents(520, 1400));
  } else if (r.chance(0.06)) {
    // A truck for a friend's move: one sign is not a move.
    spend(anyDay(), "U-HAUL MOVING & STORAGE 0047", r.cents(60, 120));
  }

  // --- How they eat -----------------------------------------------------------------------
  // Steer with extra food rows, then decide the truth from the rows the generator wrote.
  const intent = r.pick(["cooks", "cooks", "mixed", "eats_out", "eats_out"] as const);
  if (intent === "cooks") {
    scatter(Math.round(s.months * 5), (d) =>
      s.add({
        accountId: s.account,
        date: d,
        amountCents: r.cents(60, 150),
        description: s.food.grocer,
        ...debit,
      }),
    );
  } else if (intent === "eats_out") {
    scatter(Math.round(s.months * 14), (d) =>
      s.add({
        accountId: s.account,
        date: d,
        amountCents: r.cents(18, 60),
        description: r.pick(s.food.restaurants),
        ...debit,
      }),
    );
  }
  let groceries = 0;
  let out = 0;
  for (const row of s.rows()) {
    if (row.amountCents <= 0) continue;
    if (row.description === s.food.grocer) groceries += row.amountCents;
    else if (row.description === s.food.coffee || s.food.restaurants.includes(row.description))
      out += row.amountCents;
  }
  const share = out / Math.max(1, groceries + out);
  labels.eating = share >= 0.6 ? "eats_out" : share <= 0.35 ? "cooks" : "mixed";
  return labels;
}
