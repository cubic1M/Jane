import type { TreeStatus } from "@/components/tree/interactive-tree";
import { isHiddenPage } from "@/config/hidden-pages";
import { shortMoney } from "@/lib/hub/view";
import { buildAreaTree, firstSentences, type AreaItem, type AreaTree } from "./tree";
import { formatRate } from "@/lib/percent";

// The Loans & credit page as a tree (docs/design/area-pages.md): Loans & credit → what's
// costing you now, your debts, cheaper loans, paying it off, your credit, before you borrow,
// family and rent, and the reviews → their items. Pure: the page loads the records its pages
// already use (the debt book, the open suggestions, the payoff plan, the credit score, the debt
// review) and hands them here; each item's detail (actions, the long text behind "More") stays in
// the page.

export const LOANS_BRANCHES = {
  costs: "Costing you now",
  debts: "Your debts",
  cheaper: "Cheaper loans",
  payoff: "Paying it off",
  credit: "Your credit",
  borrow: "Before you borrow",
  family: "Family and rent",
  reviews: "Reviews",
} as const;
export type LoansBranch = keyof typeof LOANS_BRANCHES;

export const itemId = (branch: LoansBranch, key: string) => `${branch}:${key}`;

// Which branch an open loans suggestion goes in, by its topic (src/detectors/debt.ts and the
// rest of the loans area). Anything not listed is something costing money now.
const TOPIC_BRANCH: Record<string, LoansBranch> = {
  refinance: "cheaper",
  auto_refinance: "cheaper",
  // Card debt as one cheaper loan sits with the other loan choices, where Compare options is
  // looked for (QA round 9).
  consolidation: "cheaper",
  student_repayment: "cheaper",
  student_forgiveness: "cheaper",
  mortgage_extra: "cheaper",
  pmi_removal: "cheaper",
  car_addons: "cheaper",
  debt_plan: "payoff",
  hardship_plan: "payoff",
  credit_building: "credit",
  borrowing_power: "borrow",
  family_loans: "family",
  family_credit: "family",
  cosign_risk: "family",
  rent_reporting: "family",
  rent_increase: "family",
};

// The page an item that is only a way to a page opens.
export const ITEM_PAGE: Readonly<Record<string, string>> = {
  "credit:goal": "/loans/goal",
  "borrow:power": "/loans/borrow",
  "borrow:home": "/loans/home",
  "borrow:car": "/loans/car",
  "borrow:cards": "/loans/cards",
  "reviews:debt": "/loans/review",
};

// Six words or fewer per topic, not the detectors' long headlines.
// A suggestion's own item on the tree (it's drawn there while it's open).
export const loansTopicNode = (topic: string) => itemId(TOPIC_BRANCH[topic] ?? "costs", topic);

export const TOPIC_LABELS: Record<string, string> = {
  card_interest: "Card interest you can cut",
  high_cost_loans: "Costly short-term borrowing",
  cash_advance: "Card cash advances",
  balance_transfer: "Move card debt to 0%",
  consolidation: "One cheaper loan for cards",
  bnpl: "Buy now, pay later due",
  medical_bills: "A medical bill to check",
  credit_report_errors: "Fix your credit report",
  refinance: "A cheaper loan",
  auto_refinance: "A cheaper car loan",
  student_repayment: "A better student loan plan",
  student_forgiveness: "Student loan forgiveness",
  mortgage_extra: "Extra mortgage payments",
  pmi_removal: "Drop your mortgage insurance",
  car_addons: "Car loan add-ons to cancel",
  debt_plan: "A plan to pay it off",
  hardship_plan: "When debt is too much",
  credit_building: "Build your credit",
  borrowing_power: "Compare lenders first",
  family_loans: "Money lent in the family",
  family_credit: "Help family with credit",
  cosign_risk: "A loan you co-signed",
  rent_reporting: "Get your rent reported",
  rent_increase: "Your rent went up",
};

// Money that is going now: urgent whatever the detector's urgency says.
const URGENT_TOPICS = new Set(["high_cost_loans", "cash_advance", "hardship_plan"]);

export type LoansTreeInput = {
  asOf: string;
  debts: {
    key: string;
    name: string;
    kindLabel: string;
    balanceCents: number | null;
    aprBps: number | null;
    paymentCents: number | null;
    nextDue: string | null;
    overdue: boolean;
    pastDueCents: number | null;
    inNetWorth: boolean;
  }[];
  // Open suggestions in the loans area.
  suggestions: {
    key: string;
    topic: string;
    short: string;
    worthCents: number;
    worthKind: string;
    urgency: string;
  }[];
  // Buy now, pay later installments due in the coming month.
  installments: number;
  payoff: { debtFreeMonth: string | null } | null;
  credit: { score: number; share: number | null; toUnderHighCents: number } | null;
  review: { needYou: number; on: string | null } | null;
};

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const cut = (text: string, n = 6) => text.split(/\s+/).slice(0, n).join(" ");

export function loansTree(input: LoansTreeInput): AreaTree {
  const item = (branch: LoansBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
    summary: firstSentences(rest.summary),
  });
  const by: Record<LoansBranch, AreaItem[]> = {
    costs: [],
    debts: [],
    cheaper: [],
    payoff: [],
    credit: [],
    borrow: [],
    family: [],
    reviews: [],
  };

  for (const s of input.suggestions) {
    const branch = TOPIC_BRANCH[s.topic] ?? "costs";
    const status: TreeStatus = URGENT_TOPICS.has(s.topic) || s.urgency === "now" ? "act" : "look";
    by[branch].push(
      item(branch, s.topic, {
        label: TOPIC_LABELS[s.topic] ?? "Something to look at",
        status,
        figure:
          s.worthCents > 0
            ? `${shortMoney(s.worthCents)}${s.worthKind === "risk" ? "" : "/yr"}`
            : undefined,
        cents: s.worthCents,
        summary: s.short,
      }),
    );
  }

  for (const d of input.debts) {
    const status: TreeStatus = d.overdue ? "act" : "good";
    const parts = [
      d.paymentCents !== null ? `${shortMoney(d.paymentCents)} a month` : null,
      d.nextDue ? `next due ${dateLabel(d.nextDue)}` : null,
    ].filter(Boolean);
    by.debts.push(
      item("debts", d.key, {
        label: cut(d.name),
        line: d.kindLabel,
        status,
        figure:
          d.balanceCents === null
            ? "Not known"
            : `${shortMoney(d.balanceCents)}${d.aprBps !== null ? ` at ${formatRate(d.aprBps)}` : ""}`,
        cents: d.overdue ? (d.pastDueCents ?? d.balanceCents ?? 0) : undefined,
        summary: d.overdue
          ? `Your bank shows this as overdue${d.pastDueCents ? `: ${shortMoney(d.pastDueCents)} past due` : ""}.`
          : parts.length > 0
            ? `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase())
            : "Add what your bank doesn't report.",
      }),
    );
  }

  if (input.installments > 0) {
    by.debts.push(
      item("debts", "installments", {
        label: "Installments coming",
        status: "good",
        figure: `${input.installments} this month`,
        summary: "From each buy now, pay later plan's own schedule.",
      }),
    );
  }

  if (by.cheaper.length === 0 && input.debts.length > 0) {
    by.cheaper.push(
      item("cheaper", "checked", {
        label: "Refinance offers",
        status: "good",
        figure: "Checked monthly",
        summary: "Jane checks rates for your loans and cards every month.",
      }),
    );
  }

  if (input.payoff?.debtFreeMonth) {
    by.payoff.unshift(
      item("payoff", "plan", {
        label: "Your payoff plan",
        status: "good",
        figure: `Debt-free ${monthLabel(input.payoff.debtFreeMonth)}`,
        summary: "Your cards and loans paid down highest rate first. Try paying more each month.",
      }),
    );
  }

  if (input.credit) {
    const { score, share, toUnderHighCents } = input.credit;
    by.credit.unshift(
      item("credit", "score", {
        label: "Your credit score",
        status: "good",
        figure: String(score),
        summary: "Checked once a month with a soft pull, which never affects it.",
      }),
    );
    if (share !== null) {
      const high = toUnderHighCents > 0;
      by.credit.splice(
        1,
        0,
        item("credit", "use", {
          label: "Card use",
          status: high ? "look" : "good",
          figure: `${Math.round(share * 100)}%`,
          summary: high
            ? `Paying ${shortMoney(toUnderHighCents)} brings it under 30% of your limits.`
            : "Under 30% of your limits.",
        }),
      );
    }
  }
  by.credit.push(
    item("credit", "goal", {
      label: "A score for a goal",
      summary: "Tell Jane the score you need and by when, and Jane plans it month by month.",
    }),
  );

  by.borrow.push(
    item("borrow", "power", {
      label: "What you could borrow",
      summary: "The likely amount and rate for each kind of loan, from soft checks.",
    }),
    item("borrow", "home", {
      label: "Buying a home",
      summary: "What you can afford, what you need up front and how long it takes.",
    }),
    item("borrow", "car", {
      label: "Buying a car",
      summary: "What you can afford, with insurance and running costs in.",
    }),
    item("borrow", "cards", {
      label: "Best card for your spending",
      summary: "Which card earns most on what you buy, every fee counted.",
    }),
  );

  if (input.review) {
    by.reviews.push(
      item("reviews", "debt", {
        label: "Your debt review",
        status: input.review.needYou > 0 ? "look" : "good",
        figure: input.review.needYou > 0 ? `${input.review.needYou} need you` : "All checked",
        summary: input.review.on
          ? `Last done ${dateLabel(input.review.on)}: every debt and your credit, in one pass.`
          : "Every debt and your credit, checked in one pass.",
      }),
    );
  }

  // An item that only opens a page the read-only beta hides (src/config/hidden-pages.ts) isn't
  // in the tree.
  for (const b of Object.keys(by) as LoansBranch[])
    by[b] = by[b].filter((i) => !isHiddenPage(ITEM_PAGE[i.id] ?? ""));

  return buildAreaTree({
    key: "loans",
    label: "Loans & credit",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : "All good",
    branches: (Object.keys(LOANS_BRANCHES) as LoansBranch[]).map((id) => ({
      id,
      label: LOANS_BRANCHES[id],
      items: by[id],
    })),
  });
}

// Comparison cards on the tree (founder, 2026-10-24): the suggestions that are a choice of loan
// open the fit engine's options side by side ("Compare options"). What each one is priced for:
// a car loan's refinance is that car loan; the rest let the engine pick the dearest debt.
export const COMPARE_TOPICS = ["refinance", "auto_refinance", "consolidation"] as const;

export function compareWant(
  topic: string,
  debts: readonly { key: string; kind: string }[],
): { need: "refinance" | "consolidation"; debtKey?: string } | null {
  if (topic === "consolidation") return { need: "consolidation" };
  if (topic === "refinance") return { need: "refinance" };
  if (topic === "auto_refinance") {
    const car = debts.find((d) => d.kind === "auto");
    return car ? { need: "refinance", debtKey: car.key } : { need: "refinance" };
  }
  return null;
}
