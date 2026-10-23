import {
  IRMAA,
  IRMAA_INDEX,
  IRMAA_LOOKBACK_YEARS,
  SS_BASE,
  SS_SHARES,
  type IrmaaYear,
} from "@/config/retirement-taxes";
import type { Balances } from "./retirement-income";

// Taxes on retirement income (spec step 271). Pure: how much of Social Security is taxable at an
// income, the Medicare surcharge tier an income sets two years ahead, and the order to draw from
// accounts tuned to stay under the surcharge line, for the investing side's retirement paycheck
// (step 212).

const round = Math.round;

export type Status = "single" | "married_joint";

export type SocialSecurityTax = {
  benefitsCents: number;
  provisionalCents: number;
  taxableCents: number;
  // Of each extra dollar of other income, how much more Social Security becomes taxable:
  // 0, 0.5 or 0.85 (until 85% of benefits is reached).
  extraTaxablePerDollar: number;
};

export function socialSecurityTax(input: {
  benefitsCents: number;
  // Other income in adjusted gross income (pensions, IRA withdrawals, wages, interest).
  otherIncomeCents: number;
  taxExemptInterestCents?: number;
  status: Status;
}): SocialSecurityTax {
  const b = input.benefitsCents;
  const provisional = input.otherIncomeCents + (input.taxExemptInterestCents ?? 0) + round(b / 2);
  const [base1, base2] = SS_BASE[input.status];
  const taxableAt = (p: number) => {
    if (p <= base1) return 0;
    if (p <= base2) return Math.min(SS_SHARES.first * b, SS_SHARES.first * (p - base1));
    return Math.min(
      SS_SHARES.second * b,
      SS_SHARES.second * (p - base2) +
        Math.min(SS_SHARES.first * b, SS_SHARES.first * (base2 - base1)),
    );
  };
  const taxable = round(taxableAt(provisional));
  const next = round(taxableAt(provisional + 100_000)) - taxable;
  return {
    benefitsCents: b,
    provisionalCents: provisional,
    taxableCents: taxable,
    extraTaxablePerDollar: b > 0 ? Math.round((next / 100_000) * 100) / 100 : 0,
  };
}

// The surcharge table for the year premiums are paid: published, or the latest grown by the
// index for a later year (and marked estimated).
export function irmaaYear(premiumYear: number): IrmaaYear & { year: number } {
  const years = Object.keys(IRMAA)
    .map(Number)
    .sort((a, b) => a - b);
  const known = IRMAA[premiumYear];
  if (known) return { ...known, year: premiumYear };
  const base = premiumYear < years[0] ? years[0] : years[years.length - 1];
  const t = IRMAA[base];
  const k = Math.pow(1 + IRMAA_INDEX, Math.max(0, premiumYear - base));
  const grow = (xs: readonly number[]) => xs.map((x) => round((x * k) / 100_000) * 100_000);
  const growMonthly = (xs: readonly number[]) => xs.map((x) => round((x * k) / 10) * 10);
  return {
    single: grow(t.single),
    joint: grow(t.joint),
    partB: growMonthly(t.partB),
    partD: growMonthly(t.partD),
    estimated: true,
    source: `${t.source}, grown ${IRMAA_INDEX * 100}% a year (estimated)`,
    year: premiumYear,
  };
}

export type Irmaa = {
  // The year whose premiums this income sets.
  premiumYear: number;
  estimated: boolean;
  // 0: no surcharge; 1 to 5: the tier.
  tier: number;
  // Monthly surcharge per person (Part B and D together) at this tier.
  monthlyPerPersonCents: number;
  // The line above this income (null past the top), and the room to it.
  nextLineCents: number | null;
  roomCents: number | null;
  // What crossing that line adds a year for the household.
  nextYearlyCents: number | null;
};

export function irmaaFor(input: {
  magiCents: number;
  status: Status;
  incomeYear: number;
  // People on Medicare in the household then (1 or 2).
  people: number;
}): Irmaa {
  const t = irmaaYear(input.incomeYear + IRMAA_LOOKBACK_YEARS);
  const lines = input.status === "married_joint" ? t.joint : t.single;
  const tier = lines.filter((l) => input.magiCents > l).length;
  const monthly = (i: number) => (i <= 0 ? 0 : t.partB[i - 1] + t.partD[i - 1]);
  const next = tier < lines.length ? lines[tier] : null;
  return {
    premiumYear: t.year,
    estimated: t.estimated,
    tier,
    monthlyPerPersonCents: monthly(tier),
    nextLineCents: next,
    roomCents: next === null ? null : Math.max(0, next - input.magiCents),
    nextYearlyCents:
      next === null ? null : (monthly(tier + 1) - monthly(tier)) * 12 * Math.max(1, input.people),
  };
}

export type TunedDraw = {
  // A year's draw from each kind of account to meet the need.
  preTaxCents: number;
  taxableCents: number;
  rothCents: number;
  // Income for the surcharge after the draw, and the room left under the line.
  magiCents: number;
  roomCents: number | null;
  // The pre-tax most that keeps under the line.
  preTaxCapCents: number | null;
  ss: SocialSecurityTax;
};

// The step 212 order (taxable, then pre-tax, then Roth) tuned to stay under Medicare's surcharge
// line: taxable accounts first (only their gains count as income), then pre-tax money only as far
// as the room under the line allows (with Social Security's taxable part growing with it), then
// Roth; pre-tax money over the line only when nothing else is left.
export function tunedDraw(input: {
  needCents: number;
  balances: Balances;
  // Other income in adjusted gross income, before the draw, and Social Security.
  otherIncomeCents: number;
  ssBenefitsCents: number;
  status: Status;
  incomeYear: number;
  people: number;
  // The share of a taxable-account withdrawal that is gain (counted in income).
  taxableGainShare: number;
}): TunedDraw {
  const ssAt = (other: number) =>
    socialSecurityTax({
      benefitsCents: input.ssBenefitsCents,
      otherIncomeCents: other,
      status: input.status,
    });
  const magiAt = (other: number) => other + ssAt(other).taxableCents;
  const base = irmaaFor({
    magiCents: magiAt(input.otherIncomeCents),
    status: input.status,
    incomeYear: input.incomeYear,
    people: input.people,
  });
  const line = base.nextLineCents;
  // The most extra ordinary income that keeps under the line (Social Security's taxable part
  // grows with it, so search).
  let cap: number | null = null;
  if (line !== null) {
    let lo = 0;
    let hi = Math.max(0, line);
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (magiAt(input.otherIncomeCents + mid) < line) lo = mid;
      else hi = mid;
    }
    cap = Math.floor(lo / 100) * 100;
  }
  const share = Math.max(input.taxableGainShare, 0.01);
  let need = Math.max(0, input.needCents);
  const taxable = Math.min(
    need,
    input.balances.taxableCents,
    cap === null ? Infinity : cap / share,
  );
  need -= taxable;
  const gains = round(taxable * input.taxableGainShare);
  const preTaxCap = cap === null ? null : Math.max(0, cap - gains);
  const preTax = Math.min(need, input.balances.preTaxCents, preTaxCap ?? Infinity);
  need -= preTax;
  const roth = Math.min(need, input.balances.rothCents);
  need -= roth;
  // Whatever is still needed comes from pre-tax money over the line.
  const over = Math.min(need, input.balances.preTaxCents - preTax);
  const other = input.otherIncomeCents + preTax + over + gains;
  const magi = magiAt(other);
  return {
    preTaxCents: round(preTax + over),
    taxableCents: round(taxable),
    rothCents: round(roth),
    magiCents: magi,
    roomCents: line === null ? null : line - magi,
    preTaxCapCents: preTaxCap,
    ss: ssAt(other),
  };
}
