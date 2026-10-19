import { FORECAST_DAYS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { expectedDates, incomeStreams } from "@/detection/forecast";
import { recurringCharges, type RecurringCharge } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { addDays } from "@/detection/units";
import { scopedFor } from "@/lib/db-scoped";

// What charges the person on a schedule and when they're next paid (spec step 88), from the
// same loaders as the Subscriptions page and safe to spend, for the chat's rule answers and
// Claude's subscriptions tool. Each charge carries the open finding about it, if any.

export type Charge = RecurringCharge & { openFindingId: string | null };

export type Recurring = {
  charges: Charge[];
  // The next paycheck (or other regular money in): when, from whom, about how much.
  nextIncome: { date: string; from: string; amountCents: number } | null;
};

export async function loadRecurring(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Recurring> {
  const db = scopedFor(userId, client);
  const [input, confirmed, findings] = await Promise.all([
    loadDetectionInput(userId, { client, now }),
    db.subscriptionChecks.findMany({
      where: { isSubscription: true },
      select: { merchantKey: true },
    }),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { id: true, key: true },
    }),
  ]);
  input.subscriptionMerchantKeys = confirmed.map((c) => c.merchantKey);
  const findingFor = new Map(findings.map((f) => [f.key, f.id]));
  const until = addDays(input.asOf, FORECAST_DAYS);
  // The same payday as safe to spend (src/planning/safe-to-spend.ts).
  const nextIncome =
    incomeStreams(input)
      .filter((s) => s.active)
      .flatMap((s) =>
        expectedDates(s, input.asOf, until).map((date) => ({
          date,
          from: s.merchant,
          amountCents: s.lastAmountCents,
        })),
      )
      .filter((i) => i.date > input.asOf)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return {
    charges: recurringCharges(input).map((r) => ({
      ...r,
      openFindingId: findingFor.get(r.key) ?? null,
    })),
    nextIncome,
  };
}
