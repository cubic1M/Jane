import {
  BACKDOOR_NOTE,
  BACKDOOR_STEPS,
  ROTH_AT_OR_BELOW_RATE,
  ROTH_IRA_PHASEOUT,
  TRADITIONAL_AT_OR_ABOVE_RATE,
} from "@/config/retirement-accounts";
import {
  CATCH_UP_AGE,
  EMPLOYEE_DEFERRAL_LIMIT_CENTS,
  IRA_CATCH_UP_CENTS,
  IRA_LIMIT_CENTS,
  SUPER_CATCH_UP_AGES,
  SUPER_CATCH_UP_CENTS,
  CATCH_UP_CENTS,
} from "@/config/retirement";
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

export function workplaceLimit(age: number) {
  const catchUp =
    age >= SUPER_CATCH_UP_AGES[0] && age <= SUPER_CATCH_UP_AGES[1]
      ? SUPER_CATCH_UP_CENTS
      : age >= CATCH_UP_AGE
        ? CATCH_UP_CENTS
        : 0;
  return { baseCents: EMPLOYEE_DEFERRAL_LIMIT_CENTS, catchUpCents: catchUp };
}

export function iraLimit(age: number) {
  return { baseCents: IRA_LIMIT_CENTS, catchUpCents: age >= CATCH_UP_AGE ? IRA_CATCH_UP_CENTS : 0 };
}

export function limitRows(input: {
  age: number;
  workplaceUsedCents: number;
  iraUsedCents: number;
}): LimitRow[] {
  const w = workplaceLimit(input.age);
  const i = iraLimit(input.age);
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
// the chat's answer.
export function matchPaceGap(
  plan: { payCents: number; matchRate: number; matchUpTo: number },
  employeeYtdCents: number,
  now: Date,
) {
  const monthsIn = now.getUTCMonth() + now.getUTCDate() / 31;
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
