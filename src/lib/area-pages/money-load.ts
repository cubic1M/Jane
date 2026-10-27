import { areaOfCapability } from "@/config/areas";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { FORECAST_DAYS, LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import { addDays, forecastAccounts, upcomingBills } from "@/detection/forecast";
import { loadDetectionInput } from "@/detection/engine";
import { recurringCharges } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { irregularCosts } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { debtSummary } from "@/insights/loans";
import { netWorth } from "@/insights/net-worth";
import { spendingInsights } from "@/insights/spending";
import { openBooks } from "@/lib/books";
import { booksFix, importEnded, type BooksFix } from "@/lib/books-fix";
import { listMerchantRules } from "@/lib/categories";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { frequencyWords } from "@/lib/explain-input";
import { listGoals } from "@/lib/goals";
import { listTransfers } from "@/lib/money-movement/transfers";
import { assetPrompts, promptHref } from "@/lib/owned-assets";
import type { MoneyTreeInput } from "./money";

// What the Spending & bills tree reads (docs/design/area-pages.md), from the same code as each
// page it gathers: the bills forecast (/bills), recurring charges (/subscriptions), budgets and
// yearly bills (/budgets), spending (/insights), the books check, transfers (/transfers), net
// worth (/net-worth), goals and loans. One detection input feeds the forecast, the recurring
// charges and the yearly bills, as on their pages. Plus the area's open suggestions.

type Options = { client?: PrismaClient; now?: Date };

export type MoneyArea = MoneyTreeInput & {
  // For the details: each suggestion's button and why, by topic; each books problem's fix.
  actions: Record<string, { label: string; href: string; why: string }>;
  fixes: Record<string, BooksFix>;
  assetPromptHref: string | null;
  topMerchants: { merchant: string; cents: number }[];
  // Accounts left out of net worth for having no balance.
  missing: string[];
};

export async function loadMoneyArea(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MoneyArea> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [
    input,
    accounts,
    owned,
    crypto,
    goals,
    budgets,
    transactions,
    confirmed,
    findings,
    suggestions,
    books,
    transfers,
    rules,
  ] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    db.accounts.findMany({
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
    }),
    db.ownedAssets.findMany({
      select: { id: true, valueCents: true, valuedOn: true, loanAccountId: true },
    }),
    cryptoTotal(userId, { client }),
    listGoals(userId, { client, now }),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
    db.subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    }),
    db.findings.findMany({
      where: { type: "subscription_review", status: { in: ["new", "shown"] } },
      select: { id: true, key: true },
    }),
    db.suggestions.findMany({
      where: { status: { in: ["waiting", "selected"] } },
      select: {
        id: true,
        capability: true,
        topic: true,
        headline: true,
        short: true,
        title: true,
        worthCents: true,
        worthKind: true,
        urgency: true,
        why: true,
        actionLabel: true,
        actionHref: true,
      },
      orderBy: { score: "desc" },
    }),
    openBooks(userId, { client }),
    listTransfers(userId, { client, now }),
    listMerchantRules(userId, { client }),
  ]);

  input.subscriptionMerchantKeys = confirmed.map((c) => c.merchantKey);
  const card = new Map(findings.map((f) => [f.key, f.id]));
  const worth = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
  );
  // A home with nothing linked comes before a car, as on the hub.
  const prompts = assetPrompts(
    accounts,
    owned.map((o) => o.loanAccountId),
  );
  const prompt = prompts.find((p) => p.kind === "home") ?? prompts[0];
  const debt = debtSummary(accounts, asOf);
  const budget = budgetSummary(transactions, budgets, asOf);
  // This month against last, as the hub counts it.
  const insights = spendingInsights(transactions, { asOf, monthCount: 2 });
  const latest = insights.months.at(-1);
  const mine = suggestions.filter((s) => areaOfCapability(s.capability) === "money");
  const open = books.open.filter((o) => o.kind !== "transfer");

  return {
    hasAccounts: accounts.length > 0,
    cushionCents: LOW_BALANCE_CUSHION_CENTS,
    suggestions: mine.map((s) => ({
      id: s.id,
      topic: s.topic,
      summary: s.short || s.headline || s.title,
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      urgency: s.urgency,
    })),
    lows: forecastAccounts(input, FORECAST_DAYS).map((f) => ({
      accountId: f.accountId,
      name: f.accountName,
      startCents: f.startCents,
      lowCents: f.lowest.balanceCents,
      date: f.lowest.date,
    })),
    bills: upcomingBills(input, FORECAST_DAYS).map((b) => ({
      merchant: b.merchant,
      date: b.date,
      amountCents: b.amountCents,
    })),
    weekEnds: addDays(asOf, 7),
    recurring: recurringCharges(input).map((r) => ({
      key: r.key,
      merchant: r.merchant,
      lastAmountCents: r.lastAmountCents,
      frequency: frequencyWords(r.frequency),
      nextDate: r.nextDate,
      annualCostCents: r.annualCostCents,
      subscription: r.subscription,
      findingId: card.get(r.key) ?? null,
    })),
    budgets: { daysLeft: budget.daysLeft, progress: budgets.length > 0 ? budget.progress : [] },
    yearly: irregularCosts(input).items.map((i) => ({
      key: i.key,
      name: i.name,
      monthlyCents: i.monthlyCents,
      nextDate: i.nextDate,
      nextAmountCents: i.nextAmountCents,
      byNowCents: i.byNowCents,
    })),
    spending: latest
      ? {
          month: latest.month,
          spendingCents: latest.spendingCents,
          incomeCents: latest.incomeCents,
          categories: insights.categoriesByMonth[latest.month] ?? [],
          changes: insights.changes,
        }
      : null,
    books: open.map((o) => ({ id: o.id, kind: o.kind, imported: importEnded(o), words: o.words })),
    transfers: transfers.map((t) => ({
      id: t.id,
      toName: t.toName,
      amountCents: t.amountCents,
      status: t.status,
      runOn: t.runOn,
    })),
    have: {
      netCents: worth.netCents,
      netKnown: worth.known,
      assetsCents: worth.assetsCents,
      debtsCents: worth.debtsCents,
      investmentsCents: worth.investmentsCents,
      ownedCents: worth.ownedCents,
      owned: owned.length,
      missing: worth.unbalanced,
      assetPrompt: prompt ? (prompt.kind === "vehicle" ? "vehicle" : "home") : null,
      goals: {
        total: goals.length,
        onTrack: goals.filter((g) => g.progress.status !== "date_passed").length,
      },
      debt: {
        accounts: debt.lines.length,
        owedCents: debt.totalOwedCents,
        known: debt.lines.filter((l) => l.balanceCents !== null).length,
      },
    },
    rules: rules.length,
    actions: Object.fromEntries(
      mine.map((s) => [s.topic, { label: s.actionLabel, href: s.actionHref, why: s.why }]),
    ),
    fixes: Object.fromEntries(open.map((o) => [o.id, booksFix(o)])),
    assetPromptHref: prompt ? promptHref(prompt) : null,
    topMerchants: insights.topMerchants.slice(0, 5),
    missing: worth.missing,
  };
}
