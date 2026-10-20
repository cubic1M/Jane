import { TAX_RATES_YEAR } from "@/config/tax-rates";

// Tax moves over several years (spec step 220). FOR REVIEW. The IRS publishes next year's
// brackets, deductions and capital gains thresholds each autumn; for later years Jane
// assumes they keep rising with inflation, the way the law indexes them. Brackets for a year
// are the 2026 brackets (src/config/tax-rates.ts) scaled by that year's factor from here,
// and the projection says plainly that they're an assumption.
//
// Source for the 2026 figures: IRS Rev. Proc. 2025-32. The indexing rate is the chained CPI
// the IRS uses, ESTIMATE TO VERIFY: 2026's adjustments were about 2.3% to 2.7%.

export const BRACKET_INDEXING_RATE = 0.025;
// Pay grows by this a year in the projection, until the retirement year.
export const WAGE_GROWTH_RATE = 0.03;
// Money in a traditional retirement account grows by this a year (a plain assumption).
export const RETIREMENT_GROWTH_RATE = 0.05;
// The projection looks this many years ahead of the tax year, and further when retirement
// withdrawals run past it, to at most MAX_YEARS.
export const PROJECTION_YEARS = 10;
export const MAX_PROJECTION_YEARS = 35;
// Withdrawals from a traditional account start in the retirement year and run this long.
export const WITHDRAWAL_YEARS = 20;
// Without a retirement year from the person, Jane assumes this many years ahead.
export const DEFAULT_YEARS_TO_RETIREMENT = 15;

// A move is only brought up when its effect over the years is at least this.
export const MOVE_MIN_CENTS = 50_000;
// Roth conversions below this aren't worth the trouble.
export const MIN_CONVERSION_CENTS = 100_000;

// The year's scale against 2026: brackets, the standard deduction and capital gains
// thresholds in year Y are the 2026 figures times this.
export const indexFactor = (year: number): number =>
  (1 + BRACKET_INDEXING_RATE) ** (year - TAX_RATES_YEAR);

// The explicit table the projection uses, one row per year, so a reviewer can see (and
// override) each year's scale.
export function yearTable(from: number, years: number) {
  return Array.from({ length: years }, (_, i) => ({
    year: from + i,
    factor: indexFactor(from + i),
  }));
}

export const PLANNED_EVENT_KINDS = {
  bonus: "A bonus",
  sale: "Selling an investment or property at a gain",
  withdrawal: "A retirement withdrawal",
} as const;
export type PlannedEventKind = keyof typeof PLANNED_EVENT_KINDS;
