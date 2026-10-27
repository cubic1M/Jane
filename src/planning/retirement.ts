import { INFLATION, RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import {
  CATCH_UP_AGE,
  CATCH_UP_CENTS,
  EMPLOYEE_DEFERRAL_LIMIT_CENTS,
  MAX_SUGGESTED_RAISE,
  RETIREMENT_AGE,
  ROTH_BELOW_PAY_CENTS,
  SUPER_CATCH_UP_AGES,
  SUPER_CATCH_UP_CENTS,
  TARGET_TIMES_PAY,
  TRADITIONAL_ABOVE_PAY_CENTS,
  WITHDRAWAL_RATE,
} from "@/config/retirement";
import { formatWholeDollars as dollars } from "@/lib/money";
import { formatPercentTenths } from "@/lib/percent";

// On track for retirement? (spec step 132, demo advice). From the person's retirement
// balances and what goes in each year, what they could have at 67 as a range in today's
// dollars (low and high returns after inflation), against a target; the employer match
// captured or missed, Roth or traditional, catch-up contributions, and what to change to
// get on track. Pure. A range, never a promise.

export type EmployerPlan = {
  // Yearly pay before deductions.
  payCents: number;
  // The employer adds `matchRate` of what the person puts in, on up to `matchUpTo` of pay.
  matchRate: number;
  matchUpTo: number;
};

export type RetirementInput = {
  age: number;
  balanceCents: number;
  // Over the last 12 months.
  employeeCents: number;
  employerCents: number;
  // Null when Jane doesn't know the person's pay or plan.
  plan: EmployerPlan | null;
};

export type Range = { lowCents: number; highCents: number };

export type RetirementPlan = {
  years: number;
  retirementAge: number;
  // What the balance could grow to by then, in today's dollars.
  projection: Range;
  // What that could pay out a year (the withdrawal rule of thumb).
  yearlyIncome: Range;
  targetCents: number | null;
  status: "on_track" | "maybe" | "behind" | "unknown";
  match: {
    // The share of pay the person puts in now.
    employeeRate: number;
    captured: boolean;
    // The employer money left on the table each year.
    missedCents: number;
    // Put in this share of pay to get all of it.
    fullMatchRate: number;
  } | null;
  // How much more the person may put in this year, with any catch-up.
  roomCents: number;
  catchUpCents: number;
  rothOrTraditional: "roth" | "traditional" | "mix" | null;
  // `figures`: every amount the words name, for the guardrails.
  changes: { what: string; why: string; extraYearlyCents: number; figures: number[] }[];
};

// Growth after inflation.
const real = (nominal: number) => (1 + nominal) / (1 + INFLATION.value) - 1;

// What `balance` and a yearly `contribution` (at each year's end, kept up with inflation)
// grow to in `years` at real rate `r`.
export function futureValue(balance: number, contribution: number, years: number, r: number) {
  const growth = (1 + r) ** years;
  const annuity = r === 0 ? years : (growth - 1) / r;
  return Math.round(balance * growth + contribution * annuity);
}

// The extra yearly contribution that closes `gap` in `years` at real rate `r`.
export function yearlyToClose(gap: number, years: number, r: number) {
  if (gap <= 0) return 0;
  const annuity = r === 0 ? years : ((1 + r) ** years - 1) / r;
  return Math.ceil(gap / annuity);
}

export const catchUpFor = (age: number) =>
  age >= SUPER_CATCH_UP_AGES[0] && age <= SUPER_CATCH_UP_AGES[1]
    ? SUPER_CATCH_UP_CENTS
    : age >= CATCH_UP_AGE
      ? CATCH_UP_CENTS
      : 0;

export function rothOrTraditional(payCents: number | null): RetirementPlan["rothOrTraditional"] {
  if (payCents === null) return null;
  if (payCents < ROTH_BELOW_PAY_CENTS) return "roth";
  if (payCents > TRADITIONAL_ABOVE_PAY_CENTS) return "traditional";
  return "mix";
}

export function retirementPlan(input: RetirementInput): RetirementPlan {
  const years = Math.max(0, RETIREMENT_AGE - input.age);
  const yearly = input.employeeCents + input.employerCents;
  const project = (nominal: number) =>
    futureValue(input.balanceCents, yearly, years, real(nominal));
  const projection = { lowCents: project(RETURN_LOW.value), highCents: project(RETURN_HIGH.value) };
  const targetCents = input.plan ? input.plan.payCents * TARGET_TIMES_PAY : null;
  const status =
    targetCents === null
      ? "unknown"
      : projection.lowCents >= targetCents
        ? "on_track"
        : projection.highCents >= targetCents
          ? "maybe"
          : "behind";

  const plan = input.plan;
  const match = plan
    ? (() => {
        const employeeRate = plan.payCents > 0 ? input.employeeCents / plan.payCents : 0;
        const short = Math.max(0, plan.matchUpTo - employeeRate);
        return {
          employeeRate,
          captured: short < 0.0005,
          missedCents: Math.round(short * plan.payCents * plan.matchRate),
          fullMatchRate: plan.matchUpTo,
        };
      })()
    : null;

  const catchUpCents = catchUpFor(input.age);
  const roomCents = Math.max(0, EMPLOYEE_DEFERRAL_LIMIT_CENTS + catchUpCents - input.employeeCents);

  const changes: RetirementPlan["changes"] = [];
  if (match && !match.captured && plan) {
    const extra = Math.round((match.fullMatchRate - match.employeeRate) * plan.payCents);
    changes.push({
      what: `Raise your 401(k) contribution from ${formatPercentTenths(match.employeeRate)} to ${formatPercentTenths(match.fullMatchRate)} of your pay.`,
      why: `Your employer adds ${Math.round(plan.matchRate * 100)}% of what you put in, on up to ${formatPercentTenths(plan.matchUpTo)} of your pay. At ${formatPercentTenths(match.employeeRate)} you leave about ${dollars(match.missedCents)} a year of their money on the table.`,
      extraYearlyCents: extra,
      figures: [match.missedCents, extra],
    });
  }
  if (targetCents !== null && status !== "on_track" && years > 0 && plan) {
    // What closes the gap at the low return, beyond the match change, within the limits.
    const withMatch = changes.reduce(
      (sum, c) => sum + c.extraYearlyCents * (1 + plan.matchRate),
      0,
    );
    const low = real(RETURN_LOW.value);
    const reach = futureValue(input.balanceCents, yearly + withMatch, years, low);
    const needed = yearlyToClose(targetCents - reach, years, low);
    const already = changes.reduce((s, c) => s + c.extraYearlyCents, 0);
    const room = Math.max(0, roomCents - already);
    const step = Math.min(needed, room, Math.round(plan.payCents * MAX_SUGGESTED_RAISE));
    if (step >= 100_00) {
      changes.push({
        what: `Put in about ${dollars(step)} more a year (${formatPercentTenths(step / plan.payCents)} of your pay).`,
        why:
          step >= needed
            ? `That would get the low end of your range to the target of ${dollars(targetCents)} by ${RETIREMENT_AGE}.`
            : `It's a step towards the target of ${dollars(targetCents)} by ${RETIREMENT_AGE}; the rest would take about ${dollars(needed - step)} more a year, or working longer.`,
        extraYearlyCents: step,
        figures: [step, targetCents, Math.max(0, needed - step)],
      });
    }
  }
  // Catch-up room is for people still saving towards retirement, not someone past it.
  if (catchUpCents > 0 && years > 0) {
    changes.push({
      what: `Use catch-up contributions: from ${CATCH_UP_AGE} you can put in ${dollars(catchUpCents)} a year above the usual limit.`,
      why: "It's extra room to save, only for people your age.",
      extraYearlyCents: 0,
      figures: [catchUpCents],
    });
  }

  return {
    years,
    retirementAge: RETIREMENT_AGE,
    projection,
    yearlyIncome: {
      lowCents: Math.round(projection.lowCents * WITHDRAWAL_RATE),
      highCents: Math.round(projection.highCents * WITHDRAWAL_RATE),
    },
    targetCents,
    status,
    match,
    roomCents,
    catchUpCents,
    rothOrTraditional: rothOrTraditional(plan?.payCents ?? null),
    changes,
  };
}

export const ROTH_WORDS: Record<NonNullable<RetirementPlan["rothOrTraditional"]>, string> = {
  roth: "Roth: at your pay you're likely in a low tax bracket, so paying the tax now and taking it out tax-free later usually comes out ahead.",
  traditional:
    "Traditional: at your pay you're likely in a high tax bracket, so the tax saved now usually beats paying it later.",
  mix: "A mix of Roth and traditional: at your pay neither clearly wins, and having both gives you choices about tax later.",
};
