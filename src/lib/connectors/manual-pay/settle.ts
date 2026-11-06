import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";
import { applyPartnerEvent } from "../pipeline";
import { linesSince } from "./guards";
import { billerFor, findSettlement } from "./rules";

// After "Jane prepares, you pay": the person's own transactions say whether they paid. A bill is
// marked paid only on a line from the account it was to come from, of the exact amount, in its
// window, that names the biller (security review on #1506: a $100 grocery line mustn't pay a $100
// electricity bill). An amount-only match stays handed off, with a note to check it. And a bank
// line settles one action at most, ever: it's claimed in connector_webhook_events, the same table
// that refuses a replayed webhook.

export { autopayOn } from "./guards";

type Options = { client?: PrismaClient; now?: Date };

const WHY = "Bank lines already used to settle a manual payment: ids only";
const LINES = "bank_lines";
const LOOKS_PAID = (date: string) =>
  `Looks paid on ${date}, but the bank line doesn't name them: check it's this bill.`;

async function claimedAlready(lineIds: string[], client: PrismaClient): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const rows = await systemDb(WHY, client).connectorWebhookEvent.findMany({
    where: { connectorId: LINES, eventId: { in: lineIds } },
    select: { eventId: true },
  });
  return new Set(rows.map((row) => row.eventId));
}

// True if this run got the line; false if another action already has it.
async function claim(lineId: string, client: PrismaClient, now: Date): Promise<boolean> {
  const { count } = await systemDb(WHY, client).connectorWebhookEvent.createMany({
    data: [{ connectorId: LINES, eventId: lineId, receivedAt: now }],
    skipDuplicates: true,
  });
  return count === 1;
}

// Every handed-off manual payment of this person's that has now posted. Returns how many settled.
export async function settleManualPayments(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const waiting = await db.connectorActions.findMany({
    where: { connectorId: "manual_bill_pay", status: "handed_off" },
    orderBy: { createdAt: "asc" },
    select: { id: true, externalRef: true, details: true, note: true },
  });
  if (waiting.length === 0) return 0;
  const payOns = waiting.map((w) => String((w.details as { payOn?: unknown }).payOn ?? ""));
  const lines = (await linesSince(userId, payOns.sort()[0]!, client)).filter(
    (line) => line.amountCents > 0,
  );
  const taken = await claimedAlready(
    lines.map((line) => line.id),
    client,
  );
  let settled = 0;
  for (const action of waiting) {
    const details = action.details as Record<string, unknown>;
    const biller = billerFor(String(details.biller ?? ""));
    const accountId = typeof details.fromAccountId === "string" ? details.fromAccountId : null;
    // No account to look in, or a biller Jane can't name on a bank line: nothing to settle on.
    if (!biller || !accountId || !action.externalRef) continue;
    const found = findSettlement(
      {
        biller,
        amountCents: Number(details.amountCents),
        payOn: String(details.payOn ?? ""),
        accountId,
      },
      lines,
      taken,
    );
    if (!found) continue;
    const line = lines.find((l) => l.id === found.lineId)!;
    if (found.confidence !== "amount_days_and_name") {
      const note = LOOKS_PAID(line.date);
      if (action.note !== note) {
        await db.connectorActions.updateMany({
          where: { id: action.id, status: "handed_off" },
          data: { note },
        });
      }
      continue;
    }
    if (!(await claim(line.id, client, now))) continue;
    taken.add(line.id);
    const moved = await applyPartnerEvent(
      userId,
      action.id,
      {
        eventId: `bank_line_${line.id}`,
        externalRef: action.externalRef,
        outcome: "done",
        note: `Paid: seen in your account on ${line.date}.`,
      },
      { client, now },
    );
    if (moved) settled += 1;
  }
  return settled;
}
