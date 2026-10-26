import { PLAN_SOON_DAYS, type PlanMoveKey } from "@/config/tax-plan";
import type { Route } from "next";
import type { TreeStatus } from "@/components/tree/interactive-tree";
import { shortMoney } from "@/lib/hub/view";
import type { SavingKey } from "@/planning/tax-savings";
import type { FieldStatus } from "@/planning/tax-profile";
import { buildAreaTree, firstSentences, type AreaItem, type AreaTree } from "./tree";

// The Taxes page as a tree (docs/design/area-pages.md): Taxes → its branches (what's due soon,
// ways to pay less, this year's estimate, records and forms, the person's situation, the tax
// profile, filing, special cases) → their items, each with a status, its key figure and a few
// words. Pure: the page loads the same records it always did and hands them here; each item's
// detail (its section, forms and buttons) stays in the page.

export const TAXES_BRANCHES = {
  soon: "Due soon",
  savings: "Pay less tax",
  estimate: "This year's numbers",
  records: "Records and forms",
  life: "Your situation",
  profile: "About you",
  filing: "Filing",
  topics: "Special cases",
} as const;
export type TaxesBranch = keyof typeof TAXES_BRANCHES;

export const itemId = (branch: TaxesBranch, key: string) => `${branch}:${key}`;

export const PLAN_LABELS: Record<PlanMoveKey, string> = {
  workplace_retirement: "Add to your 401(k)",
  ira: "Put money in an IRA",
  hsa: "Fill your HSA",
  fsa_enroll: "Sign up for an FSA",
  estimated_1: "First estimated payment",
  estimated_2: "Second estimated payment",
  estimated_3: "Third estimated payment",
  estimated_4: "Fourth estimated payment",
  harvest: "Sell at a loss",
  giving: "Give before year end",
  w4_life_event: "Update your W-4",
  file: "File your return",
};

export const SAVING_LABELS: Record<SavingKey, string> = {
  retirement: "Save more for retirement",
  ira: "Put money in an IRA",
  hsa: "Fill your HSA",
  health_fsa: "Use a health FSA",
  dependent_care: "Use a dependent care FSA",
  itemize: "Itemize your deductions",
  bunch_gifts: "Bunch your gifts",
  student_loan: "Deduct student loan interest",
  education_credit: "Claim an education credit",
  energy_credit: "Claim the energy credit",
};

// The pages for one subject, as items: each says what's there in a sentence or two and opens
// its own page.
type Topic = { key: string; label: string; what: string; href: Route; link: string };
export const TOPICS: Record<"filing" | "topics", readonly Topic[]> = {
  filing: [
    {
      key: "file",
      label: "File your return",
      what: "How to file, with everything Jane gathered for the year. Nothing is filed without your tap.",
      href: "/taxes/file",
      link: "File your taxes",
    },
    {
      key: "self-employed",
      label: "Freelance taxes",
      what: "Freelance or gig work: what you owe each quarter and what you can take off.",
      href: "/taxes/self-employed",
      link: "See my freelance taxes",
    },
    {
      key: "pack",
      label: "Tax-time pack",
      what: "The year's records in one place, for you or whoever does your taxes.",
      href: "/tax-pack",
      link: "Open my tax-time pack",
    },
    {
      key: "draft",
      label: "Check a draft return",
      what: "Upload the draft from your software or accountant and Jane checks every line against your forms and accounts. It never files it.",
      href: "/taxes/draft",
      link: "Check my draft return",
    },
    {
      key: "last-return",
      label: "Last year's return",
      what: "Upload a return you filed and Jane checks it against your accounts for money left behind. It prepares an amended return for you to review and sign.",
      href: "/taxes/last-return",
      link: "Review a past return",
    },
    {
      key: "accountant",
      label: "Work with an accountant",
      what: "One read-only link with your tax pack, the forms Jane collected and its questions. It ends when you say, and their answers come back here.",
      href: "/taxes/accountant",
      link: "Make a link for my accountant",
    },
    {
      key: "calendar",
      label: "Your tax calendar",
      what: "What Jane does each month of the tax year, on its own within your caps or with your tap.",
      href: "/taxes/calendar",
      link: "See my tax calendar",
    },
    {
      key: "years",
      label: "Taxes over the years",
      what: "Your federal tax for each year ahead, and the moves, like a Roth conversion in a low year, that save the most over all of them.",
      href: "/taxes/years",
      link: "See my tax years",
    },
  ],
  topics: [
    {
      key: "equity",
      label: "Crypto and equity pay",
      what: "Crypto gains by lot, ESPP sales, ISO exercises with the alternative minimum tax and RSU withholding, worked out and in your estimate.",
      href: "/taxes/equity",
      link: "See my crypto and equity",
    },
    {
      key: "business",
      label: "Business taxes",
      what: "For your own business or side work: the qualified business income deduction, whether an S corporation would save more than it costs, and the home office and miles.",
      href: "/taxes/business",
      link: "See my business taxes",
    },
    {
      key: "property",
      label: "Property tax",
      what: "Is your home assessed for more than it's worth? An appeal drafted with comparable sales, the county's deadline, and exemptions you may not have claimed.",
      href: "/taxes/property",
      link: "Check my property tax",
    },
    {
      key: "retirement",
      label: "Retirement income",
      what: "How much of your Social Security is taxable, Medicare's income surcharge two years ahead, and the order to draw from your accounts.",
      href: "/taxes/retirement",
      link: "See my retirement taxes",
    },
    {
      key: "inherited",
      label: "Inherited money and gifts",
      what: "An inherited IRA's deadline, gifts that need a gift tax return, the step-up in basis and the estate tax facts.",
      href: "/taxes/inherited",
      link: "See inherited money and gifts",
    },
    {
      key: "disasters",
      label: "Disasters and losses",
      what: "When the IRS postpones deadlines for your county, Jane moves yours, and keeps a loss insurance didn't cover with the claim.",
      href: "/taxes/disasters",
      link: "See disaster relief",
    },
    {
      key: "health",
      label: "Health cover and taxes",
      what: "A Marketplace credit checked against your income, HSA deposits against the limit, and medical costs against the 7.5% floor.",
      href: "/taxes/health",
      link: "See the tax side of my health cover",
    },
    {
      key: "identity",
      label: "Your tax identity",
      what: "An IRS Identity Protection PIN keeps anyone else from filing with your Social Security number. If a sign of theft shows up, Jane gives you the steps in order.",
      href: "/taxes/identity",
      link: "Protect my tax identity",
    },
    {
      key: "letters",
      label: "Letters from the IRS",
      what: "Photograph a notice and Jane explains it, puts its date on your deadlines, checks it against your records and drafts a reply for you to send.",
      href: "/taxes/letters",
      link: "Open my letters",
    },
  ],
};

// The old section anchors (/taxes#withholding in Jane's messages) and the item each opens.
export const TAXES_ANCHORS: Record<string, string> = {
  plan: "soon",
  savings: "savings",
  estimate: "estimate:estimate",
  withholding: "estimate:withholding",
  refund: "estimate:refund",
  investments: "estimate:investments",
  forms: "records:forms",
  organised: "records:tags",
  records: "records:audit",
  "side-income": "life:side-income",
  home: "life:home",
  family: "life:family",
  giving: "life:giving",
  profile: "profile",
  ...Object.fromEntries(
    (["filing", "topics"] as const).flatMap((b) => TOPICS[b].map((t) => [t.key, itemId(b, t.key)])),
  ),
};

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type TaxesTreeInput = {
  asOf: string;
  year: number;
  moves: {
    id: string;
    key: PlanMoveKey;
    detail: string;
    deadline: string;
    opensOn: string;
    handled: "added" | "no" | null;
    amountCents: number | null;
  }[];
  // Null when savings suggestions are off (real accounts, outside demo advice).
  savings: { key: SavingKey; title: string; estimateCents: number }[] | null;
  estimate: { refundCents: number; withholdingKnown: boolean };
  withholding: "unknown" | "on_track" | "big_refund" | "bill_coming";
  w4Sent: boolean;
  refunds: number;
  investments: { washSales: number; harvest: number } | null;
  forms: { total: number; received: number; toCheck: number };
  tags: { checks: number };
  records: { items: number; needs: number; gaps: number; canGo: number };
  sideIncome: { differs: number; waiting: number } | null;
  home: boolean;
  family: { choices: number } | null;
  giving: { totalCents: number; receiptsMissing: number; options: number } | null;
  profile: {
    complete: boolean;
    newIncome: number;
    fields: { key: string; label: string; value: string; status: FieldStatus }[];
  };
};

export function taxesTree(input: TaxesTreeInput): AreaTree {
  const item = (branch: TaxesBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
    summary: firstSentences(rest.summary),
  });

  const soon = input.moves.map((m) => {
    const later = m.opensOn > input.asOf;
    const status: TreeStatus =
      m.handled !== null || later
        ? "good"
        : days(input.asOf, m.deadline) <= PLAN_SOON_DAYS
          ? "act"
          : "look";
    return item("soon", m.id, {
      label: PLAN_LABELS[m.key],
      status,
      figure: `by ${dateLabel(m.deadline)}`,
      cents: m.amountCents ?? 0,
      // Its state ("Open now", "On your deadlines") and its button are the detail.
      summary: m.detail,
    });
  });

  const savings = (input.savings ?? []).map((s) =>
    item("savings", s.key, {
      label: SAVING_LABELS[s.key],
      status: "look",
      figure: `${shortMoney(s.estimateCents)}/yr`,
      cents: s.estimateCents,
      // The one thing to do; why is behind "More".
      summary: `${s.title}.`,
    }),
  );

  const r = input.estimate.refundCents;
  const estimate = [
    item("estimate", "estimate", {
      label: `Your ${input.year} estimate`,
      status: r >= 0 ? "good" : "look",
      figure: input.estimate.withholdingKnown
        ? r >= 0
          ? `${shortMoney(r)} back`
          : `${shortMoney(-r)} owed`
        : undefined,
      summary: "Worked out from your pay and accounts. Every figure is an estimate.",
    }),
    item("estimate", "withholding", {
      label: "Withholding",
      status:
        input.w4Sent || input.withholding === "on_track"
          ? "good"
          : input.withholding === "unknown"
            ? undefined
            : "look",
      figure: input.w4Sent
        ? "New W-4"
        : {
            unknown: undefined,
            on_track: "On track",
            big_refund: "Too much",
            bill_coming: "Too little",
          }[input.withholding],
      summary:
        input.withholding === "big_refund" && !input.w4Sent
          ? "More is taken from each paycheck than your tax."
          : input.withholding === "bill_coming" && !input.w4Sent
            ? "Less is taken from each paycheck than your tax."
            : "What's taken from each paycheck, against your tax.",
    }),
  ];
  if (input.refunds > 0)
    estimate.push(
      item("estimate", "refund", {
        label: input.refunds === 1 ? "Your refund" : "Your refunds",
        status: "good",
        figure: count(input.refunds, "refund"),
        summary: "Each refund Jane saw, matched to your estimate.",
      }),
    );
  if (input.investments) {
    const { washSales, harvest } = input.investments;
    estimate.push(
      item("estimate", "investments", {
        label: "Investments",
        status: washSales > 0 || harvest > 0 ? "look" : "good",
        figure: washSales > 0 ? count(washSales, "wash sale") : undefined,
        summary: "Gains and losses from the cost basis your broker reports.",
      }),
    );
  }

  const f = input.forms;
  const records = [
    item("records", "forms", {
      label: "Forms to expect",
      status: f.toCheck > 0 ? "look" : "good",
      figure: f.total === 0 ? "None" : `${f.received} of ${f.total} in`,
      summary:
        f.toCheck > 0
          ? `${count(f.toCheck, "form")} Jane collected ${f.toCheck === 1 ? "needs" : "need"} your check.`
          : "The forms your accounts should send, ticked off as they come.",
    }),
    item("records", "tags", {
      label: `Tagged for ${input.year}`,
      status: input.tags.checks > 0 ? "look" : "good",
      figure: input.tags.checks > 0 ? `${input.tags.checks} to check` : undefined,
      summary: "Donations, work and medical costs, and more, tagged from your accounts.",
    }),
    item("records", "audit", {
      label: "Audit-ready records",
      status: input.records.needs + input.records.gaps + input.records.canGo > 0 ? "look" : "good",
      figure:
        input.records.needs + input.records.gaps > 0
          ? `${input.records.needs + input.records.gaps} missing`
          : count(input.records.items, "item"),
      summary: "Every deduction and credit with where it came from.",
    }),
  ];

  const life: AreaItem[] = [];
  if (input.sideIncome)
    life.push(
      item("life", "side-income", {
        label: "Side income and rentals",
        status: input.sideIncome.differs > 0 ? "look" : "good",
        figure:
          input.sideIncome.differs > 0 ? `${input.sideIncome.differs} don't match` : undefined,
        summary: "Rent, gig payouts and their 1099s, matched.",
      }),
    );
  if (input.home)
    life.push(
      item("life", "home", {
        label: "Your home",
        status: "good",
        summary: "Mortgage interest and property tax, each from where it came.",
      }),
    );
  if (input.family)
    life.push(
      item("life", "family", {
        label: "Family tax choices",
        status: input.family.choices > 0 ? "look" : "good",
        figure: input.family.choices > 0 ? count(input.family.choices, "choice") : undefined,
        summary: "Each family choice with the federal tax both ways.",
      }),
    );
  if (input.giving) {
    const g = input.giving;
    life.push(
      item("life", "giving", {
        label: "Giving",
        status: g.receiptsMissing > 0 || g.options > 0 ? "look" : "good",
        figure: g.totalCents > 0 ? shortMoney(g.totalCents) : undefined,
        summary:
          g.receiptsMissing > 0
            ? `${count(g.receiptsMissing, "gift")} of $250 or more ${g.receiptsMissing === 1 ? "needs" : "need"} the charity's receipt.`
            : "Your gifts to charity this year, and their receipts.",
      }),
    );
  }

  const profile = input.profile.fields.map((p) =>
    item("profile", p.key, {
      label: p.label,
      status: p.status === "yours" ? "good" : "look",
      figure: p.status === "missing" ? "Not set" : p.status === "found" ? "Check it" : undefined,
      summary: p.value === "—" ? "Not set yet." : `${p.value}.`,
    }),
  );
  if (input.profile.newIncome > 0)
    profile.unshift(
      item("profile", "new-income", {
        label: "New income to add",
        status: "look",
        figure: count(input.profile.newIncome, "kind"),
        summary: "Income Jane saw since you answered.",
      }),
    );

  const links = (branch: "filing" | "topics") =>
    TOPICS[branch].map((t) => item(branch, t.key, { label: t.label, summary: t.what }));

  const branches: { id: TaxesBranch; items: AreaItem[] }[] = [
    { id: "soon", items: soon },
    { id: "savings", items: savings },
    { id: "estimate", items: estimate },
    { id: "records", items: records },
    { id: "life", items: life },
    { id: "profile", items: profile },
    { id: "filing", items: links("filing") },
    { id: "topics", items: links("topics") },
  ];
  return buildAreaTree({
    key: "taxes",
    label: "Taxes",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : "All good",
    branches: branches.map((b) => ({ id: b.id, label: TAXES_BRANCHES[b.id], items: b.items })),
  });
}
