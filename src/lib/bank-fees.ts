import type { PrismaClient } from "@/generated/prisma/client";
import { inLookback } from "@/detection/helpers";
import { loadDetectionInput } from "@/detection/input";
import { feeMonthsOf } from "@/detection/rules/fee-totals";
import { db as defaultClient } from "@/lib/db";
import { bankFeesYear, type BankFees } from "@/planning/bank-fees";

// The person's bank fees for a year (src/planning/bank-fees.ts), for Jane's answer in the chat:
// what the report's findings add up to, from the same rows (each account once, the person's own
// day) and the same months (gate B: this read its own window in UTC, kept an account linked twice
// and counted calendar months, so it said a third more than the dock for a 3.6-month history).
export async function loadBankFees(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<BankFees | null> {
  const input = await loadDetectionInput(userId, { client, now });
  const cash = new Set(input.accounts.filter((a) => a.type === "depository").map((a) => a.id));
  return bankFeesYear(
    inLookback(input).map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
      onCash: cash.has(t.accountId),
    })),
    (accountId) => feeMonthsOf(input, [accountId]),
  );
}
