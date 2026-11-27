import {
  BACKDOOR_NOTE,
  BACKDOOR_STEPS,
  ROTH_AT_OR_BELOW_RATE,
  ROTH_IRA_PHASEOUT,
  TRADITIONAL_AT_OR_ABOVE_RATE,
} from "@/config/retirement-accounts";
import { CATCH_UP_AGE, retirementLimits, SUPER_CATCH_UP_AGES } from "@/config/retirement";
import type { FilingStatus } from "@/config/tax";

// Retirement accounts used fully (spec step 210, demo advice). Pure. Every limit with
// what's used and what's left, across accounts; the match left on the table in dollars a
// year; Roth or traditional by bracket; and whether a Roth IRA is open to the person's
// income or needs the backdoor route.

export type LimitRow = {
  key: "workplace" | "ira";
  label: string;
  limitCents: number;
  catchUpCents: number;
  usedCents: number;
  roomCents: number;
};

function workplaceLimit(age: number, year: number) {
  const limits = retirementLimits(year);
  const catchUp =
    age >= SUPER_CATCH_UP_AGES[0] && age <= SUPER_CATCH_UP_AGES[1]
      ? limits.superCatchUpCents
      : age >= CATCH_UP_AGE
        ? limits.catchUpCents
        : 0;
  return { baseCents: limits.employeeDeferralCents, catchUpCents: catchUp };
}

function iraLimit(age: number, year: number) {
  const limits = retirementLimits(year);
  return {
    baseCents: limits.iraCents,
    catchUpCents: age >= CATCH_UP_AGE ? limits.iraCatchUpCents : 0,
  };
}

export function limitRows(input: {
  age: number;
  // The calendar year of the contributions (the person's own day): the limits are that year's.
  year: number;
  workplaceUsedCents: number;
  iraUsedCents: number;
}): LimitRow[] {
  const w = workplaceLimit(input.age, input.year);
  const i = iraLimit(input.age, input.year);
  const row = (
    key: LimitRow["key"],
    label: string,
    l: { baseCents: number; catchUpCents: number },
    used: number,
  ): LimitRow => {
    const limit = l.baseCents + l.catchUpCents;
    return {
      key,
      label,
      limitCents: limit,
      catchUpCents: l.catchUpCents,
      usedCents: used,
      roomCents: Math.max(0, limit - used),
    };
  };
  return [
    row("workplace", "401(k), 403(b) or 457 at work", w, input.workplaceUsedCents),
    row("ira", "IRAs (traditional and Roth together)", i, input.iraUsedCents),
  ];
}

// Roth or traditional by the federal bracket on the next dollar.
export function rothByBracket(marginalRate: number | null): "roth" | "traditional" | "mix" | null {
  if (marginalRate === null) return null;
  if (marginalRate <= ROTH_AT_OR_BELOW_RATE) return "roth";
  if (marginalRate >= TRADITIONAL_AT_OR_ABOVE_RATE) return "traditional";
  return "mix";
}

export type RothAccess =
  | { kind: "direct"; allowedShare: 1 }
  | { kind: "partial"; allowedShare: number }
  | { kind: "backdoor"; allowedShare: 0; steps: readonly string[]; note: string };

// Whether a Roth IRA can be funded directly at this income, by filing status.
export function rothAccess(magiCents: number, filing: FilingStatus): RothAccess {
  const { fromCents, toCents } = ROTH_IRA_PHASEOUT[filing];
  if (magiCents <= fromCents) return { kind: "direct", allowedShare: 1 };
  if (magiCents >= toCents) {
    return { kind: "backdoor", allowedShare: 0, steps: BACKDOOR_STEPS, note: BACKDOOR_NOTE };
  }
  return { kind: "partial", allowedShare: 1 - (magiCents - fromCents) / (toCents - fromCents) };
}

// The employee rate (share of pay) that gets the whole match, and what the gap costs a year.
export function matchGap(input: {
  payCents: number;
  employeeCents: number;
  matchRate: number;
  matchUpTo: number;
}) {
  const rate = input.payCents > 0 ? input.employeeCents / input.payCents : 0;
  const shortRate = Math.max(0, input.matchUpTo - rate);
  return {
    employeeRate: rate,
    fullMatchRate: input.matchUpTo,
    missedCents: Math.round(shortRate * input.payCents * input.matchRate),
    // More from the person each year to get all of it.
    extraEmployeeCents: Math.round(shortRate * input.payCents),
  };
}

// The match left on the table at this year's pace: what the person has put in so far, scaled to
// a full year, against full-year pay. The one calculation behind the brief's suggestion and
// the chat's answer. "So far" is on the person's own calendar and ends at the newest day the
// account's data covers (`through`), never past today: an account read weeks ago, or 7pm in Los
// Angeles (already tomorrow in UTC), isn't a slower pace (gate C's calendar sweep, 11-15).
export function matchPaceGap(
  plan: { payCents: number; matchRate: number; matchUpTo: number },
  employeeYtdCents: number,
  { today, through }: { today: string; through: string | null },
) {
  const monthsIn = yearShare(today, through) * 12;
  return {
    ...matchGap({
      payCents: plan.payCents,
      employeeCents: monthsIn > 0 ? Math.round((employeeYtdCents / monthsIn) * 12) : 0,
      matchRate: plan.matchRate,
      matchUpTo: plan.matchUpTo,
    }),
    matchRate: plan.matchRate,
  };
}

const DAY_MS = 86_400_000;

// The share of `today`'s year gone by its end, or by `through` when the data ends earlier in the
// same year. Pure.
export function yearShare(today: string, through: string | null): number {
  const year = Number(today.slice(0, 4));
  const end = through && through < today && through.startsWith(`${year}-`) ? through : today;
  const start = Date.UTC(year, 0, 1);
  const days = (Date.parse(`${end}T00:00:00Z`) - start) / DAY_MS + 1;
  return days / ((Date.UTC(year + 1, 0, 1) - start) / DAY_MS);
}
