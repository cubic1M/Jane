import {
  APPLICABLE_PERCENT,
  ASSUMED_BENCHMARK_MONTHLY_CENTS,
  BENCHMARK_CHILD_SHARE,
  ENROLLMENT_MONTHS,
  HSA_CATCH_UP_AGE,
  HSA_EXCESS_EXCISE,
  PTC_CLIFF,
  RECENT_MONTHS,
  REPAYMENT_CAPS,
  fplFor,
} from "@/config/health-taxes";
import { CONTRIBUTION_LIMITS, ITEMIZED } from "@/config/tax-rates";

// The tax side of health insurance (spec step 269). Pure: the premium tax credit a household is
// allowed at its real income against the advance credit set from the income it expected (so a
// mid-year rise is caught before it becomes a bill), contributions to an HSA over the limit, and
// medical costs against the 7.5% floor and the standard deduction.

const round = Math.round;

// Share of income expected toward the benchmark plan, by share of the poverty line.
export function applicablePercent(fplShare: number): number {
  let from = 0;
  for (const band of APPLICABLE_PERCENT) {
    if (fplShare <= band.upTo) {
      if (band.from === band.to) return band.from;
      const t = (fplShare - from) / (band.upTo - from);
      return band.from + (band.to - band.from) * Math.min(1, Math.max(0, t));
    }
    from = band.upTo;
  }
  return APPLICABLE_PERCENT[APPLICABLE_PERCENT.length - 1].to;
}

// The benchmark plan's premium for a year, told or assumed: an adult each, children at half.
export function benchmarkYear(
  household: { adults: number; children: number },
  toldMonthlyCents: number | null,
) {
  if (toldMonthlyCents !== null) return toldMonthlyCents * 12;
  return round(
    ASSUMED_BENCHMARK_MONTHLY_CENTS *
      12 *
      (Math.max(1, household.adults) + household.children * BENCHMARK_CHILD_SHARE),
  );
}

// The credit allowed for a year at an income: the benchmark less the expected contribution,
// nothing over the cliff.
export function creditAt(incomeCents: number, householdSize: number, benchmarkYearCents: number) {
  const share = incomeCents / fplFor(householdSize);
  if (share > PTC_CLIFF) return 0;
  return Math.max(0, benchmarkYearCents - round(incomeCents * applicablePercent(share)));
}

// The year's income from months seen so far: the months before this one as they were, the
// rest at the pace of the last few full months. The advance credit's income is the pace of the
// year's first months, the way most people estimate it when they enroll.
export type IncomePace = {
  enrollmentCents: number;
  projectedCents: number;
  // The average month lately.
  recentMonthlyCents: number;
  // The pace of the last few months against the first: >1 when income rose.
  rise: number;
};

export function incomePace(byMonth: readonly number[], month: number): IncomePace {
  // byMonth[0] is January; months before `month` (1-12) are complete.
  const full = byMonth.slice(0, Math.max(0, month - 1));
  const early = full.slice(0, ENROLLMENT_MONTHS);
  const recent = full.slice(-RECENT_MONTHS);
  const avg = (xs: readonly number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const enrollment = round(avg(early) * 12);
  const projected = round(full.reduce((s, x) => s + x, 0) + avg(recent) * (12 - full.length));
  const before = avg(early);
  return {
    enrollmentCents: enrollment,
    projectedCents: projected,
    recentMonthlyCents: round(avg(recent)),
    rise: before > 0 ? avg(recent) / before : 1,
  };
}

export type PtcCheck = {
  fplShare: number;
  overCliff: boolean;
  // The credit allowed at the projected income for the year.
  allowedCents: number;
  // The advance credit paid for the year.
  advanceCents: number;
  // What would have to be paid back with the return (0 when the advance was too small: the
  // rest comes as a refund at filing).
  repayCents: number;
  // The limit on repayment for the year, null when there is none (over the cliff, or from 2026).
  capCents: number | null;
};

export function ptcCheck(input: {
  year: number;
  // Projected modified adjusted gross income for the year, cents.
  incomeCents: number;
  householdSize: number;
  // The benchmark plan's premium for the year, and the advance credit paid, in cents.
  benchmarkYearCents: number;
  advanceYearCents: number;
}): PtcCheck {
  const share = input.incomeCents / fplFor(input.householdSize);
  const overCliff = share > PTC_CLIFF;
  const allowed = creditAt(input.incomeCents, input.householdSize, input.benchmarkYearCents);
  const excess = Math.max(0, input.advanceYearCents - allowed);
  const caps = REPAYMENT_CAPS[input.year] ?? [];
  const row = overCliff ? undefined : caps.find((c) => share < c.under);
  const cap = row ? (input.householdSize <= 1 ? row.single : row.other) : null;
  return {
    fplShare: share,
    overCliff,
    allowedCents: allowed,
    advanceCents: input.advanceYearCents,
    repayCents: cap === null ? excess : Math.min(excess, cap),
    capCents: cap,
  };
}

// The year's HSA limit for the coverage, with the catch-up from 55.
export function hsaLimitFor(family: boolean, age: number | null) {
  return (
    (family ? CONTRIBUTION_LIMITS.hsaFamily : CONTRIBUTION_LIMITS.hsaSelf) +
    (age !== null && age >= HSA_CATCH_UP_AGE ? CONTRIBUTION_LIMITS.hsaCatchUp55 : 0)
  );
}

// Contributions over the year's limit aren't deductible, and carry a 6% excise tax each year
// they stay in: taking them out (with earnings) by the filing deadline avoids the excise. The
// pace to the year's end shows an excess coming before it happens.
export function hsaExcess(input: {
  contributedCents: number;
  projectedCents: number;
  limitCents: number;
}) {
  const now = Math.max(0, input.contributedCents - input.limitCents);
  const coming = Math.max(0, input.projectedCents - input.limitCents);
  return {
    excessCents: now,
    projectedExcessCents: coming,
    exciseCents: round(Math.max(now, coming) * HSA_EXCESS_EXCISE),
    // Room left this year (0 once over).
    roomCents: Math.max(0, input.limitCents - input.contributedCents),
  };
}

// Medical costs count only above 7.5% of adjusted gross income, and only when itemizing beats
// the standard deduction; what they save is the difference at the person's bracket.
export function medicalDeduction(input: {
  medicalCents: number;
  agiCents: number;
  // Everything else that could be itemized (state and local taxes, mortgage interest, gifts).
  otherItemizedCents: number;
  standardCents: number;
  marginalRate: number;
}) {
  const floor = round(input.agiCents * ITEMIZED.medicalFloorShare);
  const deductible = Math.max(0, input.medicalCents - floor);
  const without = Math.max(input.standardCents, input.otherItemizedCents);
  const withIt = Math.max(input.standardCents, input.otherItemizedCents + deductible);
  const extra = withIt - without;
  return {
    floorCents: floor,
    deductibleCents: deductible,
    itemizing: input.otherItemizedCents + deductible > input.standardCents,
    // More to spend on care before any of it counts.
    toFloorCents: Math.max(0, floor - input.medicalCents),
    savesCents: round(extra * input.marginalRate),
  };
}

// Money in from work or retirement, by month of the year (January first), as income for the
// credit: deposits times `share` (profit for the self-employed, gross for take-home pay).
export function incomeByMonth(
  rows: readonly { date: string; amountCents: number; pfc: string | null }[],
  year: number,
  share: number,
): number[] {
  const out = Array<number>(12).fill(0);
  for (const t of rows) {
    if (t.amountCents >= 0 || !(t.pfc ?? "").startsWith("INCOME_")) continue;
    if (!t.date.startsWith(String(year))) continue;
    out[Number(t.date.slice(5, 7)) - 1] += round(-t.amountCents * share);
  }
  return out;
}
