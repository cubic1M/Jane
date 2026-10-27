import { SPENDING_MONTHS } from "@/config/areas";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { debtSummary, DEBT_ACCOUNT_SELECT } from "@/insights/loans";
import { spendingInsights } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { listGoals } from "@/lib/goals";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { healthFor } from "@/lib/health-score";
import { homeSummary, type HomeSummary } from "@/lib/home";
import { loadInsurance } from "@/lib/insurance/profile";
import { practicePaidIn } from "@/lib/investments/practice-paid-in";
import { loadPractice } from "@/lib/practice/portfolio";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import type { AreasInput, CashFlowInput, HeroInput } from "./view";

// The home hub's loader (docs/design/home-hub.md): the numbers each page already works out,
// gathered in parallel. The top (hero row and cash flow) and the area tiles load separately,
// so the top shows first. An area whose data fails to load shows as not set up rather than
// taking the hub down.

type Options = { client?: PrismaClient; now?: Date };

export type HubTop = { home: HomeSummary; hero: HeroInput; cashFlow: CashFlowInput };

export async function loadHubTop(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<HubTop | null> {
  const [home, worth] = await Promise.all([
    homeSummary(userId, { client, now }),
    loadNetWorthHistory(userId, { client, now }),
  ]);
  if (!home) return null;
  const asOf = await todayOf(userId, { client, now });
  return {
    home,
    hero: {
      asOf,
      safe: home.safeToSpend,
      netWorth: worth,
      foundCents: home.moneyFoundCents,
      savedCents: home.savedToDateCents,
      savedItems: home.savedItems,
      confirmedCents: home.confirmedSavedCents,
      plan: home.plan,
      goal: home.goal,
    },
    cashFlow: {
      asOf,
      bills: home.cashFlow.bills,
      deposits: home.cashFlow.deposits,
      deadlines: home.cashFlow.deadlines,
    },
  };
}

async function quietly<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`Home hub: couldn't load ${what}`, { error });
    return null;
  }
}

export async function loadHubAreas(
  userId: string,
  { budgetsOver, safeShort }: { budgetsOver: number; safeShort: boolean },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AreasInput> {
  const db = scopedFor(userId, client);
  const asOf = await todayOf(userId, { client, now });
  const [health, suggestions, months, insurance, loans, taxes, practice, goals] = await Promise.all(
    [
      quietly("the health score", () => healthFor(userId, { client, now })),
      quietly("suggestions", () =>
        db.suggestions.findMany({
          where: { status: { in: ["waiting", "selected"] } },
          select: { capability: true, urgency: true },
        }),
      ),
      quietly("spending", async () => {
        const rows = await loadInsightTransactions(db, asOf, SPENDING_MONTHS);
        return spendingInsights(rows, { asOf, monthCount: SPENDING_MONTHS }).months;
      }),
      quietly("insurance", () => loadInsurance(userId, { client, now })),
      quietly("loans", async () => {
        const accounts = await db.accounts.findMany({
          select: DEBT_ACCOUNT_SELECT,
        });
        return debtSummary(accounts, asOf);
      }),
      quietly("taxes", () => loadTaxEstimate(userId, { client, now })),
      quietly("practice", async () => {
        const view = await loadPractice(userId, { client, now });
        return view && { ...view, paidInCents: await practicePaidIn(userId, { client }) };
      }),
      quietly("goals", () => listGoals(userId, { client, now })),
    ],
  );

  return {
    parts: health?.parts.map((p) => ({ part: p.part, points: p.points, max: p.max })) ?? [],
    suggestions: suggestions ?? [],
    safeShort,
    money: months
      ? {
          months: months.map((m) => ({ month: m.month, spendingCents: m.spendingCents })),
          budgetsOver,
        }
      : null,
    insurance: insurance
      ? { policies: insurance.policies.length, gaps: insurance.gaps.length }
      : null,
    loans: loans
      ? {
          owedCents: loans.totalOwedCents,
          lines: loans.lines.map((l) => ({
            name: l.name,
            balanceCents: l.balanceCents,
            overdue: l.overdue,
          })),
        }
      : null,
    taxes: taxes
      ? {
          totalTaxCents: taxes.estimate.totalTaxCents,
          paidCents: taxes.estimate.paidCents,
          refundCents: taxes.estimate.refundCents,
          withholdingKnown: taxes.withholdingKnown,
        }
      : null,
    investments: practice
      ? {
          totalCents: practice.totalCents,
          paidInCents: practice.paidInCents,
          parts: [
            ...practice.holdings.map((h) => ({ label: h.ticker, valueCents: h.valueCents })),
            { label: "Cash", valueCents: practice.state.cashCents },
          ].filter((p) => p.valueCents > 0),
        }
      : null,
    ahead: goals
      ? {
          goals: goals.map((g) => ({
            name: g.name,
            percent: g.progress.percent,
            onTrack: g.progress.status !== "date_passed",
          })),
        }
      : null,
  };
}
