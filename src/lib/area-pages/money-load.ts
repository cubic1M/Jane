import { CASH_FLOW_MIN_HISTORY_DAYS, SPENDING_MONTHS } from "@/config/areas";
import { goalsLate } from "@/lib/goals-late";
import { goalsOnTrack } from "@/planning/goals";
import { accountCopies, copiesAndKeepers, withoutCopies } from "@/lib/account-copies";
import { areaOfCapability } from "@/config/areas";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { FORECAST_DAYS, LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";
import { addDays, forecastAccounts, comingUpBills } from "@/detection/forecast";
import { loadDetectionInput } from "@/detection/input";
import { recurringCharges } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { endedOn, monthCutShortAt } from "@/lib/data-ended";
import { irregularCosts } from "@/insights/irregular";
import { loadInsightTransactions } from "@/insights/load";
import { owedSummary } from "@/insights/debts";
import { loadDebts } from "@/lib/debts";
import { netWorth } from "@/insights/net-worth";
import { shownSpendingMonth, spendingInsights } from "@/insights/spending";
import { openBooks } from "@/lib/books";
import { booksFix, importEnded, type BooksFix } from "@/lib/books-fix";
import { listMerchantRules } from "@/lib/categories";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { historyDaysOf } from "@/lib/history-days";
import { staleStatementsEnd } from "@/lib/report-state";
import { todayOf } from "@/lib/today";
import { frequencyWords } from "@/lib/explain-input";
import { listGoals } from "@/lib/goals";
import { listTransfers } from "@/lib/money-movement/transfers";
import { assetPrompts, promptHref } from "@/lib/owned-assets";
import { loadMaybeSame, loansSeenWithoutBalance } from "@/lib/net-worth-history";
import type { MoneyTreeInput } from "./money";
import { BEST_FIRST, SAID_YES } from "./tree";

// What the Spending & bills tree reads (docs/design/area-pages.md), from the same code as each
// page it gathers: the bills forecast (/bills), recurring charges (/subscriptions), budgets and
// yearly bills (/budgets), spending (/insights), the books check, transfers (/transfers), net
// worth (/net-worth), goals and loans. One detection input feeds the forecast, the recurring
// charges and the yearly bills, as on their pages. Plus the area's open suggestions.

type Options = { client?: PrismaClient; now?: Date };

export type MoneyArea = MoneyTreeInput & {
  // For the details: each suggestion's button and why, by its id (two can share a topic); each books problem's fix.
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
  // The person's own day, as every other page reads it (3pm and 7pm in Los Angeles agree).
  const asOf = await todayOf(userId, { client, now });
  const [
    input,
    listedAccounts,
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
    book,
    newestStored,
  ] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    db.accounts.findMany({
      select: {
        id: true,
        itemId: true,
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
    loadInsightTransactions(db, asOf, Math.max(BUDGET_SUGGESTION_MONTHS + 1, SPENDING_MONTHS)),
    db.subscriptionChecks.findMany({
      select: { merchantKey: true, isSubscription: true },
    }),
    db.findings.findMany({
      where: { type: "subscription_review", status: { in: ["new", "shown"] } },
      select: { id: true, key: true },
    }),
    db.suggestions.findMany({
      where: { status: { in: [...SAID_YES] } },
      select: {
        status: true,
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
      orderBy: [...BEST_FIRST],
    }),
    openBooks(userId, { client }),
    listTransfers(userId, { client, now }),
    listMerchantRules(userId, { client }),
    // What's owed, from the one book Home's tile, the loans page and the chat read (gate B).
    loadDebts(userId, { client, now }),
    // The newest line stored, not the newest in the months read above: an account whose last line
    // is older than that window has none in it (CodeRabbit sweep 1c), as on Home and the report.
    db.transactions.aggregate({ _max: { date: true } }),
  ]);
  // What net worth counts (src/lib/account-copies.ts): an account linked twice once, and an upload
  // only when it can't be a copy of a link. The keeper of a copy is found in the rows listed above.
  const copies = await accountCopies(db);
  const { keeper } = copiesAndKeepers(listedAccounts);
  const accounts = withoutCopies(listedAccounts, copies, (a) => a.id);

  input.subscriptionMerchantKeys = confirmed
    .filter((c) => c.isSubscription)
    .map((c) => c.merchantKey);
  input.declinedSubscriptionMerchantKeys = confirmed
    .filter((c) => !c.isSubscription)
    .map((c) => c.merchantKey);
  const card = new Map(findings.map((f) => [f.key, f.id]));
  const worth = netWorth(
    accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
    owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
    crypto,
  );
  // A home with nothing linked comes before a car, as on the hub.
  // A home linked to a copy that's left out is linked to the loan kept.
  const prompts = assetPrompts(
    accounts,
    owned.map((o) => (o.loanAccountId ? (keeper.get(o.loanAccountId) ?? o.loanAccountId) : null)),
  );
  const prompt = prompts.find((p) => p.kind === "home") ?? prompts[0];
  const budget = budgetSummary(transactions, budgets, asOf);
  // The months Home's Money tile reads, and the month it shows (shownSpendingMonth): on the 1st,
  // this month has none yet and the branch vanished (debugger 11-01), so it's last month, said as
  // such, the same month the tile and the money hub show (gate B).
  const insights = spendingInsights(transactions, { asOf, monthCount: SPENDING_MONTHS });
  const latest = shownSpendingMonth(insights.months);
  // Statements that reach a later month than the one shown (November has only income, October has
  // the spending) do cover this month: only a statement that stops there is "not in yet".
  const newestMonth = newestStored._max.date?.toISOString().slice(0, 7) ?? null;
  const current =
    latest === insights.months.at(-1) ||
    (latest != null && newestMonth !== null && newestMonth > latest.month);
  const mine = suggestions.filter((s) => areaOfCapability(s.capability) === "money");
  const open = books.open.filter((o) => o.kind !== "transfer");

  const late = await goalsLate(userId, goals, { client, now });
  return {
    hasAccounts: accounts.length > 0,
    cushionCents: LOW_BALANCE_CUSHION_CENTS,
    suggestions: mine.map((s) => ({
      id: s.id,
      topic: s.topic,
      summary: s.short || s.headline || s.title,
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      headline: s.headline,
      urgency: s.urgency,
      status: s.status,
    })),
    shortHistory: historyDaysOf(input) < CASH_FLOW_MIN_HISTORY_DAYS,
    statementsEnd: staleStatementsEnd(newestStored._max.date, asOf),
    // Not an account whose balance is too old to walk forward: /bills says its balance and day
    // and no lowest point (staleFrom), so the tree doesn't give one either.
    lows: forecastAccounts(input, FORECAST_DAYS)
      .filter((f) => !f.staleFrom)
      .map((f) => ({
        accountId: f.accountId,
        name: f.accountName,
        // Today's balance: a statement's is walked forward to today, so it's an estimate.
        startCents: f.todayCents,
        // With the statement's own balance and day, as /bills says it (balanceLine).
        ...(f.startOn !== input.asOf
          ? { estimated: true, fromCents: f.startCents, fromOn: f.startOn }
          : {}),
        lowCents: f.lowest.balanceCents,
        date: f.lowest.date,
      })),
    bills: comingUpBills(input, FORECAST_DAYS).map((b) => ({
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
          current,
          endsOn: monthCutShortAt(
            latest.month,
            endedOn(
              transactions.reduce<string | null>(
                (m, t) => (m === null || t.date > m ? t.date : m),
                null,
              ),
              asOf,
            ),
          ),
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
      loansSeen: await loansSeenWithoutBalance(userId, { client, now }),
      investmentsCents: worth.investmentsCents,
      ownedCents: worth.ownedCents,
      owned: owned.length,
      missing: worth.unbalanced,
      maybeSame: (await loadMaybeSame(userId, { client }))?.short ?? null,
      assetPrompt: prompt ? (prompt.kind === "vehicle" ? "vehicle" : "home") : null,
      // Of the goals not reached yet, on the way and in time with the others counted, as on Home and
      // the Plans tree (goalsOnTrack, gate B).
      goals: goalsOnTrack(
        goals.map((g) => ({ status: g.progress.status, lateMonths: late.get(g.id) })),
      ),
      debt: owedSummary(book),
    },
    rules: rules.length,
    actions: Object.fromEntries(
      mine.map((s) => [s.id, { label: s.actionLabel, href: s.actionHref, why: s.why }]),
    ),
    fixes: Object.fromEntries(open.map((o) => [o.id, booksFix(o)])),
    assetPromptHref: prompt ? promptHref(prompt) : null,
    topMerchants: insights.topMerchants.slice(0, 5),
    missing: worth.missing,
  };
}
