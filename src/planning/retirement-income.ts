import { INFLATION, RETURN_HIGH, RETURN_LOW } from "@/config/market-assumptions";
import {
  PLAN_TO_AGE,
  RMD_DIVISORS,
  RMD_LAST_AGE,
  RMD_START_AGE,
  SS_BEND_POINTS_CENTS,
  SS_CLAIM_SHARE,
  SS_COMPARE_TO_AGE,
  SS_FULL_AGE,
  TAXABLE_GAINS_SHARE,
} from "@/config/retirement-income";
import { futureValue } from "./retirement";

// Income in retirement (spec step 212, demo advice). Pure. Social Security at 62, full age
// and 70; required minimum distributions; the order to draw from accounts; and a monthly
// retirement paycheck with how long the money lasts. All in today's dollars, as a range at
// the assumed returns: never a promise.

const real = (nominal: number) => (1 + nominal) / (1 + INFLATION.value) - 1;
const LOW = real(RETURN_LOW.value);
const HIGH = real(RETURN_HIGH.value);

// A monthly benefit at full retirement age from yearly pay (the bend-point formula).
export function estimateSsMonthly(payCents: number): number {
  const aime = payCents / 12;
  const [b1, b2] = SS_BEND_POINTS_CENTS;
  const pia =
    0.9 * Math.min(aime, b1) +
    0.32 * Math.max(0, Math.min(aime, b2) - b1) +
    0.15 * Math.max(0, aime - b2);
  return Math.round(pia);
}

export type SsOption = { age: number; monthlyCents: number; lifetimeToAgeCents: number };

// The benefit at each of 62, the full age and 70, and what each pays in total by age 85.
export function ssOptions(fullMonthlyCents: number): SsOption[] {
  return [62, SS_FULL_AGE, 70].map((age) => {
    const monthly = Math.round(fullMonthlyCents * SS_CLAIM_SHARE[age]);
    return {
      age,
      monthlyCents: monthly,
      lifetimeToAgeCents: monthly * 12 * Math.max(0, SS_COMPARE_TO_AGE - age),
    };
  });
}

// The age by which waiting from `early` to `late` has paid more in total.
export function breakevenAge(fullMonthlyCents: number, early: number, late: number): number | null {
  const e = fullMonthlyCents * SS_CLAIM_SHARE[early] * 12;
  const l = fullMonthlyCents * SS_CLAIM_SHARE[late] * 12;
  if (l <= e) return null;
  // e*(x-early) = l*(x-late)
  return Math.round(((l * late - e * early) / (l - e)) * 10) / 10;
}

export const rmdStartAge = RMD_START_AGE;

// The minimum a person must take out of pre-tax accounts at `age` (0 before it starts).
export function rmd(balanceCents: number, age: number, birthYear: number): number {
  if (age < RMD_START_AGE(birthYear)) return 0;
  const divisor = RMD_DIVISORS[Math.min(age, RMD_LAST_AGE)];
  return Math.round(balanceCents / divisor);
}

export type Balances = { taxableCents: number; preTaxCents: number; rothCents: number };

// The order to draw: taxable first (only the gains are taxed), then pre-tax (taxed, and the
// required minimums come from here anyway), Roth last (tax-free and keeps growing).
export function drawOrder(b: Balances): { key: keyof Balances; label: string; cents: number }[] {
  const order = [
    {
      key: "taxableCents" as const,
      label: "Taxable accounts first: only the gains are taxed",
      cents: b.taxableCents,
    },
    {
      key: "preTaxCents" as const,
      label:
        "Then pre-tax accounts (401(k), traditional IRA): taxed as income, and required minimums come from here",
      cents: b.preTaxCents,
    },
    {
      key: "rothCents" as const,
      label: "Roth last: tax-free, and it keeps growing",
      cents: b.rothCents,
    },
  ];
  return order.filter((o) => o.cents > 0);
}

export type PaycheckInput = {
  age: number;
  retireAge: number;
  balances: Balances;
  // Yearly saving until retirement (today's dollars).
  yearlySavingCents: number;
  // Wanted monthly spending in retirement (today's dollars, before tax).
  spendMonthlyCents: number;
  // Social Security: monthly at the claiming age, and when it starts.
  ssMonthlyCents: number;
  ssStartAge: number;
  // The federal rate on the next dollar, for taxes on withdrawals.
  taxRate: number;
};

// Years the money lasts (to PLAN_TO_AGE at most) at a real return, withdrawing what
// spending needs beyond Social Security plus the tax on the pre-tax share.
export function lastsToAge(input: PaycheckInput, r: number): number {
  const total = input.balances.taxableCents + input.balances.preTaxCents + input.balances.rothCents;
  const preTaxShare = total > 0 ? input.balances.preTaxCents / total : 0;
  const taxableShare = total > 0 ? input.balances.taxableCents / total : 0;
  const taxShare = input.taxRate * (preTaxShare + taxableShare * TAXABLE_GAINS_SHARE);
  const years = Math.max(0, input.retireAge - input.age);
  let balance = futureValue(total, input.yearlySavingCents, years, r);
  for (let age = input.retireAge; age < PLAN_TO_AGE; age += 1) {
    const ss = age >= input.ssStartAge ? input.ssMonthlyCents * 12 : 0;
    const need = Math.max(0, input.spendMonthlyCents * 12 - ss);
    // Gross up for tax on what comes out.
    const draw = taxShare < 1 ? need / (1 - taxShare) : need;
    if (balance < draw) return age + (draw > 0 ? balance / draw : 0);
    balance = (balance - draw) * (1 + r);
  }
  return PLAN_TO_AGE;
}

export type Paycheck = {
  // The most monthly spending (today's dollars, before tax) that lasts to PLAN_TO_AGE.
  sustainableMonthly: { lowCents: number; highCents: number };
  // For the wanted spending: how long it lasts, low to high returns.
  lasts: { lowAge: number; highAge: number };
  lastsToPlan: boolean;
};

export function paycheck(input: PaycheckInput): Paycheck {
  // The sustainable spending: bisect on spend so that the money just lasts to the plan age.
  const find = (r: number) => {
    let lo = 0;
    let hi = 5_000_000;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (lastsToAge({ ...input, spendMonthlyCents: mid }, r) >= PLAN_TO_AGE) lo = mid;
      else hi = mid;
    }
    return Math.round(lo);
  };
  const lowAge = lastsToAge(input, LOW);
  const highAge = lastsToAge(input, HIGH);
  return {
    sustainableMonthly: { lowCents: find(LOW), highCents: find(HIGH) },
    lasts: { lowAge: Math.round(lowAge * 10) / 10, highAge: Math.round(highAge * 10) / 10 },
    lastsToPlan: lowAge >= PLAN_TO_AGE,
  };
}
