import {
  BUSINESS_LOOKBACK_DAYS,
  BUSINESS_SALES_DEPOSIT,
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
  type RiskKind,
  type Housing,
} from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { runsBusiness, type SelfEmployment } from "./business-rules";

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
  // Spec step 197: risks they said yes to ("Are you driving for Uber?").
  risks?: RiskKind[];
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
  // Spec step 201: what the tax lane's signals say about freelance and gig work.
  selfEmployment?: SelfEmployment;
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
      ...(signs.selfEmployment ? { selfEmployment: signs.selfEmployment } : {}),
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
  const [
    saved,
    loans,
    owned,
    rent,
    paychecks,
    balances,
    travel,
    medical,
    anyTransactions,
    sideWork,
    taxProfile,
  ] = await Promise.all([
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
    // Spec step 201.
    db.transactions.findMany({
      where: {
        date: { gte: days(BUSINESS_LOOKBACK_DAYS) },
        OR: [
          {
            pfcDetailed: { in: ["INCOME_CONTRACTOR", "INCOME_GIG_ECONOMY"] },
            amountCents: { lt: 0 },
          },
          { pfcDetailed: "GENERAL_MERCHANDISE_ELECTRONICS", amountCents: { gt: 0 } },
          // A shop's card sales, and gas for driving to suppliers and customers.
          { pfcDetailed: "INCOME_OTHER", amountCents: { lt: 0 } },
          { pfcDetailed: "TRANSPORTATION_GAS", amountCents: { gt: 0 } },
        ],
      },
      select: { pfcDetailed: true, amountCents: true, description: true },
    }),
    db.taxProfiles.findFirst({
      select: { incomeKinds: true, businessMiles: true, businessMilesYear: true },
    }),
  ]);
  // A car loan and the car it's linked to are one car.
  const carLoans = loans.filter((l) => l.subtype === "auto").map((l) => l.id);
  const ownedCars = owned.filter((o) => o.kind === "vehicle");
  const linked = new Set(ownedCars.map((o) => o.loanAccountId));
  const cars = ownedCars.length + carLoans.filter((id) => !linked.has(id)).length;
  const yes = await db.insuranceRisks.findMany({
    where: { status: "yes" },
    select: { kind: true },
  });
  const household = resolveHousehold(saved, {
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
    // Only for someone with a business or side work.
    ...businessSignal({
      declared: taxProfile?.incomeKinds.includes("self_employed") ?? false,
      serviceCents: sumOf(sideWork, "INCOME_CONTRACTOR"),
      gigCents: sumOf(sideWork, "INCOME_GIG_ECONOMY"),
      salesCents: sumOf(
        sideWork.filter((r) => BUSINESS_SALES_DEPOSIT.test(r.description)),
        "INCOME_OTHER",
      ),
      gasMonthlyCents: Math.round(
        sumOf(sideWork, "TRANSPORTATION_GAS") / (BUSINESS_LOOKBACK_DAYS / (365 / 12)),
      ),
      miles:
        taxProfile?.businessMilesYear === now.getUTCFullYear()
          ? (taxProfile.businessMiles ?? 0)
          : 0,
      equipmentCents: sumOf(sideWork, "GENERAL_MERCHANDISE_ELECTRONICS"),
    }),
  });
  return { ...household, risks: yes.map((r) => r.kind as RiskKind) };
}

// Spec step 201: the business signals, kept only when there is a business or side work to cover.
const businessSignal = (s: SelfEmployment): { selfEmployment?: SelfEmployment } =>
  runsBusiness(s) || s.gigCents > 0 || s.miles > 0 || s.equipmentCents > 0
    ? { selfEmployment: s }
    : {};

// The size of the rows in one category, as a positive amount whichever way the money went.
const sumOf = (rows: { pfcDetailed: string | null; amountCents: number }[], category: string) =>
  rows.filter((r) => r.pfcDetailed === category).reduce((n, r) => n + Math.abs(r.amountCents), 0);

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
