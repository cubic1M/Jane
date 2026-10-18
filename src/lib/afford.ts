import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts } from "@/detection/forecast";
import { daysBetween, isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { affordWindow, type AffordNumbers } from "@/planning/afford";

// The person's numbers for "Can I afford this?" (spec step 69). Safe to spend comes from
// the Home summary itself, so the two pages always show the same number; deposits and
// bills come from the same checking forecast as /bills, through the last month shown.

export async function loadAffordNumbers(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<AffordNumbers> {
  const asOf = isoDate(now);
  const [home, input, goals] = await Promise.all([
    homeSummary(userId, { client, now }),
    loadDetectionInput(userId, { client, now }),
    listGoals(userId, { client, now }),
  ]);
  const safe = home?.safeToSpend ?? null;
  const flows = safe
    ? forecastAccounts(input, daysBetween(asOf, affordWindow(asOf).until)).flatMap((a) => [
        ...a.income.map((r) => ({ date: r.date, amountCents: r.amountCents })),
        ...a.bills.map((r) => ({ date: r.date, amountCents: -r.amountCents })),
      ])
    : [];
  return {
    asOf,
    safe: safe && {
      payday: safe.payday,
      balanceCents: safe.balanceCents,
      safeCents: safe.safeCents,
    },
    flows,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      savedCents: g.progress.savedCents,
    })),
  };
}
