import { FORECAST_DAYS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { nextPayday } from "@/detection/paydays";
import { recurringCharges, type RecurringCharge } from "@/detection/subscriptions";
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

// What charges the person on a schedule and when they're next paid (spec step 88), from the
// same loaders as the Subscriptions page and safe to spend, for the chat's rule answers and
// Claude's subscriptions tool. Each charge carries the open finding about it, if any.

export type Charge = RecurringCharge & { openFindingId: string | null };

export type Recurring = {
  charges: Charge[];
  // The next paycheck: when, from whom, about how much.
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
  // The same payday as safe to spend (src/planning/safe-to-spend.ts, spec step 182).
  const payday = nextPayday(input, FORECAST_DAYS);
  const nextIncome = payday
    ? { date: payday.date, from: payday.employer, amountCents: payday.amountCents }
    : null;
  return {
    charges: recurringCharges(input).map((r) => ({
      ...r,
      openFindingId: findingFor.get(r.key) ?? null,
    })),
    nextIncome,
  };
}

// A year of the person's subscriptions as the chat counts them (the same charges as
// loadRecurring), for the brief's suggestion to share.
export async function subscriptionYear(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<{ yearlyCents: number; count: number }> {
  const { charges } = await loadRecurring(userId, { client, now });
  const subs = charges.filter((c) => c.subscription);
  return { yearlyCents: subs.reduce((a, c) => a + c.annualCostCents, 0), count: subs.length };
}
