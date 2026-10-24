import { NET_WORTH_MONTHS } from "@/config/net-worth";
import { SPENDING_MONTHS } from "@/config/areas";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { debtSummary } from "@/insights/loans";
import { monthlyNetWorth, netWorth } from "@/insights/net-worth";
import { monthsEnding, spendingInsights } from "@/insights/spending";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
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
    netWorthOverYear(userId, { client, now }),
  ]);
  if (!home) return null;
  const asOf = now.toISOString().slice(0, 10);
  return {
    home,
    hero: {
      asOf,
      safe: home.safeToSpend,
      netWorth: worth,
      foundCents: home.moneyFoundCents,
      savedCents: home.savedToDateCents,
    },
    cashFlow: {
      asOf,
      bills: home.cashFlow.bills,
      deposits: home.cashFlow.deposits,
      deadlines: home.cashFlow.deadlines,
    },
  };
}

// Net worth today and month by month, as /net-worth works it out.
async function netWorthOverYear(userId: string, { client, now }: Required<Options>) {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [first] = monthsEnding(asOf, NET_WORTH_MONTHS);
  const [accounts, snapshots, ownedRows, crypto] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { gte: new Date(`${first}-01T00:00:00Z`) } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    cryptoTotal(userId, { client }),
  ]);
  if (accounts.length === 0) return null;
  const owned = ownedRows.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) }));
  const today = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned,
    crypto,
  );
  // The line shows how the accounts moved: things owned count across the whole year at their
  // value now, rather than appearing as a jump in the month they were first valued, and so
  // does an account with no balance history yet (a sample person's investments, an account
  // linked today), or the line leaves it out and drifts off the headline.
  const start = `${first}-01`;
  const kept = new Set(snapshots.map((s) => s.accountId));
  const months = monthlyNetWorth(
    accounts,
    [
      ...snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
      ...accounts
        .filter((a) => !kept.has(a.id) && a.currentBalanceCents !== null)
        .map((a) => ({ accountId: a.id, date: start, balanceCents: a.currentBalanceCents! })),
    ],
    asOf,
    NET_WORTH_MONTHS,
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn < start ? o.valuedOn : start })),
  );
  // This month's point is today's net worth, the hero's number, so the line ends where the
  // number is (the last snapshot can be weeks old, or a sample person's month end).
  return {
    todayCents: today.netCents,
    months: months.map((m, i) => ({
      month: m.month,
      netCents: i === months.length - 1 ? today.netCents : m.netCents,
    })),
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
  const asOf = now.toISOString().slice(0, 10);
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
          select: {
            id: true,
            name: true,
            mask: true,
            type: true,
            subtype: true,
            currentBalanceCents: true,
            liability: {
              select: {
                aprBps: true,
                rateType: true,
                minimumPaymentCents: true,
                nextPaymentDueDate: true,
                payoffDate: true,
                isOverdue: true,
                pastDueCents: true,
                ytdInterestPaidCents: true,
                description: true,
              },
            },
          },
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
