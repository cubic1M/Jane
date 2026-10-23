import { PROPERTY_TAX_PAYEE } from "@/config/home-taxes";
import {
  BUSINESS_SALES_CATEGORIES,
  BUSINESS_SALES_MIN_DEPOSITS,
  BUSINESS_SALES_PAYEE,
  INCOME_KINDS,
  PAY_FREQUENCIES,
} from "@/config/tax";
import type { PayStub } from "@/lib/payroll/types";
import type { EstimateIncome } from "./tax-estimate";

// The year's income for the tax estimate (spec step 120): so far, from the person's
// transactions and pay stubs, and projected to the end of the year at the same pace. Pure;
// dates are YYYY-MM-DD and amounts follow Plaid (positive is money out).

export type PaySoFar = {
  grossCents: number;
  // Federal (box 1) wages: gross less pre-tax retirement and other pre-tax deductions.
  wagesCents: number;
  // Social Security wages: gross less other pre-tax deductions (401(k) still counts).
  socialSecurityWagesCents: number;
  federalWithheldCents: number;
  stateWithheldCents: number;
  retirementCents: number;
  otherPretaxCents: number;
};

const ZERO_PAY: PaySoFar = {
  grossCents: 0,
  wagesCents: 0,
  socialSecurityWagesCents: 0,
  federalWithheldCents: 0,
  stateWithheldCents: 0,
  retirementCents: 0,
  otherPretaxCents: 0,
};

export type PayPicture = {
  // Where the figures come from: the demo bank's stand-in stubs, the person's own pay
  // stub figures, or nothing (only deposits).
  source: "demo" | "pay_stub" | "none";
  employers: string[];
  perYear: number | null;
  frequency: string | null;
  soFar: PaySoFar;
  projected: PaySoFar;
  // The day the year-to-date figures are as of.
  asOf: string | null;
};

const DAY_MS = 86_400_000;
const daysInYear = (year: number) => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;

// How much of the year has gone, by today: 1 for a year that's over.
export function yearElapsed(year: number, today: string): number {
  const start = Date.UTC(year, 0, 1);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (now >= Date.UTC(year + 1, 0, 1)) return 1;
  if (now <= start) return 0;
  return (now - start) / DAY_MS / daysInYear(year);
}

const scale = (pay: PaySoFar, by: number): PaySoFar =>
  Object.fromEntries(Object.entries(pay).map(([k, v]) => [k, Math.round(v * by)])) as PaySoFar;

const add = (a: PaySoFar, b: PaySoFar): PaySoFar =>
  Object.fromEntries(
    Object.keys(a).map((k) => [k, a[k as keyof PaySoFar] + b[k as keyof PaySoFar]]),
  ) as PaySoFar;

function fromStub(s: PayStub): PaySoFar {
  return {
    grossCents: s.grossCents,
    wagesCents: s.grossCents - s.retirementCents - s.otherPretaxCents,
    socialSecurityWagesCents: s.grossCents - s.otherPretaxCents,
    federalWithheldCents: s.federalWithheldCents,
    stateWithheldCents: s.stateWithheldCents,
    retirementCents: s.retirementCents,
    otherPretaxCents: s.otherPretaxCents,
  };
}

// Paychecks a year from the usual gap between paydays. Twice a month and every two weeks
// both have gaps of about two weeks: every two weeks has a month with three paydays now and
// then; twice a month never does.
export function payFrequency(dates: string[]): { perYear: number; label: string } | null {
  const sorted = [...dates].sort();
  if (sorted.length < 2) return null;
  const gaps = sorted
    .slice(1)
    .map((d, i) => (Date.parse(d) - Date.parse(sorted[i])) / DAY_MS)
    .sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const match = PAY_FREQUENCIES.find((f) => median <= f.maxGap);
  if (!match) return null;
  if (match.perYear === 26 || match.perYear === 24) {
    const perMonth = new Map<string, number>();
    for (const d of sorted) perMonth.set(d.slice(0, 7), (perMonth.get(d.slice(0, 7)) ?? 0) + 1);
    const twice = PAY_FREQUENCIES.find((f) => f.perYear === 24)!;
    const fortnightly = PAY_FREQUENCIES.find((f) => f.perYear === 26)!;
    const pick = [...perMonth.values()].some((n) => n >= 3) ? fortnightly : twice;
    return { perYear: pick.perYear, label: pick.label };
  }
  return { perYear: match.perYear, label: match.label };
}

// Paydays still to come in the year after the last one: by the calendar for twice a month
// and monthly pay, by the gap otherwise.
export function paychecksLeft(lastPayDate: string, perYear: number): number {
  const month = Number(lastPayDate.slice(5, 7));
  const day = Number(lastPayDate.slice(8, 10));
  if (perYear === 24) return 2 * (12 - month) + (day < 15 ? 1 : 0);
  if (perYear === 12) return 12 - month;
  const yearEnd = Date.UTC(Number(lastPayDate.slice(0, 4)), 11, 31);
  const daysLeft = (yearEnd - Date.parse(`${lastPayDate}T00:00:00Z`)) / DAY_MS;
  return Math.max(0, Math.floor(daysLeft / (perYear === 52 ? 7 : 14)));
}

// From pay stubs: the year so far, and the rest of the year's paychecks like the average.
export function payFromStubs(stubs: PayStub[], year: number, today: string): PayPicture {
  // By date, whatever order they came in: the last one decides how many paychecks are left.
  stubs = [...stubs].sort((a, b) => a.payDate.localeCompare(b.payDate));
  const inYear = stubs.filter((s) => Number(s.payDate.slice(0, 4)) === year && s.payDate <= today);
  const soFar = inYear.map(fromStub).reduce(add, ZERO_PAY);
  const frequency = payFrequency(stubs.map((s) => s.payDate));
  const done = yearElapsed(year, today) >= 1;
  const last = inYear.at(-1)?.payDate;
  const left = done || !frequency || !last ? 0 : paychecksLeft(last, frequency.perYear);
  const average = inYear.length > 0 ? scale(soFar, 1 / inYear.length) : ZERO_PAY;
  return {
    source: "demo",
    employers: [...new Set(inYear.map((s) => s.employer))],
    perYear: frequency?.perYear ?? null,
    frequency: frequency?.label ?? null,
    soFar,
    projected: add(soFar, scale(average, left)),
    asOf: inYear.at(-1)?.payDate ?? null,
  };
}

export type PayYtd = {
  asOf: string;
  grossCents: number;
  federalCents: number;
  stateCents: number;
  retirementCents: number;
  pretaxCents: number;
};

// From the person's own pay stub figures, year to date: projected at the same pace.
export function payFromYtd(ytd: PayYtd, year: number, today: string): PayPicture {
  const soFar: PaySoFar = {
    grossCents: ytd.grossCents,
    wagesCents: ytd.grossCents - ytd.retirementCents - ytd.pretaxCents,
    socialSecurityWagesCents: ytd.grossCents - ytd.pretaxCents,
    federalWithheldCents: ytd.federalCents,
    stateWithheldCents: ytd.stateCents,
    retirementCents: ytd.retirementCents,
    otherPretaxCents: ytd.pretaxCents,
  };
  const sameYear = Number(ytd.asOf.slice(0, 4)) === year;
  const elapsed = sameYear ? yearElapsed(year, ytd.asOf) : 0;
  const yearDone = yearElapsed(year, today) >= 1;
  return {
    source: "pay_stub",
    employers: [],
    perYear: null,
    frequency: null,
    soFar: sameYear ? soFar : ZERO_PAY,
    projected: !sameYear
      ? ZERO_PAY
      : yearDone || elapsed >= 1
        ? soFar
        : scale(soFar, 1 / Math.max(elapsed, 1 / 365)),
    asOf: ytd.asOf,
  };
}

export const NO_PAY = (): PayPicture => ({
  source: "none",
  employers: [],
  perYear: null,
  frequency: null,
  soFar: ZERO_PAY,
  projected: ZERO_PAY,
  asOf: null,
});

export type IncomeTransaction = {
  date: string;
  amountCents: number;
  pfcDetailed: string | null;
  description: string;
  merchantName: string | null;
};

// Investment account cash flows (Plaid Investments): dividends and interest.
export type InvestmentCash = { date: string; amountCents: number; subtype: string };

const categories = (kind: keyof typeof INCOME_KINDS): readonly string[] =>
  INCOME_KINDS[kind].categories;

export const QUALIFIED = new Set(["qualified dividend", "long-term capital gain"]);
export const DIVIDENDS = new Set([
  "dividend",
  "qualified dividend",
  "non-qualified dividend",
  "long-term capital gain",
  "short-term capital gain",
]);

export type OtherIncome = Omit<EstimateIncome, "wagesCents" | "socialSecurityWagesCents">;

// Income other than wages so far: freelance (less business expenses, from step 123),
// interest, dividends, rent, pensions, unemployment.
export function otherIncomeSoFar(
  transactions: IncomeTransaction[],
  investmentCash: InvestmentCash[],
  year: number,
  businessExpensesCents = 0,
): OtherIncome {
  const inYear = (d: string) => Number(d.slice(0, 4)) === year;
  const money = (list: readonly string[]) =>
    transactions
      .filter(
        (t) =>
          inYear(t.date) &&
          t.amountCents < 0 &&
          t.pfcDetailed !== null &&
          list.includes(t.pfcDetailed),
      )
      .reduce((sum, t) => sum - t.amountCents, 0);
  const cash = investmentCash.filter((c) => inYear(c.date) && c.amountCents < 0);
  const dividends = cash
    .filter((c) => DIVIDENDS.has(c.subtype))
    .reduce((s, c) => s - c.amountCents, 0);
  const qualified = cash
    .filter((c) => QUALIFIED.has(c.subtype))
    .reduce((s, c) => s - c.amountCents, 0);
  const brokerageInterest = cash
    .filter((c) => c.subtype === "interest")
    .reduce((s, c) => s - c.amountCents, 0);
  return {
    selfEmploymentCents: money(categories("self_employed")) - businessExpensesCents,
    interestCents: money(["INCOME_INTEREST_EARNED"]) + brokerageInterest,
    dividendsCents: money(["INCOME_DIVIDENDS"]) + dividends,
    qualifiedDividendsCents: qualified,
    shortTermGainsCents: 0,
    longTermGainsCents: 0,
    rentalCents: money(categories("rental")),
    retirementCents: money(categories("retirement")),
    unemploymentCents: money(categories("unemployment")),
  };
}

// The rest of the year at the same pace. Gains aren't projected: they happen when you sell.
export function projectOther(soFar: OtherIncome, year: number, today: string): OtherIncome {
  const elapsed = yearElapsed(year, today);
  if (elapsed >= 1 || elapsed <= 0) return soFar;
  const pace = (cents: number) => Math.round(cents / elapsed);
  return {
    ...soFar,
    selfEmploymentCents: pace(soFar.selfEmploymentCents),
    interestCents: pace(soFar.interestCents),
    dividendsCents: pace(soFar.dividendsCents),
    qualifiedDividendsCents: pace(soFar.qualifiedDividendsCents),
    rentalCents: pace(soFar.rentalCents),
    retirementCents: pace(soFar.retirementCents),
    unemploymentCents: pace(soFar.unemploymentCents),
  };
}

// A shop's card sales so far in the year (BUSINESS_SALES_PAYEE), not already counted as
// freelance income.
export function businessSalesSoFar(transactions: IncomeTransaction[], year: number): number {
  const freelance: readonly string[] = categories("self_employed");
  const sales = transactions.filter(
    (t) =>
      Number(t.date.slice(0, 4)) === year &&
      t.amountCents < 0 &&
      !freelance.includes(t.pfcDetailed ?? "") &&
      (BUSINESS_SALES_CATEGORIES as readonly string[]).includes(t.pfcDetailed ?? "") &&
      BUSINESS_SALES_PAYEE.test(t.description),
  );
  if (sales.length < BUSINESS_SALES_MIN_DEPOSITS) return 0;
  return sales.reduce((sum, t) => sum - t.amountCents, 0);
}

const FEDERAL_PAYEE = /\b(?:IRS|USATAXPYMT|US TREASURY|U\.S\. TREASURY|EFTPS)\b/i;

// Estimated tax paid toward the year: tax payments from Feb 1 of the year to Jan 31 of the
// next (January's is usually the last quarter of the year before), split federal / state.
export function taxPaymentsFor(
  transactions: IncomeTransaction[],
  year: number,
): { federalCents: number; stateCents: number } {
  const from = `${year}-02-01`;
  const to = `${year + 1}-01-31`;
  let federalCents = 0;
  let stateCents = 0;
  for (const t of transactions) {
    if (t.pfcDetailed !== "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" || t.amountCents <= 0) continue;
    if (t.date < from || t.date > to) continue;
    // Spec step 170: property tax goes to the county, not toward the year's income tax.
    if (PROPERTY_TAX_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`)) continue;
    if (FEDERAL_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`))
      federalCents += t.amountCents;
    else stateCents += t.amountCents;
  }
  return { federalCents, stateCents };
}

// Spec step 170: property tax paid in the year (to a county or city tax office), for the
// state and local tax deduction.
export function propertyTaxFor(transactions: IncomeTransaction[], year: number): number {
  return transactions
    .filter(
      (t) =>
        t.pfcDetailed === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" &&
        t.amountCents > 0 &&
        t.date.startsWith(String(year)) &&
        PROPERTY_TAX_PAYEE.test(`${t.description} ${t.merchantName ?? ""}`),
    )
    .reduce((s, t) => s + t.amountCents, 0);
}
