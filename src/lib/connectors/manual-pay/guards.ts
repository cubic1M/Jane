import { MANUAL_PAY_AUTOPAY_LOOKBACK_DAYS } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { BadRequest } from "../types";
import { autopayCovers, billerFor, type BankLine } from "./rules";

// What "Jane prepares, you do it" checks against the person's own data before anything goes on a
// card, at the yes, and before it's handed over (Connector.prepare and guard): the account is
// theirs, autopay doesn't already pay it, and the same payment isn't already open. Security review
// on #1506 and #1508: none of this may rest on what the caller passes in.

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Still open: planned, said yes to, running or waiting for the person.
const OPEN = ["awaiting_yes", "approved", "running", "handed_off"];

export async function linesSince(
  userId: string,
  since: string,
  client: PrismaClient,
): Promise<BankLine[]> {
  const rows = await scopedFor(userId, client).transactions.findMany({
    // Both signs: a move between own accounts lands as money in on the other side.
    where: { date: { gte: new Date(`${since}T00:00:00Z`) } },
    select: {
      id: true,
      date: true,
      amountCents: true,
      description: true,
      merchantName: true,
      accountId: true,
    },
  });
  return rows.map((row) => ({ ...row, date: iso(row.date) }));
}

// The person's own account with this id, by name. Anything else is refused: a name or an id from
// a request, a chat or a message is never taken as theirs.
export async function ownAccount(
  userId: string,
  accountId: unknown,
  client: PrismaClient,
): Promise<{ id: string; name: string }> {
  if (typeof accountId !== "string" || !accountId)
    throw new BadRequest("needs one of your accounts");
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: accountId },
    select: { id: true, name: true },
  });
  if (!account) throw new BadRequest("not one of your accounts");
  return account;
}

// Whether autopay already pays this biller for this person, from their own lines.
export async function autopayOn(
  userId: string,
  billerName: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<boolean> {
  const biller = billerFor(billerName);
  if (!biller) return false;
  const since = iso(new Date(now.getTime() - MANUAL_PAY_AUTOPAY_LOOKBACK_DAYS * DAY));
  return autopayCovers(biller, await linesSince(userId, since, client), { today: iso(now) });
}

// Refuses when another open action of this connector is for the same thing (`same` picks the
// detail fields that say so), so one bill isn't paid twice from two cards.
export async function refuseOpenTwin(
  userId: string,
  connectorId: string,
  same: Record<string, string | number | boolean | null>,
  { client, exceptId }: { client: PrismaClient; exceptId?: string },
): Promise<void> {
  const open = await scopedFor(userId, client).connectorActions.findMany({
    where: { connectorId, status: { in: OPEN }, ...(exceptId && { id: { not: exceptId } }) },
    select: { details: true },
  });
  const twin = open.some((row) => {
    const details = row.details as Record<string, unknown>;
    return Object.entries(same).every(([key, value]) => details[key] === value);
  });
  if (twin) throw new BadRequest("the same one is already open");
}
