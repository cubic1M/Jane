import { loadDetectionInput } from "@/detection/input";
import { forecastAccounts } from "@/detection/forecast";
import { daysBetween } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { listGoals } from "@/lib/goals";
import { healthInput } from "@/lib/health-score";
import { homeSummary } from "@/lib/home";
import { affordWindow, type AffordNumbers } from "@/planning/afford";
import { parseAffordQuery } from "@/planning/afford-query";
import { todayOf } from "@/lib/today";

// The person's numbers for "Can I afford this?" (spec step 69). Safe to spend comes from
// the Home summary itself, so the two pages always show the same number; deposits and
// bills come from the same checking forecast as /bills, through the last month shown; and
// everyday spending is What if's usual monthly spending (docs/feature-audit.md, cluster 11),
// less those bills, so a monthly cost runs short in the same month on both pages.

export async function loadAffordNumbers(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<AffordNumbers> {
  const asOf = await todayOf(userId, { client, now });
  const input = await loadDetectionInput(userId, { client, now });
  const [home, goals, health] = await Promise.all([
    homeSummary(userId, { client, now }),
    listGoals(userId, { client, now }),
    healthInput(userId, input, { client, now }),
  ]);
  const safe = home?.safeToSpend ?? null;
  const flows = safe
    ? forecastAccounts(input, daysBetween(asOf, affordWindow(asOf).until)).flatMap((a) => [
        ...a.income.map((r) => ({ date: r.date, amountCents: r.amountCents })),
        ...a.bills.map((r) => ({ date: r.date, amountCents: -r.amountCents })),
      ])
    : [];
  // The regular bills a month, over the whole months shown after this one.
  const later = affordWindow(asOf).months.slice(1);
  const billsMonthly =
    -flows
      .filter((f) => f.amountCents < 0 && later.includes(f.date.slice(0, 7)))
      .reduce((sum, f) => sum + f.amountCents, 0) / Math.max(1, later.length);
  const everydayMonthlyCents = Math.max(
    0,
    Math.round((health.monthlySpendingCents ?? 0) - billsMonthly),
  );
  return {
    asOf,
    everydayMonthlyCents,
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

// What /afford's page needs about the day: the person's own "today" (their timezone, as the
// chat's check and loadAffordNumbers use), the months and last day it allows, and the address's
// form read against that day. UTC's day is already tomorrow after 4pm in Los Angeles, so a
// purchase "today" from the chat was refused as a date in the past.
export async function affordPage(
  userId: string,
  params: Parameters<typeof parseAffordQuery>[0],
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const asOf = await todayOf(userId, { client, now });
  return { asOf, ...affordWindow(asOf), query: parseAffordQuery(params, asOf) };
}
