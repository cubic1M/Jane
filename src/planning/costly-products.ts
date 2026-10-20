import {
  COMPARE_YEARS,
  EXIT_HORIZON_YEARS,
  EXIT_MIN_SAVING_CENTS,
  LOW_COST_BPS,
} from "@/config/costly-products";
import { RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";

// What costly products really cost (spec step 215, demo advice). Pure: yearly cost in
// dollars, surrender charges by year, what the same money would do in a low-cost fund as a
// range, and when leaving costs less than staying. Never "leave" without the surrender
// figures: every exit figure here carries its surrender charge.

export const yearlyCost = (valueCents: number, bps: number) =>
  Math.round((valueCents * bps) / 10_000);

// The contract year a product is in on `today` (the first year is 1).
export function contractYear(purchasedOn: string, today: string): number {
  const years =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${purchasedOn}T00:00:00Z`)) /
    (365.25 * 86_400_000);
  return Math.max(1, Math.floor(years) + 1);
}

// The surrender charge percent in a contract year (zero past the schedule).
export const surrenderPct = (schedule: number[], year: number) => schedule[year - 1] ?? 0;

export function surrenderEndsOn(purchasedOn: string, schedule: number[]): string {
  const d = new Date(`${purchasedOn}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + schedule.length);
  return d.toISOString().slice(0, 10);
}

// The charge by contract year, in dollars, from today on, until it reaches zero.
export function surrenderByYear(valueCents: number, schedule: number[], fromYear: number) {
  const rows: { year: number; pct: number; cents: number }[] = [];
  for (let y = fromYear; y <= schedule.length + 1; y += 1) {
    const pct = surrenderPct(schedule, y);
    rows.push({ year: y, pct, cents: Math.round((valueCents * pct) / 100) });
  }
  return rows;
}

// What `valueCents` is worth after `years` at a nominal return less a yearly fee.
const grow = (valueCents: number, years: number, nominal: number, bps: number) =>
  Math.round(valueCents * (1 + nominal - bps / 10_000) ** years);

// How much more the same money could be worth in a low-cost fund than at this fee, over
// COMPARE_YEARS, as a range across the assumed returns. A gap in cost, not a forecast.
export function feeGap(valueCents: number, feeBps: number, years = COMPARE_YEARS) {
  const gap = (r: number) =>
    grow(valueCents, years, r, LOW_COST_BPS) - grow(valueCents, years, r, feeBps);
  return { lowCents: gap(RETURN_LOW.value), highCents: gap(RETURN_HIGH.value), years };
}

export type Exit = {
  // Costs over the horizon, fees and surrender charges both, in cents.
  stayCents: number;
  leaveNowCents: number;
  // Leaving after waiting `waitYears` (the cheapest): when the surrender charge is smaller.
  bestWaitYears: number;
  bestCents: number;
  surrenderNowCents: number;
  surrenderEndsOn: string;
  horizonYears: number;
  // staying wins, leaving now wins, or waiting then leaving wins.
  verdict: "stay" | "leave_now" | "wait";
};

export function exitComparison(input: {
  valueCents: number;
  feeBps: number;
  schedule: number[];
  purchasedOn: string;
  today: string;
  horizonYears?: number;
}): Exit {
  const h = input.horizonYears ?? EXIT_HORIZON_YEARS;
  const year = contractYear(input.purchasedOn, input.today);
  const high = yearlyCost(input.valueCents, input.feeBps);
  const low = yearlyCost(input.valueCents, LOW_COST_BPS);
  const charge = (k: number) =>
    Math.round((input.valueCents * surrenderPct(input.schedule, year + k)) / 100);
  // Waiting k years then leaving: the high fee for k years, the surrender charge then, and
  // the low fee after.
  const leaveAfter = (k: number) => high * k + charge(k) + low * (h - k);
  let best = 0;
  for (let k = 1; k <= h; k += 1) if (leaveAfter(k) < leaveAfter(best)) best = k;
  const stay = high * h;
  const verdict =
    stay - leaveAfter(best) < EXIT_MIN_SAVING_CENTS ? "stay" : best === 0 ? "leave_now" : "wait";
  return {
    stayCents: stay,
    leaveNowCents: leaveAfter(0),
    bestWaitYears: best,
    bestCents: leaveAfter(best),
    surrenderNowCents: charge(0),
    surrenderEndsOn: surrenderEndsOn(input.purchasedOn, input.schedule),
    horizonYears: h,
    verdict,
  };
}

// Whole life: what's been paid in, the cash value, what leaving now returns after the
// surrender charge, and what the same premiums could be worth in a low-cost fund (a range).
export function wholeLifeCompare(input: {
  premiumYearlyCents: number;
  years: number;
  cashValueCents: number;
  surrenderPctNow: number;
}) {
  const paid = input.premiumYearlyCents * input.years;
  const fv = (r: number) => {
    let balance = 0;
    for (let i = 0; i < input.years; i += 1)
      balance = (balance + input.premiumYearlyCents) * (1 + r - LOW_COST_BPS / 10_000);
    return Math.round(balance);
  };
  return {
    paidCents: paid,
    cashValueCents: input.cashValueCents,
    surrenderCents: Math.round((input.cashValueCents * input.surrenderPctNow) / 100),
    leaveNowCents: Math.round((input.cashValueCents * (100 - input.surrenderPctNow)) / 100),
    inFundsCents: { lowCents: fv(RETURN_LOW.value), highCents: fv(RETURN_HIGH.value) },
  };
}
