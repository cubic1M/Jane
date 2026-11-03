import { plaidItemLimit, plaidItemWarnAt } from "@/config/plaid-items";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { systemDb } from "@/lib/system-db";

// The number the founders see: how many Plaid Production Items were ever created
// (src/lib/plaid/item-slots.ts takes and gives back the slots). On its own so the health check can
// read it without loading sign-in. System-wide and with no personal data, so it isn't scoped.

export const COUNTER_ID = "production";

export async function itemSlotUse({ client = defaultClient }: { client?: PrismaClient } = {}) {
  const limit = plaidItemLimit();
  const row = await systemDb(
    "The bank-link counter is the system's own",
    client,
  ).plaidItemCounter.findUnique({
    where: { id: COUNTER_ID },
    select: { used: true },
  });
  return { used: row?.used ?? 0, limit, warnAt: plaidItemWarnAt(limit) };
}

export const bankConnectionsLine = ({ used, limit }: { used: number; limit: number }) =>
  `${used} of ${limit} bank connections used`;
