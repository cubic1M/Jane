import { SPENDING_MONTHS } from "@/config/areas";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { loadDebts } from "@/lib/debts";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { todayOf } from "@/lib/today";
import { listGoals } from "@/lib/goals";
import { goalsLate } from "@/lib/goals-late";
import { goalOnTrack } from "@/planning/goals";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { healthFor } from "@/lib/health-score";
import { homeSummary, type HomeSummary } from "@/lib/home";
import { loadInsurance } from "@/lib/insurance/profile";
import { practicePaidIn } from "@/lib/investments/practice-paid-in";
import { loadPractice } from "@/lib/practice/portfolio";
import { adviceMode } from "@/lib/advice-mode";
import { NoTaxParamsError } from "@/config/tax-params";
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
      foundOnceCents: home.moneyFoundOnceCents,
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
      historyDays: home.cashFlow.historyDays,
      statementsEnd: home.cashFlow.statementsEnd,
    },
  };
}

async function quietly<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    log.error(`Home hub: couldn't load ${what}`, { error });
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
  const [health, suggestions, months, insurance, loans, taxes, practice, goals, practiceOpen] =
    await Promise.all([
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
      // What's owed, from the one book the loans page and the chat read (gate B: this tile summed
      // the linked accounts and loans seen in payments, and left out pay-later plans the loans page
      // counts: $16,140.20 here, $16,215.20 there).
      quietly("loans", () => loadDebts(userId, { client, now })),
      // A year without IRS figures is a state, not an error: the tile says so (W-N), no figure.
      quietly("taxes", () =>
        loadTaxEstimate(userId, { client, now }).catch((error) => {
          if (error instanceof NoTaxParamsError) return { noParams: error.year } as const;
          throw error;
        }),
      ),
      quietly("practice", async () => {
        const view = await loadPractice(userId, { client, now });
        return view && { ...view, paidInCents: await practicePaidIn(userId, { client }) };
      }),
      quietly("goals", async () => {
        const goals = await listGoals(userId, { client, now });
        return { goals, late: await goalsLate(userId, goals, { client, now }) };
      }),
      // The practice portfolio runs in demo advice mode only.
      quietly("advice mode", () => adviceMode(userId, { client })),
    ]);

  return {
    parts: health?.parts.map((p) => ({ part: p.part, points: p.points, max: p.max })) ?? [],
    suggestions: suggestions ?? [],
    safeShort,
    practiceOpen: practiceOpen ?? true,
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
          lines: loans.debts.map((l) => ({
            name: l.name,
            balanceCents: l.balanceCents,
            overdue: l.overdue,
          })),
        }
      : null,
    taxesNoParamsYear: taxes && "noParams" in taxes ? taxes.noParams : undefined,
    taxes: taxes && !("noParams" in taxes)
      ? {
          totalTaxCents: taxes.estimate.totalTaxCents,
          paidCents: taxes.estimate.paidCents,
          refundCents: taxes.estimate.refundCents,
          withholdingKnown: taxes.withholdingKnown,
          incomeCents: taxes.estimate.totalIncomeCents,
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
          goals: goals.goals.map((g) => ({
            name: g.name,
            percent: g.progress.percent,
            // The one rule (goalOnTrack): on the way and not late with the other goals counted.
            onTrack: goalOnTrack({ status: g.progress.status, lateMonths: goals.late.get(g.id) }),
            reached: g.progress.status === "reached",
          })),
        }
      : null,
  };
}
