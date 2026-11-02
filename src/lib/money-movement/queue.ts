import { randomUUID } from "node:crypto";
import { BILL_PAY_MIN_LEFT_CENTS } from "@/config/money-movement";
import type { Sector } from "@/config/autopilot-sectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isoDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PermissionRefused, throughPermission } from "@/lib/permission/check";
import { NotLinked, type LinkLookup, type PaymentAdapter } from "./adapters/types";
import type { MoneyMovementPartner, TransferRequest } from "./partner";

// A real vendor behind Jane's own interface: `schedule` only queues, so the one-day undo is Jane's to
// keep, and the vendor is called on the run-on date (dispatchDue), once more through the permission
// check and with the safe-to-spend cushion checked again. Off: REAL_MONEY_MOVEMENT is false, and no
// code selects this for a person (src/lib/money-movement/partner.ts).

const QUEUED = "queued:";
export const isQueued = (partnerRef: string | null | undefined) =>
  partnerRef?.startsWith(QUEUED) ?? false;

export function queuedPartner(adapter: PaymentAdapter): MoneyMovementPartner {
  return {
    name: adapter.name,
    simulated: false,
    async schedule() {
      return { partnerRef: `${QUEUED}${randomUUID()}` };
    },
    // Still in Jane's queue: nothing was ever sent. Sent: whatever the vendor allows.
    async cancel(partnerRef) {
      return isQueued(partnerRef) ? true : adapter.cancel(partnerRef);
    },
    async settled({ partnerRef }) {
      if (!partnerRef || isQueued(partnerRef)) return false;
      return (await adapter.status(partnerRef)) === "settled";
    },
    async reversed({ partnerRef }) {
      if (!partnerRef || isQueued(partnerRef)) return false;
      const status = await adapter.status(partnerRef);
      return status === "reversed" || status === "failed";
    },
  };
}

// The vendor for a transfer: a bill or a loan, or the person's own accounts. Own accounts come after
// bills in the rollout, and are refused before now.
export function routedAdapter(bills: PaymentAdapter, ownAccounts: PaymentAdapter): PaymentAdapter {
  // The ref says which vendor has it.
  const of = (ref: string) => {
    const [name, ...rest] = ref.split(":");
    const adapter = [bills, ownAccounts].find((a) => a.name === name);
    if (!adapter) throw new Error(`No adapter for ${name}`);
    return { adapter, partnerRef: rest.join(":") };
  };
  return {
    name: `${bills.name}+${ownAccounts.name}`,
    async send(request, options) {
      const adapter = request.toAccountId ? ownAccounts : bills;
      const { partnerRef } = await adapter.send(request, options);
      return { partnerRef: `${adapter.name}:${partnerRef}` };
    },
    cancel(ref) {
      const { adapter, partnerRef } = of(ref);
      return adapter.cancel(partnerRef);
    },
    status(ref) {
      const { adapter, partnerRef } = of(ref);
      return adapter.status(partnerRef);
    },
  };
}

type Options = { client?: PrismaClient; now?: Date };

async function linksOf(userId: string, partner: string, client: PrismaClient): Promise<LinkLookup> {
  const rows = await scopedFor(userId, client).partnerLinks.findMany({
    select: { partner: true, kind: true, ref: true, partnerId: true },
  });
  const names = partner.split("+");
  const found = new Map(
    rows.filter((r) => names.includes(r.partner)).map((r) => [`${r.kind}|${r.ref}`, r.partnerId]),
  );
  return (kind, ref) => found.get(`${kind}|${ref}`) ?? null;
}

export type Dispatched = { sent: number; held: { id: string; why: string }[] };

// The queue's day has come: each transfer goes to the vendor, if the person still has their cushion
// and it still passes the check. What can't go stays queued, and says why.
export async function dispatchDue(
  userId: string,
  adapter: PaymentAdapter,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Dispatched> {
  const db = scopedFor(userId, client);
  const due = await db.moneyTransfers.findMany({
    where: {
      status: "pending",
      partnerRef: { startsWith: QUEUED },
      runOn: { lte: new Date(`${isoDay(now)}T00:00:00Z`) },
    },
    select: {
      id: true,
      fromAccountId: true,
      toAccountId: true,
      toName: true,
      amountCents: true,
      runOn: true,
      by: true,
      sector: true,
      purpose: true,
      planKey: true,
      partnerRef: true,
    },
  });
  const out: Dispatched = { sent: 0, held: [] };
  if (due.length === 0) return out;
  const link = await linksOf(userId, adapter.name, client);
  for (const t of due) {
    const from = await db.accounts.findFirst({
      where: { id: t.fromAccountId },
      select: { currentBalanceCents: true },
    });
    const balance = from?.currentBalanceCents ?? 0;
    if (balance - t.amountCents < BILL_PAY_MIN_LEFT_CENTS) {
      out.held.push({ id: t.id, why: "It would eat your cushion." });
      continue;
    }
    const request: TransferRequest = {
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      toName: t.toName,
      amountCents: t.amountCents,
      runOn: isoDay(t.runOn),
      memo: t.planKey ?? t.purpose,
    };
    try {
      const { partnerRef } = await throughPermission(
        userId,
        {
          specialist: "money_movement",
          what: `Paid ${formatCents(t.amountCents)} to ${t.toName}`,
          sector: t.sector,
          cents: t.amountCents,
          authority:
            t.by === "person"
              ? { kind: "yes" }
              : { kind: "standing", sector: t.sector as Sector, needs: "safe" },
          // It waited out its day in the queue, where it could be undone.
          undo: { kind: "held", until: t.runOn },
          payment: { ownAccount: t.toAccountId !== null },
        },
        { client, now },
        () => adapter.send(request, { key: t.partnerRef!.slice(QUEUED.length), link }),
      );
      await db.moneyTransfers.updateMany({ where: { id: t.id }, data: { partnerRef } });
      out.sent += 1;
    } catch (error) {
      if (!(error instanceof PermissionRefused) && !(error instanceof NotLinked)) throw error;
      out.held.push({ id: t.id, why: error.message });
    }
  }
  return out;
}
