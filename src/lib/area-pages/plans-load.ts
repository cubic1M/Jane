import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { previousMonth } from "@/insights/check-in";
import { plansTree } from "@/lib/area-pages/plans";
import { loadTradeoffs } from "@/lib/goal-tradeoffs";
import { listGoals } from "@/lib/goals";
import { loadAheadHub } from "@/lib/hubs/ahead";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { scopedFor } from "@/lib/db-scoped";

// Everything the Plans & goals tree is built from (docs/design/area-pages.md), loaded once for
// the page and for the home tree, so both show the same statuses.
export async function loadPlansArea(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
) {
  const db = scopedFor(userId, client);
  const [data, accounts, goals, worth] = await Promise.all([
    loadAheadHub(userId, { client, now }),
    db.accounts.count(),
    listGoals(userId, { client, now }),
    loadNetWorthHistory(userId, { client, now }),
  ]);
  // Spec step 241: only worth the year plan's work with two goals or more.
  const tradeoffs = goals.length >= 2 ? await loadTradeoffs(userId, { client, now }) : null;
  const late = new Map(
    tradeoffs?.competing ? (tradeoffs.current?.dates ?? []).map((d) => [d.id, d.lateMonths]) : [],
  );
  const dates = data.dates ?? [];

  const area = plansTree({
    asOf: data.asOf,
    deadlines: dates,
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      status: g.progress.status,
      savedCents: g.progress.savedCents,
      monthlyCents: g.progress.status === "on_the_way" ? g.progress.monthlyCents : null,
      lateMonths: late.get(g.id) ?? null,
    })),
    competing: !!tradeoffs?.competing,
    netWorth: worth
      ? {
          todayCents: worth.todayCents,
          lastMonthCents: worth.months.at(-2)?.netCents ?? null,
          known: worth.known,
          unbalanced: worth.unbalanced,
        }
      : null,
    lifeEvents: data.lifeEvents,
    lastMonth: {
      label: new Date(`${previousMonth(data.asOf)}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        timeZone: "UTC",
      }),
    },
    year: Number(data.asOf.slice(0, 4)),
    yearly: data.yearly,
    debt: data.debt,
  });
  return { data, accounts, goals, worth, tradeoffs, dates, area };
}
