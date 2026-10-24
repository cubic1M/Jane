import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// What practice money went into the practice portfolio (Phase AW): the starting money and every
// monthly add that wasn't undone. Up or down is against this, not the starting money alone, or
// $10,250 after $11,000 in reads as a gain (visitor walk).
export async function practicePaidIn(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<number> {
  const { _sum } = await scopedFor(userId, client).practiceTrades.aggregate({
    where: { side: "deposit", undone: false },
    _sum: { amountCents: true },
  });
  return _sum.amountCents ?? 0;
}
