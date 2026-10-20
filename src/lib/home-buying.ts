import {
  HOME_DEFAULT_DOWN_SHARE,
  HOME_DEFAULT_SAVE_MONTHS,
  HOME_GOAL_NAME,
  HOME_TERM_MONTHS,
} from "@/config/home-buying";
import { loadDetectionInput } from "@/detection/engine";
import { addDays } from "@/detection/units";
import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { spendingInsights } from "@/insights/spending";
import { track } from "@/lib/analytics";
import { creditBandFor } from "@/lib/credit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { GoalError, addGoal } from "@/lib/goals";
import { lenderPartnerFor } from "@/lib/refinance";
import {
  affordability,
  homeCosts,
  savingPlan,
  type Affordability,
  type HomeCosts,
  type SavingPlan,
} from "@/planning/home-buying";
import { compareCarOffers, type ScoredCarOffer } from "@/planning/car";
import { formatCents } from "@/lib/money";

// Buying a home (spec step 179), from saving to closing. From the person's own income,
// debt payments, savings and monthly cash flow: the most they can afford under the usual
// 28/36 rules, the monthly cost of a price with mortgage insurance explained, closing costs
// estimated, mortgage offers compared by total cost, and a plan to save for the cash needed
// by a date, started as a goal with one tap (step 157 invests every goal for its timeline).
// Demo advice, every assumption shown; nothing is applied for here.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput; book?: DebtBook };

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const MONTHS = 3;

export class HomeBuyingError extends Error {}

export type HomeQuestion = { priceCents?: number; downShare?: number; targetDate?: string };

export type HomeBuying = {
  available: boolean;
  missing: "income" | null;
  affordability: Affordability | null;
  costs: HomeCosts | null;
  downShare: number;
  aprBps: number | null;
  offers: ScoredCarOffer[];
  saving: SavingPlan | null;
  targetDate: string;
  savedCents: number;
  monthlySavingCents: number;
  hasGoal: boolean;
  assumptions: string[];
};

const none = (targetDate: string, downShare: number): HomeBuying => ({
  available: false,
  missing: null,
  affordability: null,
  costs: null,
  downShare,
  aprBps: null,
  offers: [],
  saving: null,
  targetDate,
  savedCents: 0,
  monthlySavingCents: 0,
  hasGoal: false,
  assumptions: [],
});

const addMonths = (day: string, months: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

export async function loadHomeBuying(
  userId: string,
  question: HomeQuestion = {},
  { client = defaultClient, now = new Date(), input: given, book: givenBook }: Options = {},
): Promise<HomeBuying> {
  const asOf = isoDay(now);
  const downShare = question.downShare ?? HOME_DEFAULT_DOWN_SHARE;
  const targetDate = question.targetDate ?? addMonths(asOf, HOME_DEFAULT_SAVE_MONTHS);
  const found = await lenderPartnerFor(userId, { client });
  if (!found) return none(targetDate, downShare);
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const db = scopedFor(userId, client);
  const [book, creditBand, goals] = await Promise.all([
    debtsOr(givenBook, userId, { client, now }),
    creditBandFor(userId, { client }),
    db.savingsGoals.findMany({ where: { name: HOME_GOAL_NAME }, select: { id: true } }),
  ]);
  const lastFull = addDays(`${asOf.slice(0, 7)}-01`, -1);
  const months = spendingInsights(
    input.transactions.map((t) => ({ ...t, pending: false })),
    { asOf: lastFull, monthCount: MONTHS },
  ).months.filter((m) => m.incomeCents > 0);
  if (months.length === 0)
    return { ...none(targetDate, downShare), available: true, missing: "income" };
  const avg = (f: (m: (typeof months)[number]) => number) =>
    Math.round(months.reduce((s, m) => s + f(m), 0) / months.length);
  const monthlyIncomeCents = avg((m) => m.incomeCents);
  const monthlySpendingCents = avg((m) => m.spendingCents);
  const monthlySavingCents = Math.max(0, monthlyIncomeCents - monthlySpendingCents);
  const debtPaymentsCents = book.debts.reduce(
    (s, d) =>
      s +
      (d.paymentCents ?? 0) *
        (d.paymentEvery === "two_weeks" ? 2 : 1) *
        // A mortgage already owned is replaced, not added to.
        (d.kind === "mortgage" ? 0 : 1),
    0,
  );
  const savedCents = input.accounts
    .filter((a) => a.type === "depository" && a.subtype === "savings")
    .reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);

  // The rate: the cheapest mortgage offer for a reference loan.
  const offersFor = async (loanCents: number) =>
    compareCarOffers(
      await found.partner.prequalify({
        product: "mortgage",
        amountCents: loanCents,
        termMonths: HOME_TERM_MONTHS,
        creditBand,
        month: asOf.slice(0, 7),
      }),
      loanCents,
      HOME_TERM_MONTHS,
    );
  const reference = await offersFor(30_000_000);
  const aprBps = reference[0]?.offer.aprBps ?? null;
  if (aprBps === null) return { ...none(targetDate, downShare), available: true };
  const afford = affordability({
    monthlyNetIncomeCents: monthlyIncomeCents,
    debtPaymentsCents,
    downShare,
    aprBps,
    termMonths: HOME_TERM_MONTHS,
  });
  const priceCents = question.priceCents ?? afford.maxPriceCents;
  const costs = homeCosts({ priceCents, downShare, aprBps, termMonths: HOME_TERM_MONTHS });
  const offers = costs.loanCents > 0 ? await offersFor(costs.loanCents) : [];
  const saving = savingPlan({
    cashNeededCents: costs.cashNeededCents,
    savedCents,
    monthlySavingCents,
    asOf,
    targetDate,
  });
  return {
    available: true,
    missing: null,
    affordability: afford,
    costs,
    downShare,
    aprBps,
    offers,
    saving,
    targetDate,
    savedCents,
    monthlySavingCents,
    hasGoal: goals.length > 0,
    assumptions: [
      `Income: ${formatCents(monthlyIncomeCents)} a month take-home, your average over the last ${months.length} full ${months.length === 1 ? "month" : "months"}, about ${formatCents(afford.grossMonthlyCents)} before tax (take-home divided by 0.78).`,
      `Lenders' usual rules: housing at most 28% of gross (${formatCents(afford.housingLimitCents)}) and all debt payments at most 36% (${formatCents(afford.debtLimitCents)}); your other debt payments are ${formatCents(debtPaymentsCents)} a month.`,
      `A ${Math.round(downShare * 100)}% down payment, a 30-year fixed loan at ${(aprBps / 100).toFixed(2)}%, the cheapest mortgage offer for your credit.`,
      `Property tax 1.1% and insurance 0.35% of the price a year${downShare < 0.2 ? ", and mortgage insurance 0.7% of the loan while you put down under 20%" : ""}; closing costs 3% of the price.`,
      `Saving: you keep about ${formatCents(monthlySavingCents)} a month (income less spending, last ${months.length} full months) and have ${formatCents(savedCents)} in savings.`,
    ],
  };
}

// The person tapped Start the goal: a savings goal for the cash needed by the date, in the
// goals list where step 157 invests it for its timeline.
export async function startHomeGoal(
  userId: string,
  question: HomeQuestion,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ targetCents: number; targetDate: string }> {
  const home = await loadHomeBuying(userId, question, { client, now });
  if (!home.available || !home.costs)
    throw new HomeBuyingError("I can't plan a home purchase for your accounts yet.");
  if (home.hasGoal) throw new HomeBuyingError(`You already have a "${HOME_GOAL_NAME}" goal.`);
  const savings = await scopedFor(userId, client).accounts.findFirst({
    where: { type: "depository", subtype: "savings" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  try {
    await addGoal(
      userId,
      {
        name: HOME_GOAL_NAME,
        target: (home.costs.cashNeededCents / 100).toFixed(2),
        targetDate: home.targetDate,
        accountId: savings?.id ?? "",
        saved: "",
      },
      { client },
    );
  } catch (error) {
    if (error instanceof GoalError) throw new HomeBuyingError(error.message);
    throw error;
  }
  await track(userId, "home_goal_started");
  return { targetCents: home.costs.cashNeededCents, targetDate: home.targetDate };
}
