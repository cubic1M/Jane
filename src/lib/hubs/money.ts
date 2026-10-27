import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { loadDetectionInput } from "@/detection/engine";
import { recurringCharges } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { debtSummary, DEBT_ACCOUNT_SELECT } from "@/insights/loans";
import { netWorth, type NetWorth } from "@/insights/net-worth";
import { spendingInsights } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { formatCents } from "@/lib/money";
import { assetPrompts, promptHref, type AssetPrompt } from "@/lib/owned-assets";
import { loadInsurance } from "@/lib/insurance/profile";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { plural, type HubGroup, type HubTileData } from "./tile";

// The Money hub (spec step 80): the picture of the person's money, one tile per page, each
// with one live number from the same code as that page. Everything loads in parallel.

type Options = { client?: PrismaClient; now?: Date };

export type MoneyData = {
  hasAccounts: boolean;
  // YYYY-MM, this month.
  month: string;
  netWorth: NetWorth;
  hasInvestmentAccounts: boolean;
  owned: { count: number };
  // A mortgage or car loan with nothing linked to it, if any.
  assetPrompt: Pick<AssetPrompt, "kind" | "loanId"> | null;
  goals: { total: number; onTrack: number };
  spendingCents: number;
  budgets: { total: number; over: number; daysLeft: number };
  recurring: { count: number; yearlyCents: number };
  debt: { accounts: number; owedCents: number };
  documents: number;
  // Spec step 102: policies on the insurance profile and gaps in the cover.
  insurance: { policies: number; gaps: number };
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

const NO_BANK = "Link a bank to see it";

// Pure: the tiles, grouped, from the numbers.
export function moneyTiles(d: MoneyData): HubGroup[] {
  const have: HubTileData[] = [
    {
      label: "Net worth",
      href: "/net-worth",
      value: d.hasAccounts ? formatCents(d.netWorth.netCents) : null,
      status: d.hasAccounts ? "What you have minus what you owe" : NO_BANK,
    },
  ];
  if (d.hasInvestmentAccounts) {
    have.push({
      label: "Investments",
      href: "/investments",
      value: formatCents(d.netWorth.investmentsCents),
      status: "Retirement and investment accounts, at the balance they report",
    });
  }
  have.push(
    d.owned.count > 0
      ? {
          label: "Things you own",
          href: "/things",
          value: formatCents(d.netWorth.ownedCents),
          status: `${plural(d.owned.count, "thing")}, at your values`,
        }
      : d.assetPrompt
        ? {
            label: "Things you own",
            href: promptHref(d.assetPrompt),
            value: null,
            status: d.assetPrompt.kind === "vehicle" ? "Add your car" : "Add your home",
          }
        : {
            label: "Things you own",
            href: "/things",
            value: null,
            status: "Add a home or car to count it",
          },
    d.goals.total > 0
      ? {
          label: "Goals",
          href: "/goals",
          value: `${d.goals.onTrack} on track`,
          status: `Of ${plural(d.goals.total, "goal")}`,
        }
      : { label: "Goals", href: "/goals", value: null, status: "Set one to save toward" },
  );

  const goesOut: HubTileData[] = [
    {
      label: "Spending",
      href: "/insights",
      value: d.hasAccounts ? formatCents(d.spendingCents) : null,
      status: d.hasAccounts ? `So far in ${monthName(d.month)}` : NO_BANK,
    },
    d.budgets.total > 0
      ? {
          label: "Budgets",
          href: "/budgets",
          value: d.budgets.over > 0 ? `${d.budgets.over} over` : "All on track",
          status: `${plural(d.budgets.total, "budget")}, ${plural(d.budgets.daysLeft, "day")} left this month`,
        }
      : { label: "Budgets", href: "/budgets", value: null, status: "Set a monthly budget" },
    {
      label: "Bills and subscriptions",
      href: "/subscriptions",
      value: d.hasAccounts ? String(d.recurring.count) : null,
      status: !d.hasAccounts
        ? NO_BANK
        : d.recurring.count > 0
          ? `Regular charges, ${formatCents(d.recurring.yearlyCents)} a year`
          : "No regular charges found",
      more: { href: "/bills", label: "Coming up" },
    },
    {
      label: "Transactions",
      href: "/transactions",
      value: null,
      status: "Search them and fix a category",
      more: { href: "/transfers", label: "Transfers" },
    },
  ];

  const owe: HubTileData[] = [
    {
      label: "Loans and cards",
      href: "/loans",
      value: d.debt.accounts > 0 ? formatCents(d.debt.owedCents) : null,
      status:
        d.debt.accounts > 0
          ? `Owed across ${plural(d.debt.accounts, "account")}`
          : "No loans or cards linked",
    },
  ];

  const files: HubTileData[] = [
    {
      label: "Documents",
      href: "/documents",
      value: d.documents > 0 ? String(d.documents) : null,
      status: d.documents > 0 ? "Policies, warranties and receipts" : "Add a policy or receipt",
    },
    {
      label: "Insurance",
      href: "/insurance",
      value: d.insurance.policies > 0 ? String(d.insurance.policies) : null,
      status:
        d.insurance.gaps > 0
          ? `${plural(d.insurance.gaps, "gap")} in your cover`
          : d.insurance.policies > 0
            ? "Every policy in one place"
            : "Add your policies",
    },
  ];

  return [
    { title: "What you have", tiles: have },
    { title: "What goes out", tiles: goesOut },
    { title: "What you owe", tiles: owe },
    { title: "Your files", tiles: files },
  ];
}

export async function loadMoneyHub(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MoneyData> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [
    accounts,
    owned,
    goals,
    budgets,
    transactions,
    input,
    confirmed,
    documents,
    insurance,
    crypto,
  ] = await Promise.all([
    db.accounts.findMany({
      select: DEBT_ACCOUNT_SELECT,
    }),
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    listGoals(userId, { client, now }),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    loadDetectionInput(userId, { client, now }),
    db.subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    }),
    db.documents.count(),
    loadInsurance(userId, { client, now }),
    // Crypto, read-only (spec step 161).
    cryptoTotal(userId, { client }),
  ]);

  // Net worth today, as /net-worth works it out.
  const worth = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
  );
  // A home with nothing linked comes before a car.
  const prompts = assetPrompts(
    accounts,
    owned.map((o) => o.loanAccountId),
  );
  const prompt = prompts.find((p) => p.kind === "home") ?? prompts[0];
  const month = asOf.slice(0, 7);
  // This month, as /insights counts it (it compares months, so it needs two).
  const spending = spendingInsights(transactions, { asOf, monthCount: 2 }).months.at(-1);
  const budget = budgets.length > 0 ? budgetSummary(transactions, budgets, asOf) : null;
  input.subscriptionMerchantKeys = confirmed.map((c) => c.merchantKey);
  const charges = recurringCharges(input);
  const debt = debtSummary(accounts, asOf);

  return {
    hasAccounts: accounts.length > 0,
    month,
    netWorth: worth,
    hasInvestmentAccounts: accounts.some((a) => a.type === "investment"),
    owned: { count: owned.length },
    assetPrompt: prompt ? { kind: prompt.kind, loanId: prompt.loanId } : null,
    goals: {
      total: goals.length,
      onTrack: goals.filter((g) => g.progress.status !== "date_passed").length,
    },
    spendingCents: spending?.spendingCents ?? 0,
    budgets: {
      total: budgets.length,
      over: budget?.progress.filter((p) => p.over).length ?? 0,
      daysLeft: budget?.daysLeft ?? 0,
    },
    recurring: {
      count: charges.length,
      yearlyCents: charges.reduce((sum, c) => sum + c.annualCostCents, 0),
    },
    debt: { accounts: debt.lines.length, owedCents: debt.totalOwedCents },
    documents,
    insurance: { policies: insurance.policies.length, gaps: insurance.gaps.length },
  };
}
