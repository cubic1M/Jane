import type { FilingStatus } from "@/config/tax";

// Retirement accounts used fully (spec step 210, demo advice): Roth IRA income limits, and
// the bracket lines for Roth or traditional. Contribution limits live in
// src/config/retirement.ts (year and source there). FOR REVIEW: ESTIMATE TO VERIFY each
// year against the IRS's published limits.

// A Roth IRA can't be funded directly above these modified AGIs (2026): the allowed amount
// shrinks across the range and is zero at the top. Over it, the "backdoor" route.
export const ROTH_IRA_PHASEOUT: Readonly<
  Record<FilingStatus, { fromCents: number; toCents: number }>
> = {
  single: { fromCents: 15_300_000, toCents: 16_800_000 },
  married_joint: { fromCents: 24_200_000, toCents: 25_200_000 },
  married_separate: { fromCents: 0, toCents: 1_000_000 },
  head_of_household: { fromCents: 15_300_000, toCents: 16_800_000 },
};
export const ROTH_IRA_PHASEOUT_SOURCE = "IRS Notice 2025-67 (2026 Roth IRA income limits)";

// Roth or traditional by the federal bracket on the next dollar (step 120's estimate): at or
// below this rate paying the tax now usually wins; at or above the second, the deduction now
// usually wins; between, a mix. A rule of thumb, not a promise.
export const ROTH_AT_OR_BELOW_RATE = 0.12;
export const TRADITIONAL_AT_OR_ABOVE_RATE = 0.24;
export const ROTH_RULE_SOURCE = "Common planner rule of thumb by federal bracket";

// The steps of a backdoor Roth, in plain words.
export const BACKDOOR_STEPS = [
  "Put money in a traditional IRA, with no deduction taken.",
  "Move it to a Roth IRA soon after (a conversion).",
  "File the IRS's Form 8606 with your return.",
] as const;
export const BACKDOOR_NOTE =
  "If you already have money in traditional, SEP or SIMPLE IRAs, the conversion is partly taxed (the pro-rata rule): ask a tax professional first.";

// Jane brings these up only when they matter this much a year (cents).
export const MATCH_MIN_MISSED_CENTS = 10_000;
export const ROOM_MIN_CENTS = 100_000;
// Demo Roth IRA: the account the demo bank can add (a stand-in).
export const DEMO_IRA_FUND = "KTSIX";
// Account subtypes (Plaid) whose contributions count against each limit.
export const WORKPLACE_SUBTYPES: readonly string[] = ["401k", "403b", "457b", "roth 401k"];
export const IRA_SUBTYPES: readonly string[] = ["ira", "roth", "sep ira", "simple ira"];
// Money paid into an account.
export const CONTRIBUTION_TX_SUBTYPES: readonly string[] = ["contribution", "deposit"];
