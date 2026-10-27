import { HUB_DEADLINE_DAYS } from "@/config/hubs";
import { LIFE_EVENTS } from "@/config/life-events";
import { PLANNER_LEFT_OUT_SUBTYPES } from "@/config/planning";
import type { PrismaClient } from "@/generated/prisma/client";
import { previousMonth } from "@/insights/check-in";
import { dueIn, type Deadline } from "@/insights/deadlines";
import { irregularCosts } from "@/insights/irregular";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadComingUp } from "@/lib/coming-up";
import { listLifeEvents } from "@/lib/life-events";
import { formatCents } from "@/lib/money";
import { taxYearFrom } from "@/planning/tax-pack";
import { type HubGroup, type HubTileData } from "./tile";
import { DAY_MS } from "@/lib/dates";
import { monthLabel } from "@/lib/day-label";
import { plural } from "@/lib/plural";

// The Ahead hub (spec step 80): the planning pages, each tile with a live line where
// there's data.

type Options = { client?: PrismaClient; now?: Date };

export type AheadData = {
  // YYYY-MM-DD, today.
  asOf: string;
  yearly: { monthlyCents: number; bills: number };
  deadlines: { next: Pick<Deadline, "title" | "date"> | null; soon: number };
  debt: { accounts: number; owedCents: number };
  // The newest open checklist, and how many are open.
  lifeEvents: { open: number; newest: { title: string; done: number; total: number } | null };
  // Every date in the next HUB_DEADLINE_DAYS, soonest first, for the Plans & goals tree.
  dates?: Pick<Deadline, "key" | "title" | "date" | "amountCents" | "href" | "detail">[];
};

const until = (asOf: string) =>
  new Date(Date.parse(`${asOf}T00:00:00Z`) + HUB_DEADLINE_DAYS * DAY_MS).toISOString().slice(0, 10);

// Pure: the next deadline from today, and how many fall in the next HUB_DEADLINE_DAYS.
export function deadlineSummary(
  deadlines: Pick<Deadline, "title" | "date">[],
  asOf: string,
): AheadData["deadlines"] {
  const ahead = deadlines
    .filter((d) => d.date >= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return {
    next: ahead[0] ? { title: ahead[0].title, date: ahead[0].date } : null,
    soon: ahead.filter((d) => d.date <= until(asOf)).length,
  };
}

// Pure: the tiles, grouped, from the numbers.
export function aheadTiles(d: AheadData): HubGroup[] {
  const year = Number(d.asOf.slice(0, 4));
  const { newest } = d.lifeEvents;
  const [
    afford,
    yearly,
    deadlines,
    debt,
    lifeEvents,
    taxPack,
    checkIn,
    review,
    taxes,
  ]: HubTileData[] = [
    {
      label: "Can I afford this?",
      href: "/afford",
      value: null,
      status: "Check a purchase against your own numbers",
    },
    d.yearly.bills > 0
      ? {
          label: "Yearly bills",
          href: "/budgets#yearly",
          value: `${formatCents(d.yearly.monthlyCents)} a month`,
          status: "Set aside each month for yearly and irregular bills",
        }
      : {
          label: "Yearly bills",
          href: "/budgets",
          value: null,
          status: "No yearly bills found yet",
        },
    {
      label: "Deadlines",
      href: "/deadlines",
      value: d.deadlines.next ? `${d.deadlines.soon} in ${HUB_DEADLINE_DAYS} days` : null,
      status: d.deadlines.next
        ? `Next: ${d.deadlines.next.title}, ${dueIn(d.deadlines.next.date, d.asOf)}`
        : "Nothing coming up",
    },
    {
      label: "Paying off debt",
      href: "/debt",
      value: d.debt.accounts > 0 ? formatCents(d.debt.owedCents) : null,
      status:
        d.debt.accounts > 0
          ? `On ${plural(d.debt.accounts, "card or loan", "cards and loans")}`
          : "No cards or loans to pay off",
    },
    newest
      ? {
          label: "Life events",
          href: "/life-events",
          value: `${newest.done} of ${newest.total} done`,
          status:
            d.lifeEvents.open > 1
              ? `${newest.title}, and ${plural(d.lifeEvents.open - 1, "more checklist")}`
              : `${newest.title} checklist`,
        }
      : {
          label: "Life events",
          href: "/life-events",
          value: null,
          status: "Checklists for a move, a new job or a baby",
        },
    {
      label: "Tax-time pack",
      href: "/tax-pack",
      value: String(taxYearFrom(undefined, d.asOf)),
      status: "The year's records, gathered in one place",
    },
    {
      label: "Monthly report",
      href: "/monthly",
      value: null,
      status: `How ${monthLabel(previousMonth(d.asOf), { long: true })} went`,
    },
    {
      label: "Year in review",
      href: "/year",
      value: String(year),
      status: "Your year so far",
    },
    // Taxes (spec steps 118–127).
    {
      label: "Taxes",
      href: "/taxes",
      value: null,
      status: "What Jane needs to know, kept up to date from your accounts",
    },
  ];
  return [
    { title: "Coming up", tiles: [deadlines, yearly, debt] },
    { title: "Get ready", tiles: [afford, lifeEvents, taxes, taxPack] },
    { title: "Look back", tiles: [checkIn, review] },
  ];
}

export async function loadAheadHub(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AheadData> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const [{ input, deadlines }, debts, events] = await Promise.all([
    // Bills and deadlines from the one coming-up source (src/lib/coming-up.ts).
    loadComingUp(userId, { client, now, days: HUB_DEADLINE_DAYS }),
    // The same cards and loans as the debt planner.
    db.accounts.findMany({
      where: {
        OR: [
          { type: "credit" },
          { type: "loan", NOT: { subtype: { in: [...PLANNER_LEFT_OUT_SUBTYPES] } } },
        ],
      },
      select: { currentBalanceCents: true },
    }),
    listLifeEvents(userId, { client }),
  ]);
  const yearly = irregularCosts(input);
  const open = events.filter((e) => e.completedAt === null);
  const newest = open[0];
  const items = newest ? LIFE_EVENTS[newest.kind].items : [];

  return {
    asOf,
    yearly: { monthlyCents: yearly.monthlyCents, bills: yearly.items.length },
    deadlines: deadlineSummary(deadlines, asOf),
    dates: deadlines
      .filter((d) => d.date >= asOf && d.date <= until(asOf))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
      .map(({ key, title, date, amountCents, href, detail }) => ({
        key,
        title,
        date,
        amountCents,
        href,
        detail,
      })),
    debt: {
      accounts: debts.length,
      owedCents: debts.reduce((sum, a) => sum + Math.max(0, a.currentBalanceCents ?? 0), 0),
    },
    lifeEvents: {
      open: open.length,
      newest: newest
        ? {
            title: LIFE_EVENTS[newest.kind].title,
            done: items.filter((i) => newest.checkedItems.includes(i.key)).length,
            total: items.length,
          }
        : null,
    },
  };
}
