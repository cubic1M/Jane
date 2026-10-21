import { DEBT_FIRST_APR_BPS, DEBT_FIRST_MIN_CENTS } from "@/config/tax-decisions";
import type { PrismaClient } from "@/generated/prisma/client";

// Whether paying debt down comes before a new tax-favoured contribution: the person is
// overdrawn or carries a card or loan at or above DEBT_FIRST_APR_BPS. Returns the reason in a
// sentence, or null.
export async function debtFirst(userId: string, client: PrismaClient): Promise<string | null> {
  const [cash, costly] = await Promise.all([
    client.account.findMany({
      where: { userId, type: "depository" },
      select: { currentBalanceCents: true },
    }),
    client.liability.findMany({
      where: { userId, kind: { in: ["credit", "loan"] }, aprBps: { gte: DEBT_FIRST_APR_BPS } },
      select: { aprBps: true, account: { select: { currentBalanceCents: true } } },
    }),
  ]);
  const carried = costly.filter(
    (l) => Math.abs(l.account.currentBalanceCents ?? 0) >= DEBT_FIRST_MIN_CENTS,
  );
  const overdrawn = cash.some((a) => (a.currentBalanceCents ?? 0) < 0);
  const cashCents = cash.reduce((n, a) => n + Math.max(0, a.currentBalanceCents ?? 0), 0);
  const owedCents = carried.reduce((n, l) => n + Math.abs(l.account.currentBalanceCents ?? 0), 0);
  if (overdrawn)
    return "You're overdrawn" + (carried.length ? " and carrying debt at a high rate." : ".");
  // Cash that covers the costly debt means paying it off is a choice, not a pressing need.
  if (carried.length && owedCents > cashCents) {
    const top = Math.max(...carried.map((l) => l.aprBps ?? 0));
    return `You're carrying debt at up to ${(top / 100).toFixed(0)}% a year.`;
  }
  return null;
}
