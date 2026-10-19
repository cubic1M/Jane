import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { syncDemoInvestments } from "@/lib/plaid/sync";

// The nightly price refresh (spec step 156): every demo bank's holdings revalued at the
// stand-in feed's latest prices. Real banks' prices come with their own sync.

export async function refreshDemoPrices({
  client = defaultClient,
  now = new Date(),
}: { client?: PrismaClient; now?: Date } = {}) {
  // A system job across all users: it reads item ids only; each refresh is scoped.
  const items = await client.plaidItem.findMany({
    where: { plaidItemId: { startsWith: "demo-" }, investments: true, user: { deletedAt: null } },
    select: { id: true },
  });
  let refreshed = 0;
  let failed = 0;
  for (const { id } of items) {
    try {
      await syncDemoInvestments(id, { client, now });
      refreshed += 1;
    } catch (error) {
      failed += 1;
      console.error("Demo price refresh failed", { itemId: id, error: String(error) });
    }
  }
  return { refreshed, failed };
}
