import { NOT_FROM_A_BANK } from "@/data-sources/types";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoOnly } from "@/lib/digest/recipients";
import { cachedRead } from "@/lib/read-cache";

// Every account this person has comes from the demo bank, so all they see is sample data. Demo
// advice, read-only mode, the money partner, the activity log and more each ask: read once inside a
// read cache (src/lib/read-cache.ts).
export async function onlyDemoBank(userId: string, client: PrismaClient): Promise<boolean> {
  return cachedRead(`onlyDemoBank:${userId}`, client, () => onlyDemoBankFrom(userId, client));
}

async function onlyDemoBankFrom(userId: string, client: PrismaClient): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [items, ownAccounts] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: { in: [...NOT_FROM_A_BANK] } } }),
  ]);
  return isDemoOnly(
    items.map((i) => i.plaidItemId),
    ownAccounts,
  );
}
