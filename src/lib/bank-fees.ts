import { PROFILE_MONTHS } from "@/config/profile";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { bankFeesYear, type BankFees } from "@/planning/bank-fees";
import { monthsOfData } from "@/profile/build";

// The person's bank fees for a year (src/planning/bank-fees.ts), for Jane's answer in the chat:
// the same transactions window and the same function as the brief's suggestion.
export async function loadBankFees(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<BankFees | null> {
  const since = new Date(now.getTime() - (PROFILE_MONTHS * 31 + 2) * 86_400_000);
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: { date: { gte: since, lte: now } },
    select: {
      date: true,
      amountCents: true,
      description: true,
      pfcDetailed: true,
      accountId: true,
    },
  });
  const txs = rows.map((t) => ({
    date: t.date.toISOString().slice(0, 10),
    amountCents: t.amountCents,
    description: t.description,
    pfc: t.pfcDetailed,
    accountId: t.accountId,
  }));
  return bankFeesYear(txs, monthsOfData(txs, now.toISOString().slice(0, 10)));
}
