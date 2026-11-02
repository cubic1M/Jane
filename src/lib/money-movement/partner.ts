import { gated } from "@/lib/permission/gate";
import { randomUUID } from "node:crypto";
import { REAL_MONEY_MOVEMENT, STAND_IN_PARTNER } from "@/config/money-movement";
import { paymentRehearsal } from "@/config/money-rollout";
import { preparedPartner } from "./prepared";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoItemId } from "@/lib/plaid/demo";

// The money-movement partner (spec step 144): where Jane schedules transfers between the
// person's own accounts and payments, once allowed. An interface, so a licensed partner can
// be connected later; until then the stand-in below records each transfer and moves nothing.
// Real money never moves without that partner and counsel's sign-off (REAL_MONEY_MOVEMENT).

export type TransferRequest = {
  fromAccountId: string;
  toAccountId: string | null;
  toName: string;
  amountCents: number;
  // YYYY-MM-DD.
  runOn: string;
  memo: string;
};

// What a partner gets to tell whether a transfer went through: its day, and what it can look up.
export type SettleCheck = Pick<TransferRequest, "runOn"> &
  Partial<Pick<TransferRequest, "amountCents" | "toName">> & { partnerRef?: string | null };

export interface MoneyMovementPartner {
  readonly name: string;
  // True for the stand-in: screens say no real money moves.
  readonly simulated: boolean;
  schedule(request: TransferRequest): Promise<{ partnerRef: string }>;
  cancel(partnerRef: string): Promise<boolean>;
  // Whether a scheduled transfer has gone through by `today` (YYYY-MM-DD).
  settled(request: SettleCheck, today: string): Promise<boolean>;
  // Whether one that went through came back later (a return, up to about 60 days on). A partner
  // without returns leaves this out.
  reversed?(request: SettleCheck): Promise<boolean>;
}

// Records only. A transfer "goes through" on its day; nothing leaves the app.
export const standInPartner: MoneyMovementPartner = gated(
  "money_movement",
  {
    name: STAND_IN_PARTNER,
    simulated: true,
    async schedule() {
      return { partnerRef: `SIMXFER-${randomUUID().slice(0, 8).toUpperCase()}` };
    },
    async cancel() {
      return true;
    },
    async settled({ runOn }, today) {
      return runOn <= today;
    },
  },
  ["schedule"],
);

// The partner for this person: the stand-in when their data is only the demo bank; nobody
// else until a real partner is connected.
export async function moneyPartnerFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<MoneyMovementPartner | null> {
  // Off: a real partner goes here only with a licensed partner and counsel's sign-off, as a code
  // change (src/lib/money-movement/queue.ts and ./adapters are built, mocked and unconnected).
  if (REAL_MONEY_MOVEMENT) return null;
  const db = scopedFor(userId, client);
  const [items, csv] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: "csv" } }),
  ]);
  const demoOnly = items.length > 0 && csv === 0 && items.every((i) => isDemoItemId(i.plaidItemId));
  if (!demoOnly) return null;
  // The rehearsal of Stage 3's first step, on sample data.
  return paymentRehearsal() ? preparedPartner(userId, { client }) : standInPartner;
}
