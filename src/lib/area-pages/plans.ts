import type { Route } from "next";
import { isHiddenPage } from "@/config/hidden-pages";
import { AHEAD_DATES_DAYS, AHEAD_URGENT_DAYS, HUB_DEADLINE_DAYS } from "@/config/hubs";
import type { TreeStatus } from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import { buildAreaTree, type AreaItem, type AreaTree } from "./tree";
import { dayLabel } from "@/lib/day-label";
import { plural } from "@/lib/plural";

// The Plans & goals page (/ahead) as a tree (docs/design/area-pages.md): Plans & goals → its
// branches (dates coming up, goals, net worth, big decisions, life events, looking back, bills
// and debt) → their items. Most of this area is tools and look-backs, so the tree is mostly
// reference with few chips. Pure: the page loads the same records the hub always did.

export const PLANS_BRANCHES = {
  coming: "Coming up",
  goals: "Your goals",
  worth: "Net worth",
  decide: "Big decisions",
  life: "Life events",
  back: "Look back",
  money: "Bills and debt",
} as const;
export type PlansBranch = keyof typeof PLANS_BRANCHES;

export const itemId = (branch: PlansBranch, key: string) => `${branch}:${key}`;

// The page an item that is only a way to a page opens.
export const ITEM_PAGE: Readonly<Record<string, string>> = {
  "life:open": "/life-events",
  "life:start": "/life-events",
  "back:monthly": "/monthly",
  "back:year": "/year",
};

// The planning tools, each opening its own page.
export const DECISIONS: readonly { key: string; label: string; what: string; href: Route }[] = [
  {
    key: "afford",
    label: "Can I afford this?",
    what: "Check a purchase against your own numbers: safe to spend, your goals and the next 12 months.",
    href: "/afford",
  },
  {
    key: "what-if",
    label: "What if…",
    what: "A job loss, a raise, a baby, a move, a car or a home: what each would do to your money.",
    href: "/what-if",
  },
  {
    key: "long-view",
    label: "The long view",
    what: "Where your money could be in 10, 20 and 30 years, as a range, and what moves it most.",
    href: "/long-view",
  },
];

const monthLabel = (day: string) =>
  new Date(`${day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const sixWords = (text: string) => text.split(/\s+/).slice(0, 6).join(" ");

export type PlansTreeInput = {
  asOf: string;
  // Dates in the next HUB_DEADLINE_DAYS, soonest first.
  deadlines: { key: string; title: string; date: string; amountCents: number | null }[];
  goals: {
    id: string;
    name: string;
    targetCents: number;
    targetDate: string;
    status: "reached" | "date_passed" | "on_the_way";
    savedCents: number;
    monthlyCents: number | null;
    // Months later than wanted when goals compete (spec step 241), or null.
    lateMonths: number | null;
  }[];
  competing: boolean;
  netWorth: { todayCents: number; lastMonthCents: number | null } | null;
  lifeEvents: { open: number; newest: { title: string; done: number; total: number } | null };
  lastMonth: { label: string };
  year: number;
  yearly: { monthlyCents: number; bills: number };
  debt: { accounts: number; owedCents: number };
};

export function plansTree(input: PlansTreeInput): AreaTree {
  const item = (branch: PlansBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
  });

  const near = input.deadlines.filter((d) => days(input.asOf, d.date) <= AHEAD_DATES_DAYS);
  const coming = near.map((d) => {
    const left = days(input.asOf, d.date);
    return item("coming", d.key, {
      label: sixWords(d.title),
      status: left <= AHEAD_URGENT_DAYS ? "act" : "look",
      figure:
        d.amountCents !== null
          ? `${shortMoney(d.amountCents)} · ${dayLabel(d.date)}`
          : dayLabel(d.date),
      cents: d.amountCents ?? 0,
      summary: left === 0 ? "Due today." : left === 1 ? "Due tomorrow." : `In ${left} days.`,
    });
  });
  coming.push(
    item("coming", "all", {
      label: "All your dates",
      status: "good",
      figure: `${input.deadlines.length} in ${HUB_DEADLINE_DAYS} days`,
      summary:
        input.deadlines.length === 0
          ? "Nothing dated in the next month."
          : "Payments, renewals and return windows, by date.",
    }),
  );

  const goals = input.goals.map((g) => {
    const behind = g.status === "date_passed" || (g.lateMonths ?? 0) > 0;
    const status: TreeStatus = g.status === "date_passed" ? "act" : behind ? "look" : "good";
    return item("goals", g.id, {
      label: sixWords(g.name),
      status,
      figure: `${shortMoney(g.savedCents)} of ${shortMoney(g.targetCents)}`,
      summary:
        g.status === "reached"
          ? "Reached."
          : g.status === "date_passed"
            ? `Its date, ${monthLabel(g.targetDate)}, has passed.`
            : (g.lateMonths ?? 0) > 0
              ? `${shortMoney(g.monthlyCents ?? 0)} a month would get there by ${monthLabel(g.targetDate)}; with your other goals it's ${plural(g.lateMonths!, "month")} late.`
              : `${shortMoney(g.monthlyCents ?? 0)} a month gets you there by ${monthLabel(g.targetDate)}.`,
    });
  });
  if (input.competing)
    goals.push(
      item("goals", "tradeoffs", {
        label: "Goals that compete",
        status: "look",
        summary: "Together they need more each month than your plan has room for. Pick an order.",
      }),
    );
  goals.push(
    item("goals", "add", {
      label: input.goals.length === 0 ? "Set a goal" : "Add a goal",
      summary: "Name it, the amount and the date; Jane works out the month by month.",
    }),
  );

  const worth = input.netWorth
    ? [
        item("worth", "today", {
          label: "Net worth",
          status: "good",
          figure: shortMoney(input.netWorth.todayCents),
          summary:
            input.netWorth.lastMonthCents === null
              ? "What you have, less what you owe."
              : (() => {
                  const change = input.netWorth.todayCents - input.netWorth.lastMonthCents;
                  return change === 0
                    ? "The same as at the end of last month."
                    : `${change > 0 ? "Up" : "Down"} ${shortMoney(Math.abs(change))} since the end of last month.`;
                })(),
        }),
      ]
    : [];

  // A page the read-only beta hides (src/config/hidden-pages.ts) isn't in the tree.
  const decide = DECISIONS.filter((d) => !isHiddenPage(d.href)).map((d) =>
    item("decide", d.key, { label: d.label, summary: d.what }),
  );

  const { newest } = input.lifeEvents;
  const life = [
    newest
      ? item("life", "open", {
          label: sixWords(newest.title),
          status: newest.done < newest.total ? "look" : "good",
          figure: `${newest.done} of ${newest.total} done`,
          summary:
            input.lifeEvents.open > 1
              ? `And ${plural(input.lifeEvents.open - 1, "more checklist")}.`
              : "Your checklist, step by step.",
        })
      : item("life", "start", {
          label: "Start a checklist",
          summary: "For a move, a new job or a baby: what to change, in order.",
        }),
  ];

  const back = [
    item("back", "monthly", {
      label: `${input.lastMonth.label} report`,
      summary: "How last month went: spending, income, net worth and what changed.",
    }),
    item("back", "year", {
      label: `${input.year} so far`,
      summary: "Spent, came in, found and saved this year, month by month.",
    }),
  ];

  const money = [
    item("money", "yearly", {
      label: "Yearly bills",
      figure: input.yearly.bills > 0 ? `${shortMoney(input.yearly.monthlyCents)}/mo` : undefined,
      summary:
        input.yearly.bills > 0
          ? "Set aside each month for yearly and irregular bills."
          : "No yearly bills found yet.",
    }),
    item("money", "debt", {
      label: "Paying off cards and loans",
      figure: input.debt.accounts > 0 ? shortMoney(input.debt.owedCents) : undefined,
      summary:
        input.debt.accounts > 0
          ? `On ${plural(input.debt.accounts, "card or loan", "cards and loans")}, not the mortgage.`
          : "No cards or loans to pay off.",
    }),
  ];

  const all: { id: PlansBranch; items: AreaItem[] }[] = [
    { id: "coming", items: coming },
    { id: "goals", items: goals },
    { id: "worth", items: worth },
    { id: "decide", items: decide },
    { id: "life", items: life },
    { id: "back", items: back },
    { id: "money", items: money },
  ];
  // An item that only opens a page the read-only beta hides isn't in the tree.
  const branches = all.map((b) => ({
    ...b,
    items: b.items.filter((i) => !isHiddenPage(ITEM_PAGE[i.id] ?? "")),
  }));
  const real = input.goals.filter((g) => g.status !== "reached");
  return buildAreaTree({
    key: "ahead",
    label: "Plans & goals",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : real.length > 0
          ? `${real.filter((g) => g.status === "on_the_way" && !(g.lateMonths ?? 0)).length} of ${plural(real.length, "goal")} on track`
          : look > 0
            ? `${look} to look at`
            : "All good",
    branches: branches.map((b) => ({ id: b.id, label: PLANS_BRANCHES[b.id], items: b.items })),
  });
}
