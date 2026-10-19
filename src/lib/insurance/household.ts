import {
  GAP_KEYS,
  HOUSING,
  MAX_HOUSEHOLD_COUNT,
  RENT_CATEGORY,
  RENT_LOOKBACK_DAYS,
  INCOME_CATEGORY,
  INCOME_LOOKBACK_DAYS,
  MEDICAL_LOOKBACK_DAYS,
  TRAVEL_LOOKBACK_DAYS,
  type GapKey,
  type Housing,
} from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The household facts that matter for cover (spec step 102): whether the person owns or
// rents, and how many cars, dependants and pets. What they typed wins; until they do,
// housing and cars are read from their accounts, and said to be.

type Options = { client?: PrismaClient; now?: Date };

export class HouseholdFactsError extends Error {}

export const isHousing = (v: unknown): v is Housing =>
  typeof v === "string" && Object.hasOwn(HOUSING, v);

// One fact and where it came from: typed by the person, read from their accounts, or not
// known.
export type Fact<T> = { value: T | null; from: "you" | "accounts" | null };

export type Household = {
  housing: Fact<Housing>;
  vehicles: Fact<number>;
  dependants: Fact<number>;
  pets: Fact<number>;
  dismissedGaps: GapKey[];
  // Spec step 149: what the accounts say about income, what there is to protect, recent
  // trips and care.
  signals: Signals;
};

export type Signals = {
  // A paycheck in the last INCOME_LOOKBACK_DAYS.
  paycheck: boolean;
  // Cash and investments plus the things they own, by their values; null with no balances.
  assetsCents: number | null;
  // Flights and hotels in the last TRAVEL_LOOKBACK_DAYS.
  travelCents: number;
  // Medical spending in the last MEDICAL_LOOKBACK_DAYS; null when there are no transactions.
  medicalCents: number | null;
};

// What the accounts say, for the facts not typed.
export type AccountSigns = {
  mortgage: boolean;
  homeOwned: boolean;
  rentPaid: boolean;
  cars: number;
} & Partial<Signals>;

const typed = <T>(value: T | null): Fact<T> => ({ value, from: value === null ? null : "you" });

// Pure: the typed facts, with the accounts filling the gaps.
export function resolveHousehold(
  saved: {
    housing: string | null;
    vehicles: number | null;
    dependants: number | null;
    pets: number | null;
    dismissedGaps: string[];
  } | null,
  signs: AccountSigns,
): Household {
  const housing: Fact<Housing> = isHousing(saved?.housing)
    ? typed(saved.housing)
    : signs.mortgage || signs.homeOwned
      ? { value: "own", from: "accounts" }
      : signs.rentPaid
        ? { value: "rent", from: "accounts" }
        : { value: null, from: null };
  const vehicles: Fact<number> =
    saved?.vehicles != null
      ? typed(saved.vehicles)
      : signs.cars > 0
        ? { value: signs.cars, from: "accounts" }
        : { value: null, from: null };
  return {
    housing,
    vehicles,
    dependants: typed(saved?.dependants ?? null),
    pets: typed(saved?.pets ?? null),
    dismissedGaps: (saved?.dismissedGaps ?? []).filter((g): g is GapKey =>
      (GAP_KEYS as readonly string[]).includes(g),
    ),
    signals: {
      paycheck: signs.paycheck ?? false,
      assetsCents: signs.assetsCents ?? null,
      travelCents: signs.travelCents ?? 0,
      medicalCents: signs.medicalCents ?? null,
    },
  };
}

export async function loadHousehold(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Household> {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - RENT_LOOKBACK_DAYS * 86_400_000);
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [saved, loans, owned, rent, paychecks, balances, travel, medical, anyTransactions] =
    await Promise.all([
      db.insuranceProfiles.findFirst({
        select: {
          housing: true,
          vehicles: true,
          dependants: true,
          pets: true,
          dismissedGaps: true,
        },
      }),
      db.accounts.findMany({ where: { type: "loan" }, select: { id: true, subtype: true } }),
      db.ownedAssets.findMany({ select: { kind: true, loanAccountId: true, valueCents: true } }),
      db.transactions.count({
        where: { pfcDetailed: RENT_CATEGORY, date: { gte: since }, amountCents: { gt: 0 } },
      }),
      // Spec step 149.
      db.transactions.count({
        where: {
          pfcDetailed: INCOME_CATEGORY,
          date: { gte: days(INCOME_LOOKBACK_DAYS) },
          amountCents: { lt: 0 },
        },
      }),
      db.accounts.findMany({
        where: { type: { in: ["depository", "investment"] } },
        select: { currentBalanceCents: true },
      }),
      db.transactions.aggregate({
        where: {
          pfcPrimary: "TRAVEL",
          date: { gte: days(TRAVEL_LOOKBACK_DAYS) },
          amountCents: { gt: 0 },
        },
        _sum: { amountCents: true },
      }),
      db.transactions.aggregate({
        where: {
          pfcPrimary: "MEDICAL",
          date: { gte: days(MEDICAL_LOOKBACK_DAYS) },
          amountCents: { gt: 0 },
        },
        _sum: { amountCents: true },
      }),
      db.transactions.count({ where: { date: { gte: days(MEDICAL_LOOKBACK_DAYS) } } }),
    ]);
  // A car loan and the car it's linked to are one car.
  const carLoans = loans.filter((l) => l.subtype === "auto").map((l) => l.id);
  const ownedCars = owned.filter((o) => o.kind === "vehicle");
  const linked = new Set(ownedCars.map((o) => o.loanAccountId));
  const cars = ownedCars.length + carLoans.filter((id) => !linked.has(id)).length;
  return resolveHousehold(saved, {
    mortgage: loans.some((l) => l.subtype === "mortgage"),
    homeOwned: owned.some((o) => o.kind === "home"),
    rentPaid: rent > 0,
    cars,
    paycheck: paychecks > 0,
    assetsCents:
      balances.some((b) => b.currentBalanceCents !== null) || owned.length > 0
        ? balances.reduce((sum, b) => sum + Math.max(0, b.currentBalanceCents ?? 0), 0) +
          owned.reduce((sum, o) => sum + o.valueCents, 0)
        : null,
    travelCents: travel._sum.amountCents ?? 0,
    medicalCents: anyTransactions > 0 ? (medical._sum.amountCents ?? 0) : null,
  });
}

export type HouseholdInput = {
  housing: string;
  vehicles: string;
  dependants: string;
  pets: string;
};

function count(raw: string, what: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > MAX_HOUSEHOLD_COUNT) {
    throw new HouseholdFactsError(`Enter how many ${what}, as a whole number.`);
  }
  return n;
}

// Pure: the form, checked. Blank means "not saying", which lets the accounts answer.
export function checkHousehold(input: HouseholdInput) {
  const housing = input.housing.trim();
  if (housing && !isHousing(housing)) throw new HouseholdFactsError("Pick where you live.");
  return {
    housing: housing || null,
    vehicles: count(input.vehicles, "cars"),
    dependants: count(input.dependants, "people depend on you"),
    pets: count(input.pets, "pets"),
  };
}

export async function saveHousehold(
  userId: string,
  input: HouseholdInput,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const facts = checkHousehold(input);
  await scopedFor(userId, client).insuranceProfiles.upsert({
    where: { userId },
    create: { userId, ...facts },
    update: facts,
  });
  await logAudit({ type: "user", id: userId }, "insurance_household_saved", {
    type: "user",
    id: userId,
  });
  await track(userId, "insurance_household_saved");
}

// "I don't need it" on a gap: never brought up again, on the page or in the chat.
export async function dismissGap(
  userId: string,
  gap: GapKey,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const saved = await db.insuranceProfiles.findFirst({ select: { dismissedGaps: true } });
  if (saved?.dismissedGaps.includes(gap)) return false;
  await db.insuranceProfiles.upsert({
    where: { userId },
    create: { userId, dismissedGaps: [gap] },
    update: { dismissedGaps: [...(saved?.dismissedGaps ?? []), gap] },
  });
  await track(userId, "insurance_gap_dismissed", { gap });
  return true;
}
