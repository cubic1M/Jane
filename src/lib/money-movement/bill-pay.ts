import { BILL_PAY_HORIZON_DAYS, BILL_PAYMENT_CATEGORIES } from "@/config/money-movement";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { expectedDates, forecastAccounts, incomeStreams } from "@/detection/forecast";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import {
  billPlan,
  dueDateMove,
  type BillPlan,
  type DueBill,
  type ForecastDay,
} from "@/planning/bill-pay";
import { moneyPartnerFor, type MoneyMovementPartner } from "./partner";
import { scheduleTransfer, TransferError } from "./transfers";

// Bills paid on time (spec step 145), through the money-movement partner (the stand-in for
// demo-bank people; nobody else yet). For each card or loan due in the next few weeks that
// the person's own autopay doesn't cover, Jane schedules a payment a couple of days early,
// by herself where Subscriptions and bills' autopilot allows it within its caps, otherwise
// with one tap. Never one that would take checking's forecast below zero. A due date before
// payday on which checking runs short is worth moving, and she says so.

type Options = { client?: PrismaClient; now?: Date; partner?: MoneyMovementPartner | null };

export type BillPayItem =
  | { status: "autopay"; bill: DueBill; planKey: string }
  | {
      status: "scheduled";
      bill: DueBill;
      planKey: string;
      amountCents: number;
      runOn: string;
      by: string;
    }
  | {
      status: "ask";
      bill: DueBill;
      planKey: string;
      amountCents: number;
      runOn: string;
      full: boolean;
    }
  | { status: "short"; bill: DueBill; planKey: string; moveTo: string | null };

export type BillPayView = {
  checkingAccountId: string | null;
  payday: string | null;
  items: BillPayItem[];
};

const day = (now: Date) => now.toISOString().slice(0, 10);
export const billKey = (b: Pick<DueBill, "accountId" | "dueOn">) =>
  `bill:${b.accountId}:${b.dueOn}`;

async function dueBills(
  userId: string,
  input: DetectionInput,
  client: PrismaClient,
): Promise<DueBill[]> {
  const until = addDays(input.asOf, BILL_PAY_HORIZON_DAYS);
  const liabilities = await scopedFor(userId, client).liabilities.findMany({
    where: {
      minimumPaymentCents: { gt: 0 },
      nextPaymentDueDate: {
        gte: new Date(`${input.asOf}T00:00:00Z`),
        lte: new Date(`${until}T00:00:00Z`),
      },
    },
    select: { accountId: true, kind: true, minimumPaymentCents: true, nextPaymentDueDate: true },
  });
  const checking = new Set(
    input.accounts
      .filter((a) => a.type === "depository" && a.subtype === "checking")
      .map((a) => a.id),
  );
  const payments = buildStreams(input).filter(
    (s) => s.active && s.accountId && checking.has(s.accountId),
  );
  return liabilities.flatMap((l): DueBill[] => {
    const account = input.accounts.find((a) => a.id === l.accountId);
    if (!account || !l.nextPaymentDueDate) return [];
    const dueOn = day(l.nextPaymentDueDate);
    const category = BILL_PAYMENT_CATEGORIES[l.kind];
    const autopay = payments
      .filter((s) => category && s.pfcDetailed === category)
      .flatMap((s) =>
        expectedDates(s, input.asOf, dueOn)
          .filter((d) => d > input.asOf && d <= dueOn)
          .map((date) => ({ date, amountCents: s.lastAmountCents })),
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return [
      {
        accountId: account.id,
        name: account.name,
        kind: l.kind,
        dueOn,
        minimumCents: l.minimumPaymentCents!,
        balanceCents: account.currentBalanceCents,
        autopay: autopay ?? null,
      },
    ];
  });
}

// Checking's forecast, less the transfers already pending out of it.
async function checkingSeries(
  userId: string,
  input: DetectionInput,
  client: PrismaClient,
): Promise<{ accountId: string | null; series: ForecastDay[] }> {
  const forecast = forecastAccounts(input, BILL_PAY_HORIZON_DAYS + 7).find(
    (f) => input.accounts.find((a) => a.id === f.accountId)?.subtype === "checking",
  );
  if (!forecast) return { accountId: null, series: [] };
  const pending = await scopedFor(userId, client).moneyTransfers.findMany({
    where: { status: "pending", fromAccountId: forecast.accountId },
    select: { runOn: true, amountCents: true },
  });
  const series = forecast.days.map((d) => ({
    date: d.date,
    balanceCents:
      d.balanceCents -
      pending.filter((p) => day(p.runOn) <= d.date).reduce((sum, p) => sum + p.amountCents, 0),
  }));
  return { accountId: forecast.accountId, series };
}

const nextPayday = (input: DetectionInput) =>
  incomeStreams(input)
    .filter((s) => s.active)
    .flatMap((s) => expectedDates(s, input.asOf, addDays(input.asOf, 45)))
    .filter((d) => d > input.asOf)
    .sort()[0] ?? null;

// What's due and what covers it: for the chat, Claude and runBillPay.
export async function loadBillPay(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input: given,
  }: Options & { input?: DetectionInput } = {},
): Promise<BillPayView> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const [bills, { accountId, series }] = await Promise.all([
    dueBills(userId, input, client),
    checkingSeries(userId, input, client),
  ]);
  const payday = nextPayday(input);
  const scheduled = await scopedFor(userId, client).moneyTransfers.findMany({
    where: { planKey: { in: bills.map(billKey) }, status: { in: ["pending", "completed"] } },
    select: { planKey: true, amountCents: true, runOn: true, by: true },
  });
  const items = bills.map((bill): BillPayItem => {
    const planKey = billKey(bill);
    const done = scheduled.find((t) => t.planKey === planKey);
    if (done) {
      return {
        status: "scheduled",
        bill,
        planKey,
        amountCents: done.amountCents,
        runOn: day(done.runOn),
        by: done.by,
      };
    }
    if (!accountId) return { status: "short", bill, planKey, moveTo: null };
    const plan: BillPlan = billPlan(bill, series, input.asOf);
    if (plan.status === "autopay") return { status: "autopay", bill, planKey };
    if (plan.status === "pay") {
      return {
        status: "ask",
        bill,
        planKey,
        amountCents: plan.amountCents,
        runOn: plan.runOn,
        full: plan.full,
      };
    }
    return { status: "short", bill, planKey, moveTo: dueDateMove(bill, series, payday) };
  });
  return { checkingAccountId: accountId, payday, items };
}

export class BillPayError extends Error {}

// Pays one bill: by autopilot within its caps, or on the person's tap. Checked again at the
// moment of scheduling, so it never overdraws even if things moved since it was asked.
export async function payBill(
  userId: string,
  planKey: string,
  by: "autopilot" | "person",
  {
    client = defaultClient,
    now = new Date(),
    partner,
    input,
  }: Options & { input?: DetectionInput } = {},
): Promise<{ amountCents: number; runOn: string; name: string }> {
  const view = await loadBillPay(userId, { client, now, input });
  const item = view.items.find((i) => i.planKey === planKey);
  if (!item || item.status === "scheduled" || item.status === "autopay") {
    throw new BillPayError("That bill is already set to be paid.");
  }
  if (item.status === "short" || !view.checkingAccountId) {
    throw new BillPayError("Checking can't take that payment right now without running short.");
  }
  try {
    const { runOn } = await scheduleTransfer(
      userId,
      {
        fromAccountId: view.checkingAccountId,
        toAccountId: item.bill.accountId,
        toName: item.bill.name,
        amountCents: item.amountCents,
        purpose: "bill",
        sector: "bills",
        planKey,
        runOn: item.runOn,
      },
      by,
      { client, now, partner },
    );
    return { amountCents: item.amountCents, runOn, name: item.bill.name };
  } catch (error) {
    if (error instanceof TransferError) throw new BillPayError(error.message);
    throw error;
  }
}

// What Jane does by herself: each bill Subscriptions and bills' autopilot may pay within its
// caps. The rest waits for the person's tap in the chat.
export async function runBillPay(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    input,
  }: Options & { input?: DetectionInput } = {},
): Promise<number> {
  const movement = partner === undefined ? await moneyPartnerFor(userId, { client }) : partner;
  if (!movement) return 0;
  const view = await loadBillPay(userId, { client, now, input });
  let paid = 0;
  for (const item of view.items) {
    if (item.status !== "ask") continue;
    const allowed = await mayAct(
      userId,
      "bills",
      { needs: "all", cents: item.amountCents },
      { client, now },
    );
    if (!allowed.ok) continue;
    try {
      await payBill(userId, item.planKey, "autopilot", { client, now, partner: movement, input });
    } catch (error) {
      if (error instanceof BillPayError) continue;
      throw error;
    }
    await recordAct(userId, "bills", item.amountCents, `Scheduled the ${item.bill.name} payment`, {
      client,
      now,
    });
    paid += 1;
  }
  return paid;
}
