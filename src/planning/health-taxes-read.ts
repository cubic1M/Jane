import { DETECTOR_RATES } from "@/config/detectors";
import { HEALTH_PREMIUM, HSA_DEPOSIT, MARKETPLACE_PAYEE } from "@/config/health-taxes";
import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";
import {
  ADDITIONAL_STANDARD_65,
  FEDERAL_BRACKETS,
  ITEMIZED,
  STANDARD_DEDUCTION,
} from "@/config/tax-rates";
import type { Profile, ProfileInput } from "@/profile/build";
import {
  benchmarkYear,
  creditAt,
  hsaExcess,
  hsaLimitFor,
  incomeByMonth,
  incomePace,
  medicalDeduction,
  ptcCheck,
  type IncomePace,
  type PtcCheck,
} from "./health-taxes";
import { marginalRateOf } from "./tax-estimate";

// The tax side of health insurance (spec step 269), read from a person's profile and the rows
// behind it. Pure. The detectors (src/detectors/taxes.ts), the chat and /taxes/health all use
// this one reading, so the figures match wherever they're shown.

const T = DETECTOR_RATES.tax;

export type HealthTaxes = {
  year: number;
  status: "single" | "married_joint";
  householdSize: number;
  // Income for the year from deposits (profit for the self-employed, gross for take-home pay),
  // projected month by month.
  pace: IncomePace;
  marginalRate: number;
  marketplace: {
    // Premiums to a Marketplace plan seen this year.
    payments: number;
    paidCents: number;
    // The advance credit for the year and the benchmark plan's premium: told, or worked out
    // (the advance from the income at enrollment, the benchmark a national average).
    advanceYearCents: number;
    benchmarkYearCents: number;
    told: boolean;
    check: PtcCheck | null;
  };
  hsa: {
    deposits: number;
    contributedCents: number;
    projectedCents: number;
    family: boolean;
    limitCents: number;
    excessCents: number;
    projectedExcessCents: number;
    exciseCents: number;
    roomCents: number;
  };
  medical: {
    payments: number;
    spentCents: number;
    floorCents: number;
    deductibleCents: number;
    toFloorCents: number;
    standardCents: number;
    otherItemizedCents: number;
    itemizing: boolean;
    savesCents: number;
  };
};

const statusOf = (household: unknown) =>
  household === "couple" || household === "family" ? "married_joint" : "single";

export function readHealthTaxes(profile: Profile, data: ProfileInput): HealthTaxes {
  const f = profile.facts;
  const year = Number(profile.today.slice(0, 4));
  const month = Number(profile.today.slice(5, 7));
  const inYear = (t: { date: string; amountCents: number }) =>
    t.amountCents > 0 && t.date.startsWith(String(year));
  const pattern = f.income_pattern.value;
  const share =
    pattern === "business"
      ? T.businessProfitShare
      : pattern === "uneven"
        ? T.freelanceProfitShare
        : pattern === "pension"
          ? 1
          : T.netToGross;
  const pace = incomePace(incomeByMonth(data.transactions, year, share), month);
  const status = statusOf(f.household.value);
  const adults = status === "married_joint" ? 2 : 1;
  const children = f.household.value === "family" ? T.familyChildren : 0;
  const size = adults + children;
  const older =
    f.life_stage.value === "retired" || (typeof f.age.value === "number" && f.age.value >= 65);
  const standard =
    STANDARD_DEDUCTION[status] +
    (older
      ? status === "married_joint"
        ? 2 * ADDITIONAL_STANDARD_65.married
        : ADDITIONAL_STANDARD_65.unmarried
      : 0);
  const marginalRate = marginalRateOf(
    Math.max(0, pace.projectedCents - standard),
    FEDERAL_BRACKETS[status],
  );

  // The Marketplace credit.
  const premiums = data.transactions.filter(
    (t) => inYear(t) && MARKETPLACE_PAYEE.test(t.description),
  );
  const toldNumber = (v: unknown) => (typeof v === "number" ? v : null);
  const toldAdvance = toldNumber(f.marketplace_aptc_monthly.value);
  const bench = benchmarkYear(
    { adults, children },
    toldNumber(f.marketplace_benchmark_monthly.value),
  );
  const advance =
    toldAdvance !== null ? toldAdvance * 12 : creditAt(pace.enrollmentCents, size, bench);
  const check =
    premiums.length >= T.marketplacePaymentsMin && advance > 0
      ? ptcCheck({
          year,
          incomeCents: pace.projectedCents,
          householdSize: size,
          benchmarkYearCents: bench,
          advanceYearCents: advance,
        })
      : null;

  // HSA deposits: money into a linked HSA, or (with none linked) money out to one by name.
  const hsaIds = new Set(data.accounts.filter((a) => a.subtype === "hsa").map((a) => a.id));
  const puts = data.transactions.filter(
    (t) =>
      t.date.startsWith(String(year)) &&
      (hsaIds.size > 0
        ? hsaIds.has(t.accountId) && t.amountCents < 0
        : t.amountCents > 0 && HSA_DEPOSIT.test(t.description)),
  );
  const contributed = puts.reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const projected = Math.round(contributed + (contributed / month) * (12 - month));
  const family = status === "married_joint";
  const limit = hsaLimitFor(family, toldNumber(f.age.value));
  const excess = hsaExcess({
    contributedCents: contributed,
    projectedCents: projected,
    limitCents: limit,
  });

  // Medical costs against the floor and the standard deduction.
  const care = data.transactions.filter(
    (t) =>
      inYear(t) &&
      (((t.pfc ?? "").startsWith("MEDICAL_") && t.pfc !== "MEDICAL_VETERINARY_SERVICES") ||
        HEALTH_PREMIUM.test(t.description)),
  );
  const spent = care.reduce((s, t) => s + t.amountCents, 0);
  const salt = data.transactions
    .filter((t) => inYear(t) && PROPERTY_TAX_PAYEE.test(t.description))
    .reduce((s, t) => s + t.amountCents, 0);
  const gifts = data.transactions
    .filter((t) => inYear(t) && t.pfc === "GOVERNMENT_AND_NON_PROFIT_DONATIONS")
    .reduce((s, t) => s + t.amountCents, 0);
  const other = Math.min(salt, ITEMIZED.saltCap.normal) + gifts;
  const med = medicalDeduction({
    medicalCents: spent,
    agiCents: pace.projectedCents,
    otherItemizedCents: other,
    standardCents: standard,
    marginalRate,
  });

  return {
    year,
    status,
    householdSize: size,
    pace,
    marginalRate,
    marketplace: {
      payments: premiums.length,
      paidCents: premiums.reduce((s, t) => s + t.amountCents, 0),
      advanceYearCents: advance,
      benchmarkYearCents: bench,
      told: toldAdvance !== null,
      check,
    },
    hsa: {
      deposits: puts.length,
      contributedCents: contributed,
      projectedCents: projected,
      family,
      limitCents: limit,
      ...excess,
    },
    medical: {
      payments: care.length,
      spentCents: spent,
      standardCents: standard,
      otherItemizedCents: other,
      ...med,
    },
  };
}
