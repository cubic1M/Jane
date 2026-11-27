import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FilingStatus } from "@/config/tax";
import {
  estimateTaxes,
  NO_INCOME,
  type EstimateIncome,
  type EstimateInput,
  type TaxEstimate,
} from "@/planning/tax-estimate";
import { FIGURES, type FigureId } from "./figures";
import { pub505ScheduleCases } from "./schedules";
import type { BenchCase } from "./types";

// Estimate inputs a case may carry before the estimator takes them, and the roadmap step that adds
// each. The estimator ignores them until then; the test fails when a key listed here is a real
// input by now, so the entry is removed in the step that adds the field.
export const FUTURE_INPUTS: Readonly<Record<string, string>> = {
  claimedAsDependent: "T5",
  blind: "T5",
  qualifyingChildren: "T16",
  medicareWagesCents: "T28",
  livedWithSpouse: "unowned",
};

// The estimator's input for a person: whatever is left out is zero, and Social Security wages are the
// wages unless given.
export function inputOf(
  year: number,
  filingStatus: FilingStatus,
  income: Partial<EstimateIncome>,
  rest: Partial<EstimateInput> = {},
): EstimateInput {
  return {
    year,
    filingStatus,
    childrenUnder17: 0,
    otherDependants: 0,
    state: null,
    income: { ...NO_INCOME, socialSecurityWagesCents: income.wagesCents ?? 0, ...income },
    studentLoanInterestCents: 0,
    mortgageInterestCents: 0,
    charityCents: 0,
    medicalCents: 0,
    otherStateLocalTaxCents: 0,
    federalWithheldCents: 0,
    federalEstimatedPaidCents: 0,
    stateWithheldCents: 0,
    stateEstimatedPaidCents: 0,
    ...rest,
  };
}

// One case as the estimator's input.
export const toInput = (c: BenchCase): EstimateInput =>
  inputOf(c.taxYear, c.household.filingStatus, c.income, {
    ...c.household,
    ...(c.extra as Partial<EstimateInput> | undefined),
  });

// The keys of the estimator's input, for telling a future input from a real one. Typed so a field
// added to EstimateInput fails the build here until it is listed.
const INPUT_KEY_FLAGS: Record<keyof EstimateInput, true> = {
  year: true,
  filingStatus: true,
  childrenUnder17: true,
  otherDependants: true,
  age: true,
  state: true,
  residency: true,
  income: true,
  studentLoanInterestCents: true,
  otherAdjustmentsCents: true,
  otherCreditsCents: true,
  amtPreferenceCents: true,
  residentCreditsAllowed: true,
  mortgageInterestCents: true,
  charityCents: true,
  medicalCents: true,
  otherStateLocalTaxCents: true,
  federalWithheldCents: true,
  federalEstimatedPaidCents: true,
  stateWithheldCents: true,
  stateEstimatedPaidCents: true,
};
export const INPUT_KEYS: ReadonlySet<string> = new Set(Object.keys(INPUT_KEY_FLAGS));

export type Outcome = { estimate: TaxEstimate; wrong: FigureId[] };

// Whether a figure is off by more than its tolerance. A figure that is not a number is always off
// (NaN compares false with everything, so it would otherwise pass).
export const differs = (actual: number, want: number, tolerance = 0): boolean =>
  !Number.isFinite(actual) || Math.abs(actual - want) > tolerance;

// Runs a case and lists the figures that differ from what it expects (beyond its tolerance).
export function runCase(c: BenchCase): Outcome {
  const estimate = estimateTaxes(toInput(c));
  const wrong = (Object.entries(c.expected) as [FigureId, number][])
    .filter(([id, want]) => differs(FIGURES[id](estimate), want, c.tolerance?.[id]))
    .map(([id]) => id);
  return { estimate, wrong };
}

const CASES_DIR = join(__dirname, "cases");

// The years that have a case directory (T3 adds 2025's figures, T4 the estimator that reads them).
export const CASE_YEARS = readdirSync(CASES_DIR)
  .filter((d) => /^\d{4}$/.test(d))
  .map(Number)
  .sort();

// The years the estimator prices from tables for that year: 2026 today. T4 makes it read the year,
// and adds 2025 here with the cases T3 writes.
export const ESTIMATOR_YEARS = [2025, 2026] as const;

export function loadCases(year: number): BenchCase[] {
  const dir = join(CASES_DIR, String(year));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const fromFiles = files
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as BenchCase[]);
  return [...fromFiles, ...(year === 2026 ? pub505ScheduleCases() : [])];
}
