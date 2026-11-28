import { goalsOnTrack } from "@/planning/goals";
import type { Route } from "next";
import { isHiddenPage } from "@/config/hidden-pages";
import { AHEAD_DATES_DAYS, AHEAD_URGENT_DAYS, HUB_DEADLINE_DAYS } from "@/config/hubs";
import type { TreeStatus } from "@/components/tree/interactive-tree";
import type { DeadlineKind } from "@/insights/deadlines";
import { loansNotCounted, notCounting, type Unbalanced } from "@/insights/net-worth";
import { shortMoney } from "@/lib/hub/view";
import { type AreaItem, type AreaTree, buildAreaTree, shortLabel, urgentLine } from "./tree";
import { daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { plural } from "@/lib/plural";
import { formatCents } from "@/lib/money";

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
const ITEM_PAGE: Readonly<Record<string, string>> = {
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
    what: "Check a purchase against your own numbers: your checking balance, your goals and the next 12 months.",
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

export type PlansTreeInput = {
  asOf: string;
  // Dates in the next HUB_DEADLINE_DAYS, soonest first.
  deadlines: {
    key: string;
    title: string;
    date: string;
    kind?: DeadlineKind;
    amountCents: number | null;
  }[];
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
  // known: false when no balance is known yet.
  // unbalanced: accounts it can't count yet (card statements carry no balance).
  // loansSeen: loans only their payments show, so what's owed on them isn't counted.
  netWorth: {
    todayCents: number;
    lastMonthCents: number | null;
    known?: boolean;
    unbalanced?: Unbalanced[];
    loansSeen?: string[];
  } | null;
  lifeEvents: { open: number; newest: { title: string; done: number; total: number } | null };
  lastMonth: { label: string };
  year: number;
  yearly: { monthlyCents: number; bills: number };
  // known: how many have a balance (uploaded card statements carry none).
  debt: { accounts: number; owedCents: number; known?: number; cards?: number; mortgage?: boolean };
};

// "On 2 loans.", "On 1 card.", "On 3 cards and loans, not the mortgage.": what the payoff plan
// covers, saying the mortgage is left out only when there is one (debug 2, 11-16: "On 2 cards and
// loans, not the mortgage." for a student with a car loan and a student loan).
function debtLine(debt: PlansTreeInput["debt"]): string {
  const { accounts, cards } = debt;
  const what =
    cards === undefined
      ? plural(accounts, "card or loan", "cards and loans")
      : cards === accounts
        ? plural(accounts, "card")
        : cards === 0
          ? plural(accounts, "loan")
          : `${accounts} cards and loans`;
  return `On ${what}${debt.mortgage === false ? "" : ", not the mortgage"}.`;
}

// When a date comes, in the words for what it is: a bill is due, a return window or a trial
// ends, a renewal is just a day (debugger 11-15: "Return window for West Marine: Due today.",
// with nothing to pay).
function whenLine(kind: DeadlineKind | undefined, left: number): string {
  if (kind === "return")
    return left === 0
      ? "Last day to return it."
      : left === 1
        ? "Last day to return it is tomorrow."
        : `${left} days left to return it.`;
  if (kind === "payment" || kind === "bill" || kind === undefined)
    return left === 0 ? "Due today." : left === 1 ? "Due tomorrow." : `Due in ${left} days.`;
  return left === 0 ? "Today." : left === 1 ? "Tomorrow." : `In ${left} days.`;
}

export function plansTree(input: PlansTreeInput): AreaTree {
  const item = (branch: PlansBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
  });

  const near = input.deadlines.filter((d) => daysBetween(input.asOf, d.date) <= AHEAD_DATES_DAYS);
  const coming = near.map((d) => {
    const left = daysBetween(input.asOf, d.date);
    return item("coming", d.key, {
      label: shortLabel(d.title),
      status: left <= AHEAD_URGENT_DAYS ? "act" : "look",
      figure:
        d.amountCents !== null
          ? `${shortMoney(d.amountCents)} · ${dayLabel(d.date)}`
          : dayLabel(d.date),
      cents: d.amountCents ?? 0,
      summary: whenLine(d.kind, left),
    });
  });
  // A list with nothing in it isn't a node: a student with one checking account read "0 in 30
  // days", "No yearly bills found yet" and "No cards or loans to pay off" (debugger 11-15).
  if (input.deadlines.length > 0)
    coming.push(
      item("coming", "all", {
        label: "All your dates",
        status: "good",
        figure: `${input.deadlines.length} in ${HUB_DEADLINE_DAYS} days`,
        summary: "Payments, renewals and return windows, by date.",
      }),
    );

  const goals = input.goals.map((g) => {
    const behind = g.status === "date_passed" || (g.lateMonths ?? 0) > 0;
    const status: TreeStatus = g.status === "date_passed" ? "act" : behind ? "look" : "good";
    return item("goals", g.id, {
      label: shortLabel(g.name),
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

  // Never a figure that silently leaves a debt out, as on /money: "Not known" with no balance at
  // all, else it says what it isn't counting (QA: /ahead showed checking alone, the card left out).
  const nw = input.netWorth;
  const left = nw && nw.known !== false ? notCounting(nw.unbalanced ?? []) : null;
  // A loan seen only in its payments is left out too (debugger 11-17: "Good: Net worth $3.4k" for a
  // student paying Nelnet $210.40 a month, where Home said it wasn't counting the loan).
  const loans = nw && nw.known !== false ? (nw.loansSeen ?? []) : [];
  const loansLeft = loansNotCounted(loans);
  const worth = nw
    ? [
        item("worth", "today", {
          label: left
            ? `Net worth, ${left.short}`
            : loansLeft
              ? `Net worth, not counting ${loans.length === 1 ? "a loan" : `${loans.length} loans`}`
              : "Net worth",
          status: left || loansLeft ? "look" : "good",
          figure: nw.known === false ? "Not known" : shortMoney(nw.todayCents),
          summary:
            nw.known === false
              ? "Your files don't include a balance yet. Add one on the import page."
              : left
                ? // Both are said when both apply (a card with no balance, and a loan seen only in payments).
                  `${left.sentence}${loansLeft ? ` ${loansLeft}` : ""}`
                : loansLeft
                  ? loansLeft
                  : nw.lastMonthCents === null
                    ? "What you have, less what you owe."
                    : (() => {
                        const change = nw.todayCents - nw.lastMonthCents;
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
          label: shortLabel(newest.title),
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

  const partialDebt =
    input.debt.known !== undefined &&
    input.debt.known > 0 &&
    input.debt.known < input.debt.accounts;
  const money = [
    ...(input.yearly.bills > 0
      ? [
          item("money", "yearly", {
            label: "Yearly bills",
            figure: `${shortMoney(input.yearly.monthlyCents)}/mo`,
            summary: "Set aside each month for yearly and irregular bills.",
          }),
        ]
      : []),
    ...(input.debt.accounts > 0
      ? [
          item("money", "debt", {
            label: "Paying off cards and loans",
            // Some balances known, some not: the figure is what's known, not the total.
            figure:
              input.debt.known === 0
                ? "Not known"
                : partialDebt
                  ? `${shortMoney(input.debt.owedCents)}+`
                  : shortMoney(input.debt.owedCents),
            line: partialDebt ? "known balances only" : undefined,
            summary: partialDebt
              ? `${debtLine(input.debt)} ${formatCents(input.debt.owedCents)} is what's known: ${plural(input.debt.accounts - (input.debt.known ?? 0), "balance")} missing.`
              : debtLine(input.debt),
          }),
        ]
      : []),
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
  const counted = goalsOnTrack(input.goals);
  return buildAreaTree({
    key: "ahead",
    label: "Plans & goals",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? urgentLine(urgent, look)
        : counted.total > 0
          ? `${counted.onTrack} of ${plural(counted.total, "goal")} on track`
          : look > 0
            ? `${look} to look at`
            : "All good",
    branches: branches.map((b) => ({ id: b.id, label: PLANS_BRANCHES[b.id], items: b.items })),
  });
}
