import {
  COMMUTE_SIGNAL,
  COOKS_SHARE,
  DELIVERY_WORDS,
  EATING_OUT_CATEGORIES,
  EATS_OUT_SHARE,
  FITNESS_SIGNAL,
  FOOD_MIN_PAYMENTS,
  GROCERY_CATEGORIES,
  HEALTH_COST_EXCLUDED,
  HEALTH_COST_MIN_MONTHS,
  HEALTH_COST_MIN_PAYMENTS,
  HEALTH_COST_MONTHLY_CENTS,
  KIDS_SEEN_FAMILIES,
  KIDS_SIGNALS,
  KIDS_SIGNAL_WORDS,
  OWNER_SEEN_MATCHES,
  OWNER_SIGNAL,
  PET_SEEN_MATCHES,
  PET_SIGNAL,
  REMOTE_MAX_GAS_PER_MONTH,
  REMOTE_MIN_MONTHS,
  SIDE_GIG_SIGNAL,
  STUDENT_CAMPUS_WORDS,
  STUDENT_SEEN_CAMPUS_MATCHES,
  STUDENT_SIGNAL,
  TRAVEL_SIGNAL,
  TRIPS_FOR_FREQUENT,
  TRIP_GAP_DAYS,
  type Signal,
} from "@/config/life-facts";
import { addDays } from "@/lib/dates";
import type { Source } from "./confidence";

// What a person's payments say about their life (founder, 2026-10-26): kids, a pet, school, a
// car, the commute, travel, the gym, how they eat, a side gig, health costs, a recent move or a
// new baby. Pure: payments in, readings out; src/profile/build.ts turns each into a fact with
// its confidence (from the evidence) and its source. Thresholds and word lists are in
// src/config/life-facts.ts. Never read: health conditions, religion, politics, sexuality,
// immigration status (health spending is only a cost category).

export type LifeTx = { date: string; amountCents: number; description: string; pfc: string | null };

// One fact's reading: its value, whether it was seen or guessed, and the evidence in words
// ("6 childcare and school payments") to show beside the percentage.
export type Reading = {
  value: boolean | string;
  source: Source;
  what: string;
  matches: number;
};

type Hits = { matches: number; months: number; txs: LifeTx[] };

const monthOf = (day: string) => day.slice(0, 7);

// The payments that match a signal: money out whose PFC category or payee words fit (or, for
// income signals, money in).
export function hitsOf(txs: readonly LifeTx[], signal: Signal, direction: "out" | "in" = "out") {
  const found = txs.filter(
    (t) =>
      (direction === "out" ? t.amountCents > 0 : t.amountCents < 0) &&
      ((signal.categories ?? []).includes(t.pfc ?? "") ||
        (signal.words?.test(t.description.toUpperCase()) ?? false)),
  );
  return {
    matches: found.length,
    months: new Set(found.map((t) => monthOf(t.date))).size,
    txs: found,
  } satisfies Hits;
}
export const meets = (h: Hits, s: Signal) => h.matches >= s.minMatches && h.months >= s.minMonths;

const list = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

// --- Children -----------------------------------------------------------------------------
export function kidsReading(txs: readonly LifeTx[]): Reading {
  const fired = (Object.keys(KIDS_SIGNALS) as (keyof typeof KIDS_SIGNALS)[])
    .map((key) => ({ key, hits: hitsOf(txs, KIDS_SIGNALS[key]) }))
    .filter(({ key, hits }) => meets(hits, KIDS_SIGNALS[key]));
  if (fired.length === 0) {
    return {
      value: false,
      source: "guessed",
      what: "childcare, school or kids' payments",
      matches: 0,
    };
  }
  const matches = fired.reduce((s, f) => s + f.hits.matches, 0);
  const childcare = fired.some((f) => f.key === "childcare");
  return {
    value: true,
    // Childcare is the surest sign; otherwise it takes two different kinds to be seen.
    source: childcare || fired.length >= KIDS_SEEN_FAMILIES ? "seen" : "guessed",
    what: `${list(fired.map((f) => KIDS_SIGNAL_WORDS[f.key]))} payments`,
    matches,
  };
}

// --- Pets ---------------------------------------------------------------------------------
export function petReading(txs: readonly LifeTx[]): Reading {
  const h = hitsOf(txs, PET_SIGNAL);
  if (!meets(h, PET_SIGNAL)) {
    return { value: false, source: "guessed", what: "pet purchases", matches: h.matches };
  }
  return {
    value: true,
    source: h.matches >= PET_SEEN_MATCHES && h.months >= 2 ? "seen" : "guessed",
    what: "vet visits and pet purchases",
    matches: h.matches,
  };
}

// --- School -------------------------------------------------------------------------------
export function studentReading(txs: readonly LifeTx[]): Reading {
  const h = hitsOf(txs, STUDENT_SIGNAL);
  if (!meets(h, STUDENT_SIGNAL)) {
    return {
      value: false,
      source: "guessed",
      what: "tuition or campus payments",
      matches: h.matches,
    };
  }
  const campus = h.txs.filter((t) => STUDENT_CAMPUS_WORDS.test(t.description.toUpperCase()));
  const months = new Set(campus.map((t) => monthOf(t.date))).size;
  return {
    value: true,
    // A parent can pay tuition; shopping the campus across months is a student.
    source: campus.length >= STUDENT_SEEN_CAMPUS_MATCHES && months >= 2 ? "seen" : "guessed",
    what: "tuition and campus payments",
    matches: h.matches,
  };
}

// --- Home ---------------------------------------------------------------------------------
// Dues and property tax: a homeowner's bills beside (or without) a mortgage.
export function ownerBills(txs: readonly LifeTx[]): {
  met: boolean;
  seen: boolean;
  matches: number;
} {
  const h = hitsOf(txs, OWNER_SIGNAL);
  const met = meets(h, OWNER_SIGNAL);
  return { met, seen: met && h.matches >= OWNER_SEEN_MATCHES, matches: h.matches };
}

// --- Getting about ------------------------------------------------------------------------
export function commuteReading(
  txs: readonly LifeTx[],
  months: number,
  salaried: boolean,
): Reading | null {
  const h = hitsOf(txs, COMMUTE_SIGNAL);
  if (meets(h, COMMUTE_SIGNAL)) {
    return {
      value: "commuter",
      source: "seen",
      what: "transit, parking and toll payments",
      matches: h.matches,
    };
  }
  // Remote is a guess from an absence: a salary and no commute payments at all.
  const fillUps = txs.filter((t) => t.amountCents > 0 && t.pfc === "TRANSPORTATION_GAS").length;
  if (
    salaried &&
    months >= REMOTE_MIN_MONTHS &&
    h.matches === 0 &&
    fillUps <= REMOTE_MAX_GAS_PER_MONTH * months
  ) {
    return { value: "remote", source: "guessed", what: "commute payments", matches: 0 };
  }
  return null;
}

export function travelReading(txs: readonly LifeTx[]): Reading {
  const h = hitsOf(txs, TRAVEL_SIGNAL);
  const days = h.txs.map((t) => t.date).sort();
  let trips = 0;
  let last: string | null = null;
  for (const day of days) {
    if (last === null || day > addDays(last, TRIP_GAP_DAYS)) trips += 1;
    last = day;
  }
  return {
    value: trips >= TRIPS_FOR_FREQUENT,
    source: trips >= TRIPS_FOR_FREQUENT ? "seen" : "guessed",
    what: "trips",
    matches: trips,
  };
}

export function fitnessReading(txs: readonly LifeTx[]): Reading {
  const h = hitsOf(txs, FITNESS_SIGNAL);
  const yes = meets(h, FITNESS_SIGNAL);
  return {
    value: yes,
    source: yes ? "seen" : "guessed",
    what: "gym and fitness payments",
    matches: h.matches,
  };
}

// --- Food ---------------------------------------------------------------------------------
export function eatingReading(txs: readonly LifeTx[]): Reading | null {
  let groceries = 0;
  let out = 0;
  let payments = 0;
  for (const t of txs) {
    if (t.amountCents <= 0) continue;
    if ((GROCERY_CATEGORIES as readonly string[]).includes(t.pfc ?? "")) {
      groceries += t.amountCents;
      payments += 1;
    } else if (
      (EATING_OUT_CATEGORIES as readonly string[]).includes(t.pfc ?? "") ||
      DELIVERY_WORDS.test(t.description.toUpperCase())
    ) {
      out += t.amountCents;
      payments += 1;
    }
  }
  if (payments < FOOD_MIN_PAYMENTS || groceries + out === 0) return null;
  const share = out / (groceries + out);
  const value = share >= EATS_OUT_SHARE ? "eats_out" : share <= COOKS_SHARE ? "cooks" : "mixed";
  return {
    value,
    source: "seen",
    what: "grocery, restaurant and delivery payments",
    matches: payments,
  };
}

// --- Income and health costs --------------------------------------------------------------
export function sideGigReading(txs: readonly LifeTx[], salaried: boolean): Reading {
  const h = hitsOf(txs, SIDE_GIG_SIGNAL, "in");
  const yes = salaried && meets(h, SIDE_GIG_SIGNAL);
  return {
    value: yes,
    source: yes ? "seen" : "guessed",
    what: "gig and freelance deposits",
    matches: salaried ? h.matches : 0,
  };
}

export function healthCostReading(txs: readonly LifeTx[], months: number): Reading {
  const medical = txs.filter(
    (t) =>
      t.amountCents > 0 &&
      (t.pfc ?? "").startsWith("MEDICAL_") &&
      !(HEALTH_COST_EXCLUDED as readonly string[]).includes(t.pfc ?? ""),
  );
  const total = medical.reduce((s, t) => s + t.amountCents, 0);
  const monthsSeen = new Set(medical.map((t) => monthOf(t.date))).size;
  const yes =
    months > 0 &&
    medical.length >= HEALTH_COST_MIN_PAYMENTS &&
    monthsSeen >= HEALTH_COST_MIN_MONTHS &&
    total / months >= HEALTH_COST_MONTHLY_CENTS;
  return {
    value: yes,
    source: yes ? "seen" : "guessed",
    what: "health-care payments",
    matches: medical.length,
  };
}
