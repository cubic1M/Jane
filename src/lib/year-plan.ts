import {
  INVESTING_PAYDAYS_PER_MONTH,
  TAX_TITLE,
  YEAR_PLAN_MONTHS,
  type FixedSector,
} from "@/config/year-plan";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff } from "@/lib/debt-plan";
import { listDeadlines } from "@/lib/deadlines";
import { listGoals } from "@/lib/goals";
import { healthInput } from "@/lib/health-score";
import {
  addMonths,
  yearPlan,
  yearTotals,
  type Sectors,
  type YearInput,
  type YearMonth,
} from "@/planning/year-plan";

// The year's money plan (spec step 205): twelve months of targets from every sector that
// fit the forecast's margin, kept so a month that has passed never changes, and re-planned
// every month from what really happened. Shown on /plan and in the monthly report.

type Options = { client?: PrismaClient; now?: Date; input?: DetectionInput };

export type YearPlanView = {
  startMonth: string;
  currentMonth: string;
  months: YearMonth[];
  totals: Sectors;
};

const monthOf = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 7);

function sectorOf(d: { source: string; kind: string; title: string }): FixedSector | null {
  if (TAX_TITLE.test(d.title)) return "taxes";
  if (d.source === "insurance" || d.kind === "renewal") return "insurance";
  // Loan payments and subscriptions are in the monthly margin already.
  if (d.source === "loans" || d.source === "transactions") return null;
  return "deadlines";
}

export async function loadYearPlan(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input: given,
    keep = false,
  }: Options & { keep?: boolean } = {},
): Promise<YearPlanView | null> {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  if (input.accounts.length === 0) return null;
  const db = scopedFor(userId, client);
  const currentMonth = monthOf(now);

  // The twelve months in force: the stored plan whose window holds this month, or a new one.
  const stored = await db.yearPlans.findMany({ orderBy: { startMonth: "desc" }, take: 1 });
  const inForce = stored.find(
    (p) =>
      p.startMonth <= currentMonth && currentMonth <= addMonths(p.startMonth, YEAR_PLAN_MONTHS - 1),
  );
  const startMonth = inForce?.startMonth ?? currentMonth;
  const lastMonth = addMonths(startMonth, YEAR_PLAN_MONTHS - 1);

  const [health, goals, payoff, auto, deadlines, transfers, runs] = await Promise.all([
    healthInput(userId, input, { client, now }),
    listGoals(userId, { client, now }),
    loadPayoff(userId, { client, now }),
    db.autoInvestPlans.findFirst({ where: { status: "active" }, select: { amountCents: true } }),
    listDeadlines(userId, { client, now }),
    db.moneyTransfers.findMany({
      where: {
        status: "completed",
        runOn: {
          gte: new Date(`${startMonth}-01T00:00:00Z`),
          lt: new Date(`${currentMonth}-01T00:00:00Z`),
        },
      },
      select: { runOn: true, amountCents: true, purpose: true },
    }),
    db.autoInvestRuns.findMany({
      where: {
        status: "invested",
        paydayOn: {
          gte: new Date(`${startMonth}-01T00:00:00Z`),
          lt: new Date(`${currentMonth}-01T00:00:00Z`),
        },
      },
      select: { paydayOn: true, amountCents: true },
    }),
  ]);

  const actuals: YearInput["actuals"] = {};
  const bump = (month: string, key: "saving" | "debt" | "investing", cents: number) => {
    actuals[month] ??= { saving: 0, debt: 0, investing: 0 };
    actuals[month][key] += cents;
  };
  for (const t of transfers) {
    if (t.purpose === "goal") bump(monthOf(t.runOn), "saving", t.amountCents);
    if (t.purpose === "debt") bump(monthOf(t.runOn), "debt", t.amountCents);
  }
  for (const r of runs) bump(monthOf(r.paydayOn), "investing", r.amountCents);

  const past = Array.isArray(inForce?.months) ? (inForce!.months as unknown as YearMonth[]) : [];
  const planInput: YearInput = {
    startMonth,
    currentMonth,
    marginCents: Math.max(0, (health.monthlyIncomeCents ?? 0) - (health.monthlySpendingCents ?? 0)),
    wants: {
      saving: goals.reduce(
        (s, g) => s + (g.progress.status === "on_the_way" ? g.progress.monthlyCents : 0),
        0,
      ),
      debt: payoff.stored?.extraCents ?? 0,
      investing: (auto?.amountCents ?? 0) * INVESTING_PAYDAYS_PER_MONTH,
    },
    fixed: deadlines.flatMap((d) => {
      const sector = sectorOf(d);
      const month = monthOf(d.date);
      return sector &&
        d.amountCents &&
        d.amountCents > 0 &&
        month >= currentMonth &&
        month <= lastMonth
        ? [{ month, sector, cents: d.amountCents }]
        : [];
    }),
    past,
    actuals,
  };
  const months = yearPlan(planInput);

  if (keep) {
    const data = { months: months as unknown as Prisma.InputJsonArray };
    const { count } = await db.yearPlans.updateMany({ where: { startMonth }, data });
    if (count === 0) {
      await db.yearPlans
        .create({ data: { userId, startMonth, ...data } })
        .catch(() => db.yearPlans.updateMany({ where: { startMonth }, data }));
    }
  }
  return { startMonth, currentMonth, months, totals: yearTotals(months) };
}
