import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import type { FeeSummary } from "@/insights/investment-fees";
import type { PortfolioReview } from "@/insights/portfolio-review";
import { loadFees } from "@/lib/investments/fees";
import { loadInvestments } from "@/lib/investments/holdings";
import type { RebalancePlan } from "@/insights/rebalance";
import { loadAccountPlan, type AccountPlan } from "@/lib/investments/accounts";
import { loadMonthFacts } from "@/lib/investments/overview";
import { loadReturns, type Returns } from "@/lib/investments/returns";
import { loadGoalBuckets } from "@/lib/investments/goal-buckets";
import { loadCollege } from "@/lib/investments/college";
import { collectReceipts, loadHsa, type HsaView } from "@/lib/investments/hsa";
import { loadCompanyStock, type CompanyStockView } from "@/lib/investments/company-stock";
import { loadCrypto, type CryptoView } from "@/lib/crypto/crypto";
import { loadCash, type CashView } from "@/lib/investments/cash";
import {
  loadRetirementAccounts,
  type RetirementAccountsView,
} from "@/lib/investments/retirement-accounts";
import { loadOldAccounts, type OldAccountsView } from "@/lib/investments/old-accounts";
import {
  loadRetirementIncome,
  type RetirementIncomeView,
} from "@/lib/investments/retirement-income";
import { loadFamily, type FamilyView } from "@/lib/investments/family";
import { loadProperty, type PropertyView } from "@/lib/investments/property";
import { automaticLog } from "@/lib/investments/automatic";
import type { Bucket } from "@/planning/goal-buckets";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import { loadRebalance } from "@/lib/investments/rebalance";
import { loadRetirement } from "@/lib/investments/retirement";
import { loadReview } from "@/lib/investments/review";
import type { RetirementPlan } from "@/planning/retirement";
import { profileOf } from "@/lib/investments/profile";
import type { ProfileAnswers } from "@/planning/investor-profile";

// What Jane's brain knows about the person's investments (spec step 128 on), loaded with
// the same code as the investments pages. Each later investment step adds its part here.

export type InvestmentSnapshot = {
  totalCents: number;
  holdingCount: number;
  accounts: { id: string; name: string; label: string; balanceCents: number | null }[];
  // Spec step 98: demo advice mode, the only time Jane recommends anything here.
  advice: boolean;
  // Spec step 129: what the investments are for, as answered so far.
  profile: ProfileAnswers;
  // Spec step 130: what investing costs, and the lower-cost equivalents.
  fees: Pick<FeeSummary, "totalYearlyCents" | "overYears" | "equivalents" | "years">;
  // Spec step 131: the mix against the profile's target; null until the profile is done.
  review: PortfolioReview | null;
  // Spec step 132: on track for retirement; null until the profile is done.
  retirement: RetirementPlan | null;
  // Spec step 133: the orders that move to the recommended mix; null until the profile is
  // done (or outside demo advice mode).
  rebalance: RebalancePlan | null;
  // Spec step 135: which account first and where to hold what; order null until the
  // profile is done.
  accountPlan: Pick<AccountPlan, "order" | "location">;
  // Spec step 137: the monthly note's facts, and how much Jane does by herself.
  month: { month: string; previousCents: number | null; contributedCents: number };
  // Spec step 157: each goal's bucket; null until the profile is done.
  goalBuckets: { byHerself: boolean; buckets: Bucket[] | null };
  // Spec step 158: children on the tax profile, and college plans set up.
  college: { children: number; plans: number };
  // Spec step 159: the HSA and its receipts vault.
  hsa: Pick<HsaView, "account" | "plan" | "savedCents" | "demo"> & { receipts: number };
  // Spec step 160: the employer's stock and the plan to sell it down.
  companyStock: Pick<CompanyStockView, "company" | "concentration" | "plan" | "demo">;
  // Spec step 161: crypto, read-only: its size and fees, and where it's read from.
  crypto: Pick<CryptoView, "size" | "fees" | "demo"> & { sources: string[] };
  // Spec step 210: limits, the match, Roth or traditional.
  retirementAccounts: Pick<
    RetirementAccountsView,
    "match" | "limits" | "roth" | "ira" | "iraAllowedCents" | "pending" | "demo"
  >;
  // Spec step 211: past employers' plans.
  oldAccounts: OldAccountsView;
  // Spec step 212: income in retirement.
  retirementIncome: RetirementIncomeView;
  // Spec step 213: the children in the family's investing.
  family: FamilyView;
  // Spec step 214: homes and rentals.
  property: PropertyView;
  // Spec step 164: what Jane did by herself in the last month, and what she asked about.
  automatic: Awaited<ReturnType<typeof automaticLog>>;
  // Spec step 162: the cash plan.
  cash: Pick<CashView, "plan">;
  // Spec step 156: how they've done.
  returns: Returns;
  // Spec step 134: automatic investing, its recent paydays and Jane's suggestion.
  autoInvest: Pick<
    Awaited<ReturnType<typeof loadAutoInvest>>,
    "plan" | "runs" | "suggestion" | "accounts"
  >;
};

export async function loadInvestmentSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<InvestmentSnapshot> {
  const investments = await loadInvestments(userId, { client, now });
  const [
    { fees },
    { review },
    { retirement },
    { plan: rebalance },
    auto,
    accountPlan,
    advice,
    profile,
  ] = await Promise.all([
    loadFees(userId, { client, now, investments }),
    loadReview(userId, { client, now, investments }),
    loadRetirement(userId, { client, now, investments }),
    loadRebalance(userId, { client, now, investments }),
    loadAutoInvest(userId, { client, now }),
    loadAccountPlan(userId, { client, now, investments }),
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
  ]);
  return {
    totalCents: investments.totalCents,
    holdingCount: investments.holdingCount,
    accounts: investments.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      label: a.label,
      balanceCents: a.balanceCents,
    })),
    advice,
    profile,
    fees: {
      totalYearlyCents: fees.totalYearlyCents,
      overYears: fees.overYears,
      equivalents: fees.equivalents,
      years: fees.years,
    },
    review,
    retirement,
    rebalance,
    accountPlan: { order: accountPlan.order, location: accountPlan.location },
    month: await loadMonthFacts(userId, investments, { client, now }),
    returns: await loadReturns(userId, { client, now, investments }),
    hsa: await collectReceipts(userId, { client, now })
      .then(() => loadHsa(userId, { client, now }))
      .then((h) => ({
        account: h.account,
        plan: h.plan,
        savedCents: h.savedCents,
        demo: h.demo,
        receipts: h.receipts.filter((r) => r.status === "saved").length,
      })),
    retirementAccounts: await loadRetirementAccounts(userId, { client, now }),
    oldAccounts: await loadOldAccounts(userId, { client, now }),
    retirementIncome: await loadRetirementIncome(userId, { client, now, investments }),
    family: await loadFamily(userId, { client, now }),
    property: await loadProperty(userId, { client, now }),
    automatic: await automaticLog(userId, { client, now }),
    cash: await loadCash(userId, { client, now, investments }).then((c) => ({ plan: c.plan })),
    crypto: await loadCrypto(userId, {
      client,
      now,
      investedCents: investments.totalCents,
    }).then((c) => ({
      size: c.size,
      fees: c.fees,
      demo: c.demo,
      sources: c.connections.filter((x) => x.totalCents > 0).map((x) => x.name),
    })),
    companyStock: await loadCompanyStock(userId, { client, now }).then((c) => ({
      company: c.company,
      concentration: c.concentration,
      plan: c.plan,
      demo: c.demo,
    })),
    college: await loadCollege(userId, { client, now }).then((c) => ({
      children: c.children,
      plans: c.plans.length,
    })),
    goalBuckets: await loadGoalBuckets(userId, { client, now }).then((g) => ({
      byHerself: g.byHerself,
      buckets: g.buckets,
    })),
    autoInvest: {
      plan: auto.plan,
      runs: auto.runs,
      suggestion: auto.suggestion,
      accounts: auto.accounts,
    },
  };
}
