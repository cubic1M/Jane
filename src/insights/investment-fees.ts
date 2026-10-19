import {
  DEMO_EMPLOYER_PLAN_MENU,
  EMPLOYER_PLAN_SUBTYPES,
  FUND_FACTS,
  FUND_NAMES,
  LOWER_COST_EQUIVALENTS,
} from "@/config/funds";
import {
  ACCOUNT_FEE_SUBTYPES,
  ADVISORY_FEE_SUBTYPES,
  FEE_YEARS,
  HIGH_FEE_BPS,
  MIN_FEE_SAVING_CENTS,
  RETURN_HIGH,
  RETURN_LOW,
} from "@/config/market-assumptions";
import type { HoldingView, InvestmentAccountView } from "./investments";

// What investing costs the person (spec step 130), from their holdings and fee
// transactions only: each fund's yearly cost (its expense ratio on what's in it), advisory
// fees and account fees from the last 12 months, and what all of it costs over 30 years as
// a range (src/config/market-assumptions.ts). For each costly fund, the lower-cost
// equivalent they could hold instead: demo advice only (the caller decides). Pure.

export type Range = { lowCents: number; highCents: number };

// What a yearly fee of `rate` takes from `valueCents` over `years`, growing at `growth` a
// year: the difference between the money with and without the fee.
export function percentFeeCost(
  valueCents: number,
  rate: number,
  years: number,
  growth: number,
): number {
  return Math.round(valueCents * ((1 + growth) ** years - (1 + growth - rate) ** years));
}

// What a flat fee paid at the end of each year costs over `years`: the fees plus what they
// would have grown to.
export function flatFeeCost(yearlyCents: number, years: number, growth: number): number {
  if (growth === 0) return yearlyCents * years;
  return Math.round(yearlyCents * (((1 + growth) ** years - 1) / growth));
}

const range = (cost: (growth: number) => number): Range => ({
  lowCents: cost(RETURN_LOW.value),
  highCents: cost(RETURN_HIGH.value),
});

export type FeeTransaction = { accountId: string; amountCents: number; subtype: string };

export type FundCost = {
  holding: HoldingView;
  accountName: string;
  expenseRatioBps: number;
  yearlyCents: number;
  overYears: Range;
};

export type Equivalent = {
  holding: HoldingView;
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  category: string;
  expenseRatioBps: number;
  yearlySavingCents: number;
  overYears: Range;
  // Only funds on an employer plan's menu can be bought there.
  inPlanMenu: boolean;
};

export type FeeSummary = {
  funds: FundCost[];
  // Holdings whose yearly cost isn't known (no fund facts), by name.
  unknown: string[];
  fundsYearlyCents: number;
  // Paid in the last 12 months, from the account's fee transactions.
  advisoryCents: number;
  accountFeesCents: number;
  totalYearlyCents: number;
  overYears: Range;
  equivalents: Equivalent[];
  years: number;
};

const isEmployerPlan = (subtype: string | null) =>
  EMPLOYER_PLAN_SUBTYPES.includes((subtype ?? "").toLowerCase());

// The cheapest suitable equivalent for a costly fund in this account, or null.
export function equivalentFor(
  holding: HoldingView,
  account: Pick<InvestmentAccountView, "subtype">,
): { ticker: string; expenseRatioBps: number; category: string } | null {
  if (!holding.ticker || holding.expenseRatioBps === null) return null;
  if (holding.expenseRatioBps <= HIGH_FEE_BPS) return null;
  const menu = isEmployerPlan(account.subtype) ? DEMO_EMPLOYER_PLAN_MENU : null;
  const ticker = (LOWER_COST_EQUIVALENTS[holding.ticker.toUpperCase()] ?? []).find(
    (t) => FUND_FACTS[t] && (!menu || menu.includes(t)),
  );
  if (!ticker) return null;
  const facts = FUND_FACTS[ticker];
  return facts.expenseRatioBps < holding.expenseRatioBps
    ? { ticker, expenseRatioBps: facts.expenseRatioBps, category: facts.category }
    : null;
}

const sumOf = (rows: FeeTransaction[], subtypes: readonly string[]) =>
  rows
    .filter((t) => subtypes.includes(t.subtype) && t.amountCents > 0)
    .reduce((sum, t) => sum + t.amountCents, 0);

export function feeSummary(
  accounts: InvestmentAccountView[],
  feeTransactions: FeeTransaction[],
  years = FEE_YEARS,
): FeeSummary {
  const funds: FundCost[] = [];
  const unknown: string[] = [];
  const equivalents: Equivalent[] = [];
  for (const account of accounts) {
    for (const h of account.holdings) {
      if (h.isCash && h.expenseRatioBps === null) continue;
      if (h.expenseRatioBps === null) {
        // Shares of one company have no yearly cost; anything else unknown is listed.
        if (h.type !== "equity") unknown.push(h.name);
        continue;
      }
      const rate = h.expenseRatioBps / 10_000;
      funds.push({
        holding: h,
        accountName: account.name,
        expenseRatioBps: h.expenseRatioBps,
        yearlyCents: Math.round(h.valueCents * rate),
        overYears: range((g) => percentFeeCost(h.valueCents, rate, years, g)),
      });
      const better = equivalentFor(h, account);
      if (!better) continue;
      const saving = (h.expenseRatioBps - better.expenseRatioBps) / 10_000;
      const yearlySavingCents = Math.round(h.valueCents * saving);
      if (yearlySavingCents < MIN_FEE_SAVING_CENTS) continue;
      equivalents.push({
        holding: h,
        accountId: account.id,
        accountName: account.name,
        ticker: better.ticker,
        name: FUND_NAMES[better.ticker] ?? better.ticker,
        category: better.category,
        expenseRatioBps: better.expenseRatioBps,
        yearlySavingCents,
        // The new fund still charges its own fee: the saving is the difference.
        overYears: range(
          (g) =>
            percentFeeCost(h.valueCents, h.expenseRatioBps! / 10_000, years, g) -
            percentFeeCost(h.valueCents, better.expenseRatioBps / 10_000, years, g),
        ),
        inPlanMenu: isEmployerPlan(account.subtype),
      });
    }
  }
  const fundsYearlyCents = funds.reduce((sum, f) => sum + f.yearlyCents, 0);
  const advisoryCents = sumOf(feeTransactions, ADVISORY_FEE_SUBTYPES);
  const accountFeesCents = sumOf(feeTransactions, ACCOUNT_FEE_SUBTYPES);
  const flat = advisoryCents + accountFeesCents;
  const fundsOver = funds.reduce(
    (sum, f) => ({
      lowCents: sum.lowCents + f.overYears.lowCents,
      highCents: sum.highCents + f.overYears.highCents,
    }),
    { lowCents: 0, highCents: 0 },
  );
  const flatOver = range((g) => flatFeeCost(flat, years, g));
  return {
    funds: funds.sort((a, b) => b.yearlyCents - a.yearlyCents),
    unknown,
    fundsYearlyCents,
    advisoryCents,
    accountFeesCents,
    totalYearlyCents: fundsYearlyCents + flat,
    overYears: {
      lowCents: fundsOver.lowCents + flatOver.lowCents,
      highCents: fundsOver.highCents + flatOver.highCents,
    },
    equivalents: equivalents.sort((a, b) => b.yearlySavingCents - a.yearlySavingCents),
    years,
  };
}

// What the equivalents would save together, a year and over the years.
export function equivalentsSaving(equivalents: Equivalent[]): {
  yearlyCents: number;
  overYears: Range;
} {
  return equivalents.reduce(
    (sum, e) => ({
      yearlyCents: sum.yearlyCents + e.yearlySavingCents,
      overYears: {
        lowCents: sum.overYears.lowCents + e.overYears.lowCents,
        highCents: sum.overYears.highCents + e.overYears.highCents,
      },
    }),
    { yearlyCents: 0, overYears: { lowCents: 0, highCents: 0 } },
  );
}
