import {
  DEFAULT_RETIREMENT_TAX_RATE,
  PLAN_WITHIN_YEARS,
  SPEND_SHARE_OF_PAY,
  SS_CLAIM_SHARE,
  SS_FULL_AGE,
} from "@/config/retirement-income";
import { RETIREMENT_AGE } from "@/config/retirement";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { currentAge } from "@/planning/investor-profile";
import {
  breakevenAge,
  drawOrder,
  estimateSsMonthly,
  paycheck,
  rmd,
  rmdStartAge,
  ssOptions,
  type Balances,
  type Paycheck,
  type SsOption,
} from "@/planning/retirement-income";
import { employerPlanFor } from "./employer-plan";
import { loadInvestments, type Investments } from "./holdings";
import { profileOf } from "./profile";

// Income in retirement (spec step 212, demo advice), for its page, Jane's answers and her
// tool: Social Security options, required minimum distributions, the order to draw, and a
// monthly paycheck with how long the money lasts. Inputs the person gave (their Social
// Security statement, when to retire, what they'd spend) are used first; the rest is
// estimated and labelled so.

type Options = { client?: PrismaClient; now?: Date; investments?: Investments };

export class RetirementIncomeError extends Error {}

const PRE_TAX = ["401k", "403b", "457b", "ira", "sep ira", "simple ira"];
const ROTH = ["roth", "roth 401k"];
const TAXABLE = ["brokerage", "stock plan", "mutual fund"];

export type RetirementIncomeView = {
  advice: boolean;
  age: number | null;
  // Within PLAN_WITHIN_YEARS of retirement, or retired.
  applies: boolean;
  retireAge: number;
  balances: Balances;
  ss: {
    fullMonthlyCents: number | null;
    // statement (the person's) or estimate (from pay).
    source: "statement" | "estimate" | null;
    options: SsOption[];
    breakeven62to67: number | null;
    breakeven67to70: number | null;
    startAge: number;
  };
  rmd: { startAge: number; firstYearCents: number | null; birthYear: number } | null;
  draw: ReturnType<typeof drawOrder>;
  spendMonthlyCents: number;
  spendFrom: "you" | "pay" | "none";
  taxRate: number;
  paycheck: Paycheck | null;
  inputs: {
    ssMonthlyCents: number | null;
    retireAge: number | null;
    ssStartAge: number | null;
    spendMonthlyCents: number | null;
  };
};

export async function loadRetirementIncome(
  userId: string,
  { client = defaultClient, now = new Date(), investments: loaded }: Options = {},
): Promise<RetirementIncomeView> {
  const db = scopedFor(userId, client);
  const [advice, answers, plan, saved, investments, estimate] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    employerPlanFor(userId, client),
    db.retirementIncomes.findFirst(),
    loaded ?? loadInvestments(userId, { client, now }),
    loadTaxEstimate(userId, { client, now }).catch(() => null),
  ]);
  const age = currentAge(answers, now.toISOString().slice(0, 10));
  const retireAge = saved?.retireAge ?? Math.max(age ?? 0, RETIREMENT_AGE);
  const sub = (s: string | null) => (s ?? "").toLowerCase();
  const sum = (kinds: string[]) =>
    investments.accounts
      .filter((a) => kinds.includes(sub(a.subtype)))
      .reduce((s, a) => s + (a.balanceCents ?? 0), 0);
  const balances: Balances = {
    taxableCents: sum(TAXABLE),
    preTaxCents: sum(PRE_TAX),
    rothCents: sum(ROTH),
  };
  const fullMonthly = saved?.ssMonthlyCents ?? (plan ? estimateSsMonthly(plan.payCents) : null);
  const startAge = saved?.ssStartAge ?? Math.max(retireAge, SS_FULL_AGE);
  const birthYear = age === null ? now.getUTCFullYear() - 45 : now.getUTCFullYear() - age;
  const taxRate = estimate?.estimate.marginalRate ?? DEFAULT_RETIREMENT_TAX_RATE;
  const spendFromPay = plan ? Math.round((plan.payCents * SPEND_SHARE_OF_PAY) / 12) : 0;
  const spend = saved?.spendMonthlyCents ?? spendFromPay;
  const applies = age !== null && age >= retireAge - PLAN_WITHIN_YEARS;
  const view: RetirementIncomeView = {
    advice,
    age,
    applies,
    retireAge,
    balances,
    ss: {
      fullMonthlyCents: fullMonthly,
      source: saved?.ssMonthlyCents ? "statement" : fullMonthly ? "estimate" : null,
      options: fullMonthly ? ssOptions(fullMonthly) : [],
      breakeven62to67: fullMonthly ? breakevenAge(fullMonthly, 62, 67) : null,
      breakeven67to70: fullMonthly ? breakevenAge(fullMonthly, 67, 70) : null,
      startAge,
    },
    rmd:
      age === null
        ? null
        : {
            startAge: rmdStartAge(birthYear),
            birthYear,
            firstYearCents:
              balances.preTaxCents > 0
                ? rmd(balances.preTaxCents, rmdStartAge(birthYear), birthYear)
                : null,
          },
    draw: drawOrder(balances),
    spendMonthlyCents: spend,
    spendFrom: saved?.spendMonthlyCents ? "you" : spendFromPay > 0 ? "pay" : "none",
    taxRate,
    paycheck: null,
    inputs: {
      ssMonthlyCents: saved?.ssMonthlyCents ?? null,
      retireAge: saved?.retireAge ?? null,
      ssStartAge: saved?.ssStartAge ?? null,
      spendMonthlyCents: saved?.spendMonthlyCents ?? null,
    },
  };
  if (age !== null && spend > 0) {
    const claim = Math.min(70, Math.max(62, startAge));
    const ssForPlan = fullMonthly ? Math.round(fullMonthly * SS_CLAIM_SHARE[claim]) : 0;
    view.paycheck = paycheck({
      age,
      retireAge,
      balances,
      yearlySavingCents: 0,
      spendMonthlyCents: spend,
      ssMonthlyCents: ssForPlan,
      ssStartAge: startAge,
      taxRate,
    });
  }
  return view;
}

export type RetirementIncomeForm = {
  ssMonthly: string;
  retireAge: string;
  ssStartAge: string;
  spendMonthly: string;
};

const dollars = (s: string, label: string): number | null => {
  if (!s.trim()) return null;
  const n = Math.round(Number(s.replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(n) || n < 0 || n > 50_000_000)
    throw new RetirementIncomeError(`Check the ${label}.`);
  return n;
};
const ageOf = (s: string, label: string, min: number, max: number): number | null => {
  if (!s.trim()) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n) || n < min || n > max)
    throw new RetirementIncomeError(`The ${label} should be between ${min} and ${max}.`);
  return n;
};

export async function saveRetirementIncome(
  userId: string,
  form: RetirementIncomeForm,
  { client = defaultClient }: Options = {},
) {
  const data = {
    ssMonthlyCents: dollars(form.ssMonthly, "Social Security amount"),
    retireAge: ageOf(form.retireAge, "retirement age", 50, 80),
    ssStartAge: ageOf(form.ssStartAge, "age to start Social Security", 62, 70),
    spendMonthlyCents: dollars(form.spendMonthly, "monthly spending"),
  };
  const db = scopedFor(userId, client);
  const existing = await db.retirementIncomes.findFirst({ select: { id: true } });
  if (existing) await db.retirementIncomes.updateMany({ where: { id: existing.id }, data });
  else await db.retirementIncomes.create({ data: { userId, ...data } });
  await logAudit(
    { type: "user", id: userId },
    "retirement_income_saved",
    { type: "user", id: userId },
    {},
  );
}
