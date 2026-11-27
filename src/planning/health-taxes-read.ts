import type { FilingStatus } from "@/config/tax";
import { ownLawYear } from "@/config/tax-params";
import { dataEnd } from "@/detection/helpers";
import { DETECTOR_RATES } from "@/config/detectors";
import {
  HEALTH_PREMIUM,
  HSA_DEPOSIT,
  MARKETPLACE_PAYEE,
  NOT_HEALTH_MARKETPLACE,
} from "@/config/health-taxes";
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
import { filingStatusOf } from "./student-tax";

// The tax side of health insurance (spec step 269), read from a person's profile and the rows
// behind it. Pure. The detectors (src/detectors/taxes.ts), the chat and /taxes/health all use
// this one reading, so the figures match wherever they're shown.

const T = DETECTOR_RATES.tax;

export type HealthTaxes = {
  year: number;
  status: FilingStatus;
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
    // The cover type isn't told: a married filer is read as family cover (the higher limit), so
    // the limit and the room are an assumption, and the self-only limit is shown beside it.
    coverageAssumed: boolean;
    selfLimitCents: number;
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

// How they file, as every other tax figure reads it (filingStatusOf: what they said, else married
// filing jointly on a sign of a partner, else single), kept as told: head of household and married
// filing separately use their own deduction and brackets. The household fact says how many people
// (below), not how they file.
const statusOf = (f: Profile["facts"]): FilingStatus => filingStatusOf(f);

export function readHealthTaxes(profile: Profile, data: ProfileInput): HealthTaxes {
  const f = profile.facts;
  // The figures here are the year's own tax figures: a year Jane has no IRS figures for throws
  // NoTaxParamsError (held back by the detector runner, W-N in the chat tool), never priced with
  // another year's law.
  const year = ownLawYear(Number(profile.today.slice(0, 4)));
  // The month the data reaches, not today's (gate C's calendar sweep, 11-16: with a bank that
  // hadn't synced, each new month counted as one more with no pay and no HSA deposits, so the
  // year's pace sagged on the 1st). Before this year's data, no month of it is complete.
  const through = dataEnd(data.transactions, profile.today);
  const month = through.startsWith(String(year)) ? Number(through.slice(5, 7)) : 1;
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
  const status = statusOf(f);
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
    (t) =>
      inYear(t) &&
      MARKETPLACE_PAYEE.test(t.description) &&
      !NOT_HEALTH_MARKETPLACE.test(t.description),
  );
  const toldNumber = (v: unknown) => (typeof v === "number" ? v : null);
  const toldAdvance = toldNumber(f.marketplace_aptc_monthly.value);
  const bench = benchmarkYear(
    { adults, children },
    toldNumber(f.marketplace_benchmark_monthly.value),
  );
  const advance =
    toldAdvance !== null ? toldAdvance * 12 : creditAt(pace.enrollmentCents, size, bench);
  // Without the person's own advance, it's worked out from the income in the year's first months:
  // history that starts after January has no such months (they would read as no income, and the
  // full benchmark premium as the advance), so with neither, there is no figure to check.
  const dataStart = data.transactions
    .filter((t) => t.date.startsWith(String(year)))
    .reduce((a, t) => (t.date < a ? t.date : a), "9999-12-31");
  const enrollmentSeen = toldAdvance !== null || dataStart <= `${year}-01-31`;
  const check =
    premiums.length >= T.marketplacePaymentsMin && advance > 0 && enrollmentSeen
      ? ptcCheck({
          year,
          incomeCents: pace.projectedCents,
          householdSize: size,
          benchmarkYearCents: bench,
          advanceYearCents: advance,
        })
      : null;

  // HSA deposits (taxes QA: a bank's transactions never include an investment account's, so
  // money into a linked HSA wasn't seen in the app). The HSA's own contributions when its bank
  // reports them (extras.hsaContributions); otherwise money into a linked HSA's account, or out
  // of the person's other accounts to an HSA by name: never both, so nothing counts twice.
  const reported = data.extras?.hsaContributions;
  const hsaIds = new Set(data.accounts.filter((a) => a.subtype === "hsa").map((a) => a.id));
  const puts = data.transactions.filter(
    (t) =>
      t.date.startsWith(String(year)) &&
      (hsaIds.has(t.accountId)
        ? t.amountCents < 0
        : t.amountCents > 0 && HSA_DEPOSIT.test(t.description)),
  );
  const fromRows = puts.reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const useReported = reported !== undefined && reported !== null && reported.count > 0;
  const contributed = useReported ? reported.cents : fromRows;
  const depositCount = useReported ? reported.count : puts.length;
  const projected = Math.round(contributed + (contributed / month) * (12 - month));
  // Cover is not a filing status: a married filer, or a household of a couple or a family, is read as
  // family cover (the higher limit), as it always was, so a parent filing single keeps it.
  const family =
    status === "married_joint" || f.household.value === "couple" || f.household.value === "family";
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
      deposits: depositCount,
      contributedCents: contributed,
      projectedCents: projected,
      family,
      coverageAssumed: family,
      selfLimitCents: hsaLimitFor(false, toldNumber(f.age.value)),
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
