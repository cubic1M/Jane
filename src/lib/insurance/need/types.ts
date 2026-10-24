import type { PolicyKind } from "@/config/insurance";
import type { SelfEmployment } from "@/lib/insurance/business-rules";

// What cover a person needs (spec step 274): one shape for every calculator, so the chat, the
// page, the detectors and the option cards (steps 275–279) all read the same numbers.

export type NeedKind =
  | "life"
  | "disability"
  | "umbrella"
  | "deductible"
  | "auto_liability"
  | "home_liability"
  | "renters_liability"
  // Spec step 201: cover for what they earn on the side or in a business.
  | "business_liability"
  | "professional_liability"
  | "business_equipment";

export type NeedLine = { label: string; cents: number; adds: boolean };

export type Need = {
  kind: NeedKind;
  // Whether this need is about the person at all: no dependants means no life-cover need, and
  // net worth under the line means no umbrella need.
  applies: boolean;
  // total: a sum of cover (life, umbrella, liability); per_month: a benefit paid each month
  // (disability).
  unit: "total" | "per_month";
  // What they need, what they have, and what is missing (never negative).
  needCents: number;
  haveCents: number;
  gapCents: number;
  // For a deductible: whether a higher or lower one fits their cash, or it already fits.
  direction?: "raise" | "lower" | "ok";
  // For a deductible to raise: the next step up the ladder their cash carries, a smaller move
  // than the largest they could take.
  stepCents?: number;
  // The working, line by line, for "More details".
  lines: NeedLine[];
  // One sentence with the person's own figures.
  summary: string;
  // The policy this is about (deductibles and liability), when it is one.
  policyId: string | null;
  // A term length, for life cover.
  termYears?: number;
};

export type NeedPolicy = {
  id: string;
  kind: PolicyKind;
  status: string;
  deductibleCents: number | null;
  coverage: Record<string, number | boolean>;
};

export type NeedInput = {
  yearlyPayCents: number | null;
  // People who depend on the income.
  dependants: number;
  mortgageCents: number;
  otherDebtCents: number;
  mortgageYearsLeft: number | null;
  // Liquid savings (counted against the life need) and cash in the bank (the deductible's cushion).
  savingsCents: number;
  cashCents: number;
  // Everything they own less everything they owe, when known.
  netWorthCents: number | null;
  // Life cover through work, which no policy on file shows.
  workLifeCoverCents: number;
  policies: readonly NeedPolicy[];
  // Spec step 201: what their income and spending say about a business or side work.
  business?: SelfEmployment | null;
};
