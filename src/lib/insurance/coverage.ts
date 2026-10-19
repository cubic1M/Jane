import {
  COVERAGE_FIELDS,
  MAX_LIMIT_CENTS,
  MAX_TERM_YEARS,
  type CoverageField,
  type PolicyKind,
} from "@/config/insurance";
import { formatCents, parseMoneyToCents } from "@/lib/money";

// A policy's cover limits (spec step 102): read from the form, stored as JSON by key, and
// said in plain words. Pure.

// cents for money, true/false for yes or no, a whole number for years and percent.
export type Coverage = Record<string, number | boolean>;

export class CoverageError extends Error {}

// What was stored, keeping only the fields this kind has and values of the right type.
export function readCoverage(kind: PolicyKind, value: unknown): Coverage {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;
  const coverage: Coverage = {};
  for (const field of COVERAGE_FIELDS[kind]) {
    const v = raw[field.key];
    if (field.type === "yesno" ? typeof v === "boolean" : Number.isInteger(v) && Number(v) >= 0) {
      coverage[field.key] = v as number | boolean;
    }
  }
  return coverage;
}

function parseField(field: CoverageField, raw: string): number | boolean | null {
  const text = raw.trim();
  if (!text) return null;
  if (field.type === "yesno") {
    if (text === "yes") return true;
    if (text === "no") return false;
    throw new CoverageError(`Pick yes or no for "${field.label}".`);
  }
  if (field.type === "money") {
    const cents = parseMoneyToCents(text);
    if (cents === null || cents < 0 || cents > MAX_LIMIT_CENTS) {
      throw new CoverageError(`Enter "${field.label}" in dollars.`);
    }
    return cents;
  }
  const n = Number(text.replace(/%$/, ""));
  const max = field.type === "years" ? MAX_TERM_YEARS : 100;
  if (!Number.isInteger(n) || n <= 0 || n > max) {
    throw new CoverageError(
      field.type === "years"
        ? `Enter "${field.label}" in whole years.`
        : `Enter "${field.label}" as a percent, like 80.`,
    );
  }
  return n;
}

// The form's cover fields (named coverage.<key>), checked. Blank fields are left out.
export function parseCoverage(kind: PolicyKind, form: Record<string, string>): Coverage {
  const coverage: Coverage = {};
  for (const field of COVERAGE_FIELDS[kind]) {
    const value = parseField(field, form[field.key] ?? "");
    if (value !== null) coverage[field.key] = value;
  }
  return coverage;
}

// A stored value as the form shows it.
export function fieldText(field: CoverageField, value: number | boolean | undefined): string {
  if (value === undefined) return "";
  if (field.type === "yesno") return value ? "yes" : "no";
  if (field.type === "money") return ((value as number) / 100).toFixed(0);
  return String(value);
}

// "$100,000", "Yes", "20 years", "80%".
export function valueWords(field: CoverageField, value: number | boolean): string {
  if (field.type === "yesno") return value ? "Yes" : "No";
  if (field.type === "money") return formatCents(value as number);
  if (field.type === "years") return `${value} years`;
  return `${value}%`;
}

// Each known limit as "label: value", in the order the kind lists them.
export function coverageLines(kind: PolicyKind, coverage: Coverage): string[] {
  return COVERAGE_FIELDS[kind].flatMap((field) =>
    field.key in coverage ? [`${field.label}: ${valueWords(field, coverage[field.key])}`] : [],
  );
}

// Car cover that pays only for damage to others: no collision and no comprehensive, both
// said. Unknown isn't liability only.
export const isLiabilityOnly = (kind: PolicyKind, coverage: Coverage) =>
  kind === "auto" && coverage.collision === false && coverage.comprehensive === false;
