import { randomUUID } from "node:crypto";
import {
  PREPARED_AMOUNT_TOLERANCE,
  PREPARED_EARLY_DAYS,
  PREPARED_REMIND_DAYS,
} from "@/config/money-rollout";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlerts } from "@/lib/alerts";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDays, isoDay } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { MoneyMovementPartner } from "./partner";

// "Jane prepares, you pay" (connector-plan.md): Stage 3's first step, and the only route verified to
// keep money away from Jane. No vendor: the instruction is kept and the person is reminded, they pay
// from their own bank, and later data shows it. `simulated` is false because nothing is pretended:
// the person's real bank moves the money, and only if they do it. Off for real accounts for now.

export const PREPARED_PARTNER = "Jane prepares, you pay";

const keyOf = (text: string) => normalizeMerchant(text)?.key ?? text.trim().toLowerCase();

// The person's own payment, on their own statement: about the amount, near its day, to that payee.
export function preparedPartner(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): MoneyMovementPartner {
  return {
    name: PREPARED_PARTNER,
    simulated: false,
    async schedule() {
      return { partnerRef: `PREP-${randomUUID().slice(0, 8).toUpperCase()}` };
    },
    // There's nothing to call off: dropping the instruction is the whole of it.
    async cancel() {
      return true;
    },
    async settled({ runOn, amountCents, toName }, today) {
      if (amountCents === undefined || toName === undefined) return false;
      const debits = await scopedFor(userId, client).transactions.findMany({
        where: {
          pending: false,
          date: {
            gte: new Date(`${addDays(runOn, -PREPARED_EARLY_DAYS)}T00:00:00Z`),
            lte: new Date(`${today}T00:00:00Z`),
          },
          amountCents: {
            gte: Math.floor(amountCents * (1 - PREPARED_AMOUNT_TOLERANCE)),
            lte: Math.ceil(amountCents * (1 + PREPARED_AMOUNT_TOLERANCE)),
          },
        },
        select: { description: true, merchantName: true },
      });
      const payee = keyOf(toName);
      return debits.some(
        (d) =>
          keyOf(d.merchantName ?? d.description) === payee ||
          d.description.toLowerCase().includes(toName.toLowerCase()),
      );
    },
  };
}

// A reminder, a few days before each prepared payment's day.
export async function remindPrepared(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<number> {
  const today = isoDay(now);
  const due = await scopedFor(userId, client).moneyTransfers.findMany({
    where: {
      partner: PREPARED_PARTNER,
      status: "pending",
      runOn: { lte: new Date(`${addDays(today, PREPARED_REMIND_DAYS)}T00:00:00Z`) },
    },
    select: { partnerRef: true, toName: true, amountCents: true, runOn: true },
  });
  if (due.length === 0) return 0;
  await raiseAlerts(
    userId,
    due.map((t) => ({
      type: "bill_due" as const,
      key: `prepared:${t.partnerRef}:${isoDay(t.runOn)}`,
      title: `Pay ${formatCents(t.amountCents)} to ${t.toName} by ${dayLabel(isoDay(t.runOn))}`,
      body: "Jane got it ready. You pay it from your own bank, and Jane marks it paid when it shows on your statement.",
      confidence: { percent: 100, reason: "the payment you said yes to" },
    })),
    { client, now },
  );
  return due.length;
}
