import type { Route } from "next";
import type { TreeStatus } from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import { buildAreaTree, type AreaItem, type AreaTree } from "./tree";

// The Investing page as a tree (docs/design/area-pages.md): Investing → its branches (Jane's
// ideas on real money, what's owned, how it's done, the practice portfolio, its strategies and
// news alerts, the plan, kinds of accounts, costs and care) → their items. Pure: the page loads
// the same records it always did; the practice logic stays in src/lib/practice.

export const INVESTING_BRANCHES = {
  ideas: "Jane's ideas",
  owned: "What you own",
  done: "How it's done",
  practice: "Practice portfolio",
  strategies: "Strategies",
  news: "News alerts",
  plan: "Your plan",
  kinds: "Kinds of accounts",
  costs: "Costs and care",
} as const;
export type InvestingBranch = keyof typeof INVESTING_BRANCHES;

export const itemId = (branch: InvestingBranch, key: string) => `${branch}:${key}`;

type Page = { key: string; label: string; what: string; href: Route };

// The sub-pages, each an item that says what's there and opens it.
export const PAGES: Record<"plan" | "kinds" | "costs", readonly Page[]> = {
  plan: [
    {
      key: "review",
      label: "Portfolio review",
      what: "Your mix against the target for your risk level.",
      href: "/investments/review",
    },
    {
      key: "retirement",
      label: "Retirement",
      what: "What you could have by 67, and your employer match.",
      href: "/investments/retirement",
    },
    {
      key: "auto",
      label: "Automatic investing",
      what: "Every payday, only what safe to spend doesn't need.",
      href: "/investments/auto",
    },
    {
      key: "accounts",
      label: "Which account first",
      what: "The match, HSA, IRA or taxable, and where to hold what.",
      href: "/investments/accounts",
    },
    {
      key: "goals",
      label: "Invested for each goal",
      what: "Cash when it's close, safer as the date nears.",
      href: "/investments/goals",
    },
    {
      key: "location",
      label: "The right account for each",
      what: "Bonds where interest isn't taxed, without changing your mix.",
      href: "/investments/location",
    },
    {
      key: "plan-menu",
      label: "Your workplace plan's funds",
      what: "The cheapest mix of the funds your 401(k) offers.",
      href: "/investments/plan-menu",
    },
    {
      key: "sudden-money",
      label: "Sudden money",
      what: "A bonus, an inheritance or a sale, with tax first and a plan in order.",
      href: "/investments/sudden-money",
    },
  ],
  kinds: [
    {
      key: "retirement-accounts",
      label: "Retirement accounts",
      what: "Every limit and every dollar of match used.",
      href: "/investments/retirement-accounts",
    },
    {
      key: "old-accounts",
      label: "Old accounts",
      what: "A forgotten 401(k) at a past employer, found and rolled over.",
      href: "/investments/old-accounts",
    },
    {
      key: "retirement-income",
      label: "Income in retirement",
      what: "Social Security, the order to draw, and a paycheck that lasts.",
      href: "/investments/retirement-income",
    },
    {
      key: "hsa",
      label: "HSA",
      what: "Invested beyond a cash cushion, and the receipts vault.",
      href: "/investments/hsa",
    },
    {
      key: "college",
      label: "College savings",
      what: "What it could cost and the 529 that comes out ahead.",
      href: "/investments/college",
    },
    {
      key: "family",
      label: "Family",
      what: "A child's custodial account and Roth IRA, and gifts to their college fund.",
      href: "/investments/family",
    },
    {
      key: "company-stock",
      label: "Company stock",
      what: "RSUs, ESPP and options, without too many eggs in one basket.",
      href: "/investments/company-stock",
    },
    {
      key: "crypto",
      label: "Crypto",
      what: "Exchanges and wallets, read-only. Jane never trades crypto.",
      href: "/investments/crypto",
    },
    {
      key: "cash",
      label: "Cash",
      what: "Every dollar earning what it should, with the emergency fund in reach.",
      href: "/investments/cash",
    },
    {
      key: "short-term",
      label: "Short-term money",
      what: "Bills, CDs, I bonds and savings compared after tax, with a ladder that matures on time.",
      href: "/investments/short-term",
    },
    {
      key: "property",
      label: "Property",
      what: "Home equity and rentals, from their own transactions.",
      href: "/investments/property",
    },
  ],
  costs: [
    {
      key: "fees",
      label: "What investing costs you",
      what: "Every fee, a year and over 30 years.",
      href: "/investments/fees",
    },
    {
      key: "costly-products",
      label: "Costly products",
      what: "Annuities, whole life and advisory fees in dollars, with the charge for leaving.",
      href: "/investments/costly-products",
    },
    {
      key: "values",
      label: "Investing by your values",
      what: "Leave out fossil fuels, weapons or tobacco, with the cost and diversification shown.",
      href: "/investments/values",
    },
    {
      key: "family-file",
      label: "The family looked after",
      what: "Who is named on each account, what a life change makes out of date, and a file to share.",
      href: "/investments/family-file",
    },
  ],
};

// Jane's ideas by topic, in six words or fewer; the detector's own line is the summary.
export const TOPIC_LABELS: Record<string, string> = {
  employer_match: "Get the full match",
  catch_up: "Catch-up contributions",
  hsa: "Invest your HSA",
  backdoor_roth: "A backdoor Roth IRA",
  education_529: "A 529 for the kids",
  rmd: "A required withdrawal",
  asset_location: "Right account for each fund",
  auto_invest: "Invest automatically",
  costly_products: "A costly product",
  investment_fees: "Lower your fund fees",
  old_accounts: "Roll over an old account",
  rebalance: "Rebalance your mix",
  idle_cash: "Put idle cash to work",
  beneficiaries: "Name a beneficiary",
  plan_menu: "Cheaper funds in your plan",
  short_term_cash: "Short-term money",
  sudden_money: "A plan for sudden money",
  values_funds: "Invest by your values",
  social_security_timing: "When to claim Social Security",
  concentration: "Too much in one place",
  retirement_self_employed: "A retirement plan for yourself",
};

// Six words at most: a longer line is cut and marked, the whole of it is the summary.
const shortLabel = (text: string) => {
  const w = text.trim().split(/\s+/);
  return w.length <= 6 ? w.join(" ") : `${w.slice(0, 6).join(" ")}…`;
};

export type InvestingTreeInput = {
  // Open suggestions on real money in the investing area, most valuable first.
  suggestions: {
    key: string;
    topic: string;
    short: string;
    worthCents: number | null;
    worthKind: string;
    urgency: string;
  }[];
  accounts: { id: string; name: string; balanceCents: number | null; holdings: number }[];
  totalCents: number;
  byType: number;
  cryptoCents: number;
  profile: { complete: boolean; label: string | null };
  returns: { periods: number };
  months: boolean;
  // Demo advice only (the practice portfolio and its research); null otherwise.
  practice: {
    started: boolean;
    ideas: { key: string; kind: string; headline: string; percent: number; worthCents: number }[];
    strategy: { label: string; followed: boolean; note: string } | null;
  } | null;
};

export function investingTree(input: InvestingTreeInput): AreaTree {
  const item = (branch: InvestingBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
  });

  const ideas = input.suggestions.map((s) =>
    item("ideas", s.key, {
      label: TOPIC_LABELS[s.topic] ?? shortLabel(s.short),
      status: s.urgency === "now" ? "act" : "look",
      figure:
        s.worthCents && s.worthCents > 0
          ? `${shortMoney(s.worthCents)}${s.worthKind === "risk" ? "" : "/yr"}`
          : undefined,
      cents: s.worthCents ?? 0,
      summary: s.short,
    }),
  );

  const owned: AreaItem[] = [];
  if (input.accounts.length > 0) {
    owned.push(
      item("owned", "total", {
        label: "In total",
        status: "good",
        figure: shortMoney(input.totalCents),
        summary: "The same as in your net worth.",
      }),
      ...input.accounts.map((a) =>
        item("owned", a.id, {
          label: shortLabel(a.name),
          status: "good",
          figure: a.balanceCents === null ? undefined : shortMoney(a.balanceCents),
          summary:
            a.holdings === 0
              ? "Your bank reports the balance but not what's in it."
              : `${a.holdings} ${a.holdings === 1 ? "holding" : "holdings"}, with where each number came from.`,
        }),
      ),
    );
    if (input.byType > 0)
      owned.push(
        item("owned", "by-type", {
          label: "By type",
          summary: "Stocks, bonds and cash, with funds split by what they hold.",
        }),
      );
  }
  if (input.cryptoCents > 0)
    owned.push(
      item("owned", "crypto", {
        label: "Crypto",
        status: "good",
        figure: shortMoney(input.cryptoCents),
        summary: "Read-only, from your exchanges and wallets.",
      }),
    );

  const done: AreaItem[] = [];
  if (input.returns.periods > 0)
    done.push(
      item("done", "returns", {
        label: "Returns",
        summary: "What you own and your own money, against a similar low-cost mix.",
      }),
    );
  if (input.months)
    done.push(
      item("done", "months", {
        label: "Month by month",
        summary: "Retirement and other investing, at each month's end.",
      }),
    );
  if (input.accounts.length > 0)
    done.push(
      item("done", "performance", {
        label: "How your money really did",
        summary: "1, 3 and 5 years, after fees and taxes, against a simple mix with your risk.",
      }),
    );

  const p = input.practice;
  // News ideas and news themes' ideas both come from the day's headlines.
  const isNews = (kind: string) => kind === "news_idea" || kind === "theme_idea";
  const ideaItem = (branch: "practice" | "news") => (i: NonNullable<typeof p>["ideas"][number]) =>
    item(branch, i.key, {
      label: shortLabel(i.headline),
      status: "look",
      figure: `${i.percent}% sure`,
      summary: i.headline,
    });
  const practice: AreaItem[] = p
    ? [
        ...p.ideas.filter((i) => !isNews(i.kind)).map(ideaItem("practice")),
        item("practice", "portfolio", {
          label: p.started ? "Your practice portfolio" : "Start a practice portfolio",
          summary: "Jane runs a paper portfolio on practice money, with every trade explained.",
        }),
      ]
    : [
        item("practice", "portfolio", {
          label: "Practice portfolio",
          summary: "Jane runs a paper portfolio on practice money, with every trade explained.",
        }),
      ];

  const strategies: AreaItem[] = p
    ? [
        ...(p.strategy
          ? [
              item("strategies", "today", {
                label: "Your strategy today",
                status: (p.strategy.followed ? "good" : "look") as TreeStatus,
                summary: `${p.strategy.label}.${p.strategy.followed ? "" : ` ${p.strategy.note}`}`,
              }),
            ]
          : []),
        item("strategies", "levels", {
          label: "The strategy each level follows",
          summary: "Seven ways of running each level, replayed on real prices every day.",
        }),
        item("strategies", "menu", {
          label: "More strategies",
          summary: "Other well-known ways to run it, and crypto at Very high, each replayed.",
        }),
        item("strategies", "backtests", {
          label: "Each level, replayed",
          summary: "How each risk level would have done over past prices.",
        }),
        item("strategies", "rules", {
          label: "Did the extra rules help?",
          summary: "The autopilot's rules replayed, with and without each one.",
        }),
      ]
    : [];

  const newsIdeas = p ? p.ideas.filter((i) => isNews(i.kind)) : [];
  const news: AreaItem[] = p
    ? [
        ...(newsIdeas.length > 0
          ? newsIdeas.map(ideaItem("news"))
          : [
              item("news", "none", {
                label: "Nothing in the news now",
                status: "good",
                summary:
                  "Jane reads the news on your practice stocks every day and brings what matters.",
              }),
            ]),
        item("news", "themes", {
          label: "News themes",
          summary: "Which kinds of news moved which funds before, and which held up.",
        }),
      ]
    : [];

  const plan = [
    item("plan", "profile", {
      label: "Your investor profile",
      status: input.profile.complete ? "good" : "look",
      figure: input.profile.complete ? undefined : "4 questions",
      summary: input.profile.complete
        ? `${input.profile.label}.`
        : "Tell Jane what this money is for: four quick questions.",
    }),
    ...PAGES.plan.map((pg) => item("plan", pg.key, { label: pg.label, summary: pg.what })),
  ];
  const kinds = PAGES.kinds.map((pg) =>
    item("kinds", pg.key, { label: pg.label, summary: pg.what }),
  );
  const costs = PAGES.costs.map((pg) =>
    item("costs", pg.key, { label: pg.label, summary: pg.what }),
  );

  const branches: { id: InvestingBranch; items: AreaItem[] }[] = [
    { id: "ideas", items: ideas },
    { id: "owned", items: owned },
    { id: "done", items: done },
    { id: "practice", items: practice },
    { id: "strategies", items: strategies },
    { id: "news", items: news },
    { id: "plan", items: plan },
    { id: "kinds", items: kinds },
    { id: "costs", items: costs },
  ];
  return buildAreaTree({
    key: "investments",
    label: "Investing",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : input.accounts.length > 0
            ? `${shortMoney(input.totalCents)} invested`
            : "All good",
    branches: branches.map((b) => ({ id: b.id, label: INVESTING_BRANCHES[b.id], items: b.items })),
  });
}
