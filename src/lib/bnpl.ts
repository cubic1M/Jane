import { PAYOFF_CUSHION_CENTS } from "@/config/bnpl";
import { FORECAST_DAYS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts, upcomingBills } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { track } from "@/lib/analytics";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { scheduleTransfer, TransferError } from "@/lib/money-movement/transfers";
import {
  addDays,
  freePayoff,
  installments,
  notInForecast,
  warnNewPlan,
  type Installment,
  type PlanSchedule,
} from "@/planning/bnpl";
import { isoDay } from "@/lib/dates";

// Buy now, pay later under control (spec step 176). Every plan with its next installments
// from the plan's own schedule, the ones the checking forecast doesn't count yet, a
// warning before a new plan would strain the month (from the same forecast), and paying a
// Pay in 4 plan off early when it costs nothing. Moving money goes through the
// money-movement stand-in, only on a tap.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput; book?: DebtBook };

export const payoffKey = (planKey: string) => `${planKey}:payoff`;

export class BnplError extends Error {}

export type BnplPlanView = PlanSchedule & {
  provider: string;
  aprBps: number | null;
  // Paying it off now costs nothing extra (a Pay in 4 plan), and checking can cover it.
  freePayoff: boolean;
  canCoverPayoff: boolean;
  payoffScheduled: boolean;
};

export type Bnpl = {
  available: boolean;
  asOf: string;
  plans: BnplPlanView[];
  // The next FORECAST_DAYS of installments, soonest first.
  installments: Installment[];
  // The ones the forecast's bills don't already include, and their total before payday.
  missing: Installment[];
  checkingCents: number | null;
  // A day-by-day checking balance for the warning; empty without a checking account.
  forecastDays: { date: string; balanceCents: number }[];
};

const none = (asOf: string): Bnpl => ({
  available: false,
  asOf,
  plans: [],
  installments: [],
  missing: [],
  checkingCents: null,
  forecastDays: [],
});

export async function loadBnpl(
  userId: string,
  { client = defaultClient, now = new Date(), input: given, book: givenBook }: Options = {},
): Promise<Bnpl> {
  const asOf = isoDay(now);
  const [book, input, advice] = await Promise.all([
    debtsOr(givenBook, userId, { client, now }),
    given ? Promise.resolve(given) : loadDetectionInput(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  const plans = book.debts.filter((d) => d.kind === "bnpl");
  if (plans.length === 0) return { ...none(asOf), available: advice };
  const until = addDays(asOf, FORECAST_DAYS);
  const list = installments(
    plans.map((d) => ({
      key: d.key,
      name: d.name,
      paymentCents: d.paymentCents ?? 0,
      every: d.paymentEvery,
      nextDue: d.nextDue,
      balanceCents: d.balanceCents,
    })),
    asOf,
    until,
  );
  const forecast = forecastAccounts(input, FORECAST_DAYS)[0];
  const bills = upcomingBills(input, FORECAST_DAYS).map((b) => ({
    date: b.date,
    amountCents: b.amountCents,
  }));
  const checking = forecast?.startCents ?? null;
  const done = await scopedFor(userId, client).moneyTransfers.findMany({
    where: {
      status: { in: ["pending", "completed"] },
      planKey: { in: plans.map((p) => payoffKey(p.key)) },
    },
    select: { planKey: true },
  });
  return {
    available: true,
    asOf,
    plans: plans.map((d) => {
      const schedule = {
        key: d.key,
        name: d.name,
        paymentCents: d.paymentCents ?? 0,
        every: d.paymentEvery,
        nextDue: d.nextDue,
        balanceCents: d.balanceCents,
      };
      const free = freePayoff({
        every: d.paymentEvery,
        balanceCents: d.balanceCents,
        aprBps: d.aprBps,
      });
      return {
        ...schedule,
        provider: d.name.split(" ")[0],
        aprBps: d.aprBps,
        freePayoff: free,
        canCoverPayoff:
          free && checking !== null && checking - (d.balanceCents ?? 0) >= PAYOFF_CUSHION_CENTS,
        payoffScheduled: done.some((t) => t.planKey === payoffKey(d.key)),
      };
    }),
    installments: list,
    missing: notInForecast(list, bills),
    checkingCents: checking,
    forecastDays: forecast?.days ?? [],
  };
}

// "Can I afford a $300 Klarna plan?": a new Pay in 4 plan against the checking forecast
// (pure, in src/planning/bnpl.ts, so chat replies can use it without the database).
export { warnNewPlan };

// The person tapped Pay it off: the plan's balance, through the money-movement stand-in.
export async function payOffPlan(
  userId: string,
  planKey: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ amountCents: number; name: string; runOn: string }> {
  const data = await loadBnpl(userId, { client, now });
  const plan = data.plans.find((p) => p.key === planKey);
  if (!plan) throw new BnplError("That plan isn't on your list any more.");
  if (!plan.freePayoff) throw new BnplError("I can't tell that paying this one off early is free.");
  if (plan.payoffScheduled) throw new BnplError("You've already scheduled paying it off.");
  if (!plan.canCoverPayoff) {
    throw new BnplError("Checking can't cover it and keep its cushion right now.");
  }
  const partner = await moneyPartnerFor(userId, { client });
  const checking = await scopedFor(userId, client).accounts.findFirst({
    where: { type: "depository", subtype: "checking" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!partner || !checking)
    throw new BnplError("Moving money isn't available for your accounts yet.");
  try {
    const t = await scheduleTransfer(
      userId,
      {
        fromAccountId: checking.id,
        toAccountId: null,
        toName: plan.name,
        amountCents: plan.balanceCents!,
        purpose: "debt",
        sector: "debt",
        planKey: payoffKey(plan.key),
      },
      "person",
      { client, now, partner },
    );
    await track(userId, "bnpl_payoff_scheduled");
    return { amountCents: plan.balanceCents!, name: plan.name, runOn: t.runOn };
  } catch (error) {
    if (error instanceof TransferError) throw new BnplError(error.message);
    throw error;
  }
}
