import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoItemId } from "@/lib/plaid/demo";

// Demo advice mode (spec step 98): whether Jane may give this person recommendations on
// investments, taxes, insurance and loans. Only when every account they have comes from the
// demo bank, so a real account never gets advice: a real bank or a CSV import next to the
// demo bank turns it off. Outside production it's on for demo-bank people; in production
// only with DEMO_ADVICE=1. Everything shown in this mode carries DEMO_ADVICE_LABEL.

export function demoAdviceAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_ADVICE === "1";
}

export async function adviceMode(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [items, csvAccounts] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: "csv" } }),
  ]);
  const demoOnly =
    items.length > 0 && csvAccounts === 0 && items.every((i) => isDemoItemId(i.plaidItemId));
  // Real data: off until REAL_ACCOUNT_ADVICE says otherwise (it doesn't).
  if (!demoOnly) return REAL_ACCOUNT_ADVICE;
  return demoAdviceAllowed();
}
