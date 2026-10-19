import { demoAccounts, DEMO_INSTITUTION } from "@/data-sources/demo/demo-bank";
import {
  demoHoldings,
  demoInvestmentTransactions,
  demoSecurities,
} from "@/data-sources/demo/demo-holdings";
import { feeSummary, type FeeTransaction } from "@/insights/investment-fees";
import type { InvestmentSnapshot } from "@/lib/jane-agent/investments/snapshot";
import { EMPTY_ANSWERS } from "@/planning/investor-profile";
import { normalizeHolding, normalizeSecurity } from "@/data-sources/plaid/investments";
import { investmentSummary } from "@/insights/investments";
import type { Investments } from "@/lib/investments/holdings";

// For tests: the demo bank's investments as loadInvestments would return them, built with
// the same normalizers and summary as a real sync, without a database.

export const DEMO_FIXTURE_SEED = { seed: "fixture", anchor: "2026-10-18" };

export function demoInvestments(asOf = "2026-10-19"): Investments {
  const accounts = demoAccounts(DEMO_FIXTURE_SEED)
    .filter((a) => a.type === "investment")
    .map((a) => ({
      id: a.account_id,
      name: a.name,
      subtype: a.subtype ?? null,
      balanceCents: Math.round((a.balances.current ?? 0) * 100),
      institution: DEMO_INSTITUTION,
    }));
  const securities = demoSecurities("2026-10-17", DEMO_FIXTURE_SEED.anchor).map((s) => {
    const n = normalizeSecurity(s);
    return {
      id: n.ref,
      name: n.name,
      ticker: n.ticker,
      type: n.type,
      isCashEquivalent: n.isCashEquivalent,
    };
  });
  const holdings = demoHoldings(DEMO_FIXTURE_SEED, "2026-10-17").flatMap((h, i) => {
    const n = normalizeHolding(h);
    return n ? [{ id: `h${i}`, accountId: n.accountRef, securityId: n.securityRef, ...n }] : [];
  });
  return {
    asOf,
    ...investmentSummary(accounts, securities, holdings),
    months: [],
  };
}

export function noInvestments(asOf = "2026-10-19"): Investments {
  return { asOf, ...investmentSummary([], [], []), months: [] };
}

// The demo bank's fee transactions in the 12 months to the fixture's day: four quarterly
// plan fees on the 401(k) and four advisory fees on the brokerage.
export function demoFeeTransactions(): FeeTransaction[] {
  return demoInvestmentTransactions(DEMO_FIXTURE_SEED, "2025-10-19", "2026-10-18")
    .filter((t) => t.type === "fee")
    .map((t) => ({
      accountId: t.account_id,
      amountCents: Math.round(t.amount * 100),
      subtype: t.subtype,
    }));
}

// Jane's brain's view of the demo bank's investments.
export function demoInvestmentSnapshot(over: Partial<InvestmentSnapshot> = {}): InvestmentSnapshot {
  const data = demoInvestments();
  const fees = feeSummary(data.accounts, demoFeeTransactions());
  return {
    totalCents: data.totalCents,
    holdingCount: data.holdingCount,
    accounts: data.accounts,
    advice: true,
    profile: EMPTY_ANSWERS,
    fees: {
      totalYearlyCents: fees.totalYearlyCents,
      overYears: fees.overYears,
      equivalents: fees.equivalents,
      years: fees.years,
    },
    review: null,
    retirement: null,
    rebalance: null,
    autoInvest: { plan: null, runs: [], suggestion: null, accounts: [] },
    accountPlan: { order: null, location: [] },
    month: { month: "2026-10", previousCents: null, contributedCents: 0 },
    returns: { asOf: "2026-10-18", periods: [], simulatedPrices: true },
    goalBuckets: { byHerself: false, buckets: null },
    college: { children: 0, plans: 0 },
    hsa: { account: null, plan: null, savedCents: 0, demo: true, receipts: 0 },
    ...over,
  };
}
