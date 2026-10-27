import type { TreeStatus } from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import { notCounting } from "@/insights/net-worth";
import { formatCents } from "@/lib/money";
import { buildAreaTree, firstSentences, type AreaItem, type AreaTree } from "./tree";

// Spending & bills as a tree (docs/design/area-pages.md): Spending & bills → its branches
// (charges to look at, what's coming up, subscriptions, budgets, yearly bills, where it goes,
// figures Jane is checking, money Jane moved, what you have, transactions) → their items, each
// with a status, its key figure and a few words. Pure: ./money-load.ts gathers the same records
// the Spending & bills pages show, and the page renders each item's links and lists.

export const MONEY_BRANCHES = {
  charges: "Charges to look at",
  coming: "Coming up",
  subscriptions: "Subscriptions",
  budgets: "Budgets",
  yearly: "Yearly bills",
  spending: "Where it goes",
  books: "Figures I'm checking",
  transfers: "Money Jane moved",
  have: "What you have",
  transactions: "Transactions",
} as const;
export type MoneyBranch = keyof typeof MONEY_BRANCHES;

export const itemId = (branch: MoneyBranch, key: string) => `${branch}:${key}`;

// Each of the area's suggestions (src/detectors, capabilities in the "money" area), by topic:
// its branch and its label. The detector's own headline is the summary, not the label.
export const SUGGESTION_NODES: Readonly<Record<string, { branch: MoneyBranch; label: string }>> = {
  duplicate_charge: { branch: "charges", label: "Charged twice" },
  bank_fees: { branch: "charges", label: "Bank fees you can stop" },
  late_fees: { branch: "charges", label: "Late fees to stop" },
  bill_negotiation: { branch: "charges", label: "A bill you can lower" },
  duplicate_subscription: { branch: "charges", label: "Paying twice for one service" },
  price_increase: { branch: "charges", label: "A price went up" },
  trial_conversion: { branch: "charges", label: "A trial turning paid" },
  promo_ending: { branch: "charges", label: "A promo price ending" },
  bill_split: { branch: "charges", label: "Split bills with your partner" },
  low_balance: { branch: "coming", label: "Balance running low" },
  emergency_fund: { branch: "coming", label: "Build a cash cushion" },
  income_smoothing: { branch: "coming", label: "Smooth out uneven pay" },
  subscriptions: { branch: "subscriptions", label: "Subscriptions to review" },
  budget_overrun: { branch: "budgets", label: "Spending above your usual" },
  month_close: { branch: "spending", label: "Last month, closed" },
  figure_check: { branch: "books", label: "A figure to check" },
  data_problems: { branch: "books", label: "Data that doesn't add up" },
};

// A books problem's label, by kind (src/config/books.ts BOOKS_KIND_LABELS, in fewer words).
export const BOOKS_LABELS: Readonly<Record<string, string>> = {
  off: "A balance that doesn't add up",
  gap: "Transactions that stopped coming",
  stale: "A bank that stopped updating",
  import: "An import that ended",
  broken: "A bank that needs signing in",
  duplicate: "An account linked twice",
};

const TRANSFER_STATUS: Record<string, string> = {
  pending: "Pending",
  completed: "Went through",
  cancelled: "Undone",
  failed: "Didn't go through",
};

export type MoneyTreeInput = {
  hasAccounts: boolean;
  cushionCents: number;
  // Open suggestions in the area (waiting or selected).
  suggestions: {
    id: string;
    topic: string;
    summary: string;
    worthCents: number;
    urgency: string;
  }[];
  // Each checking or savings account's lowest point over the forecast.
  lows: { accountId: string; name: string; startCents: number; lowCents: number; date: string }[];
  // The forecast's bills, soonest first, and how many of its days are "this week".
  bills: { merchant: string; date: string; amountCents: number }[];
  weekEnds: string;
  recurring: {
    key: string;
    merchant: string;
    lastAmountCents: number;
    frequency: string;
    nextDate: string | null;
    annualCostCents: number;
    subscription: boolean;
    // The open "cancel or review" card, if there is one.
    findingId: string | null;
  }[];
  budgets: {
    daysLeft: number;
    progress: {
      category: string;
      budgetCents: number;
      spentCents: number;
      leftCents: number;
      over: boolean;
    }[];
  };
  yearly: {
    key: string;
    name: string;
    monthlyCents: number;
    nextDate: string;
    nextAmountCents: number;
    byNowCents: number;
  }[];
  spending: {
    month: string;
    spendingCents: number;
    incomeCents: number;
    categories: { category: string; cents: number }[];
    changes: { category: string; beforeCents: number; afterCents: number; changeCents: number }[];
  } | null;
  books: { id: string; kind: string; imported: boolean; words: string }[];
  transfers: { id: string; toName: string; amountCents: number; status: string; runOn: string }[];
  have: {
    netCents: number;
    assetsCents: number;
    debtsCents: number;
    investmentsCents: number;
    ownedCents: number;
    owned: number;
    // A home or car loan with nothing linked to it, if any.
    assetPrompt: "home" | "vehicle" | null;
    goals: { total: number; onTrack: number };
    debt: { accounts: number; owedCents: number };
    // Accounts net worth leaves out for having no balance (an uploaded card, say).
    missing?: string[];
  };
  rules: number;
};

export const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const perYear = (cents: number) => `${shortMoney(cents)}/yr`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// A name as a label: its first six words (a merchant's or a category's name is rarely more).
const asLabel = (name: string) => name.trim().split(/\s+/).slice(0, 6).join(" ");

export function moneyTree(input: MoneyTreeInput): AreaTree {
  const item = (branch: MoneyBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
    label: asLabel(rest.label),
    summary: firstSentences(rest.summary),
  });
  const items: Record<MoneyBranch, AreaItem[]> = {
    charges: [],
    coming: [],
    subscriptions: [],
    budgets: [],
    yearly: [],
    spending: [],
    books: [],
    transfers: [],
    have: [],
    transactions: [],
  };

  // Suggestions first in their branch: they're what Jane brings up.
  for (const s of input.suggestions) {
    const node = SUGGESTION_NODES[s.topic];
    if (!node) continue;
    // The books branch lists each problem itself.
    if (s.topic === "data_problems" && input.books.length > 0) continue;
    const status: TreeStatus =
      s.urgency === "now" || s.topic === "duplicate_charge" ? "act" : "look";
    items[node.branch].push(
      item(node.branch, s.topic, {
        label: node.label,
        status,
        figure: s.worthCents > 0 ? perYear(s.worthCents) : undefined,
        summary: s.summary,
        cents: s.worthCents,
      }),
    );
  }

  for (const l of input.lows) {
    const under = l.lowCents < input.cushionCents;
    items.coming.push(
      item("coming", `low-${l.accountId}`, {
        label: "Lowest balance ahead",
        line: `${l.name}, ${dayLabel(l.date)}`,
        status: under ? "act" : "good",
        figure: shortMoney(l.lowCents),
        summary: `${formatCents(l.startCents)} today. Lowest point about ${formatCents(l.lowCents)} on ${dayLabel(l.date)}.`,
        cents: under ? input.cushionCents - l.lowCents : undefined,
      }),
    );
  }
  const week = input.bills.filter((b) => b.date <= input.weekEnds);
  const sum = (rows: { amountCents: number }[]) => rows.reduce((t, b) => t + b.amountCents, 0);
  if (week.length > 0) {
    items.coming.push(
      item("coming", "week", {
        label: "Bills this week",
        line: plural(week.length, "bill"),
        status: "good",
        figure: shortMoney(sum(week)),
        summary: `${plural(week.length, "regular charge")} expected in the next 7 days, about ${formatCents(sum(week))} in all.`,
      }),
    );
  }
  if (input.bills.length > 0) {
    items.coming.push(
      item("coming", "month", {
        label: "The next month of bills",
        line: plural(input.bills.length, "bill"),
        status: "good",
        figure: shortMoney(sum(input.bills)),
        summary: `${plural(input.bills.length, "regular charge")} expected over the next month, about ${formatCents(sum(input.bills))} in all.`,
      }),
    );
  }

  for (const r of input.recurring.filter((r) => r.findingId)) {
    items.subscriptions.push(
      item("subscriptions", r.key, {
        label: r.merchant,
        status: "look",
        figure: perYear(r.annualCostCents),
        summary: `${formatCents(r.lastAmountCents)} ${r.frequency}${r.nextDate ? `, next about ${dayLabel(r.nextDate)}` : ""}.`,
      }),
    );
  }
  const subs = input.recurring.filter((r) => r.subscription);
  if (input.recurring.length > 0) {
    items.subscriptions.push(
      item("subscriptions", "all", {
        label: "All your regular charges",
        line: plural(subs.length, "subscription"),
        status: "good",
        figure: perYear(input.recurring.reduce((t, r) => t + r.annualCostCents, 0)),
        summary: `${plural(subs.length, "subscription")} and ${plural(input.recurring.length - subs.length, "other regular bill")}, from your transactions.`,
      }),
    );
  }

  for (const p of input.budgets.progress) {
    items.budgets.push(
      item("budgets", p.category, {
        label: p.category,
        status: p.over ? "act" : "good",
        figure: p.over ? `${shortMoney(-p.leftCents)} over` : `${shortMoney(p.leftCents)} left`,
        summary: `${formatCents(p.spentCents)} of ${formatCents(p.budgetCents)} this month, ${plural(input.budgets.daysLeft, "day")} left.`,
        cents: p.over ? -p.leftCents : undefined,
      }),
    );
  }
  if (input.budgets.progress.length === 0 && input.hasAccounts) {
    items.budgets.push(
      item("budgets", "set", {
        label: "Set a monthly budget",
        summary: "A monthly limit for any category you choose, starting from your own averages.",
      }),
    );
  }

  for (const y of input.yearly) {
    items.yearly.push(
      item("yearly", y.key, {
        label: y.name,
        status: "good",
        figure: `${shortMoney(y.monthlyCents)}/mo`,
        summary: `Next about ${dayLabel(y.nextDate)}, around ${formatCents(y.nextAmountCents)}. By now, ${formatCents(y.byNowCents)} of it set aside.`,
      }),
    );
  }

  const spend = input.spending;
  if (spend && (spend.spendingCents > 0 || spend.incomeCents > 0)) {
    items.spending.push(
      item("spending", "month", {
        label: "This month so far",
        status: "good",
        figure: shortMoney(spend.spendingCents),
        summary: `${formatCents(spend.spendingCents)} spent and ${formatCents(spend.incomeCents)} in so far this month.`,
      }),
    );
    const top = spend.categories[0];
    if (top) {
      items.spending.push(
        item("spending", "top", {
          label: "Your biggest categories",
          line: top.category,
          status: "good",
          figure: shortMoney(top.cents),
          summary: `${top.category} is your biggest this month, at ${formatCents(top.cents)}.`,
        }),
      );
    }
    for (const c of spend.changes.filter((c) => c.changeCents > 0).slice(0, 3)) {
      items.spending.push(
        item("spending", `up-${c.category}`, {
          label: `${c.category} is up`,
          status: "look",
          figure: `+${shortMoney(c.changeCents)}`,
          summary: `${formatCents(c.afterCents)} this month, up from ${formatCents(c.beforeCents)} last month.`,
        }),
      );
    }
  }

  for (const b of input.books) {
    items.books.push(
      item("books", b.id, {
        label: BOOKS_LABELS[b.imported ? "import" : b.kind] ?? "Data that doesn't add up",
        status: "look",
        summary: b.words,
      }),
    );
  }

  for (const t of input.transfers.slice(0, 5)) {
    items.transfers.push(
      item("transfers", t.id, {
        label: `To ${t.toName}`,
        line: `${TRANSFER_STATUS[t.status] ?? t.status}, ${dayLabel(t.runOn)}`,
        status: t.status === "pending" ? "look" : "good",
        figure: shortMoney(t.amountCents),
        summary:
          t.status === "pending"
            ? `${formatCents(t.amountCents)} to ${t.toName} on ${dayLabel(t.runOn)}. You can undo it until then.`
            : `${formatCents(t.amountCents)} to ${t.toName} on ${dayLabel(t.runOn)}.`,
      }),
    );
  }

  const h = input.have;
  const missing = h.missing ?? [];
  const left = notCounting(missing);
  if (input.hasAccounts) {
    items.have.push(
      item("have", "net-worth", {
        // Never a figure that silently leaves a debt out: it says what it isn't counting.
        // (The label's word budget fits a count; the summary names them.)
        label: left
          ? `Net worth, not counting ${missing.length === 1 ? "one account" : `${missing.length} accounts`}`
          : "Net worth",
        status: left ? "look" : "good",
        figure: shortMoney(h.netCents),
        summary: `You have ${formatCents(h.assetsCents)} and owe ${formatCents(h.debtsCents)}.${left ? ` ${left.sentence}` : ""}`,
      }),
    );
  }
  if (h.investmentsCents > 0) {
    items.have.push(
      item("have", "investments", {
        label: "Investments",
        figure: shortMoney(h.investmentsCents),
        summary: "Retirement and investment accounts, at the balance they report.",
      }),
    );
  }
  items.have.push(
    h.owned > 0
      ? item("have", "owned", {
          label: "Things you own",
          figure: shortMoney(h.ownedCents),
          summary: `${plural(h.owned, "thing")}, at your own values.`,
        })
      : item("have", "owned", {
          label:
            h.assetPrompt === "vehicle"
              ? "Add your car"
              : h.assetPrompt
                ? "Add your home"
                : "Things you own",
          status: h.assetPrompt ? "look" : undefined,
          summary: h.assetPrompt
            ? `You have a ${h.assetPrompt === "vehicle" ? "car" : "home"} loan with nothing linked to it. Add what it's worth to see your equity.`
            : "Add a home or a car to count it in your net worth.",
        }),
  );
  items.have.push(
    item("have", "goals", {
      label: "Savings goals",
      figure: h.goals.total > 0 ? `${h.goals.onTrack} of ${h.goals.total}` : undefined,
      line: h.goals.total > 0 ? "on track" : undefined,
      summary:
        h.goals.total > 0
          ? `${h.goals.onTrack} of your ${plural(h.goals.total, "goal")} on track.`
          : "Set a goal to save toward.",
    }),
  );
  if (h.debt.accounts > 0) {
    items.have.push(
      item("have", "loans", {
        label: "Loans and cards",
        figure: shortMoney(h.debt.owedCents),
        summary: `Owed across ${plural(h.debt.accounts, "account")}.`,
      }),
    );
  }

  if (input.hasAccounts) {
    items.transactions.push(
      item("transactions", "find", {
        label: "Find a transaction",
        summary: "Search by merchant, and fix a category for one or for every one there.",
      }),
    );
  }
  if (input.rules > 0) {
    items.transactions.push(
      item("transactions", "rules", {
        label: "Your category rules",
        figure: String(input.rules),
        summary: `${plural(input.rules, "merchant")} you put in a category of your own.`,
      }),
    );
  }

  return buildAreaTree({
    key: "money",
    label: "Spending & bills",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : "All good",
    branches: (Object.keys(MONEY_BRANCHES) as MoneyBranch[]).map((id) => ({
      id,
      label: MONEY_BRANCHES[id],
      items: items[id],
    })),
  });
}
