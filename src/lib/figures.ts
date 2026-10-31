import {
  FIGURE_CORRECTIONS,
  FIGURE_LABELS,
  WORKING_TRANSACTIONS,
  type FigureId,
} from "@/config/figures";
import {
  FORECAST_DAYS,
  NON_SPENDING_CATEGORIES,
  NON_SPENDING_PRIMARIES,
  ONE_OFF_MIN_CENTS,
  ONE_OFF_PRIMARIES,
  ONE_OFF_SHARE,
} from "@/config/detection";
import {
  HEALTH_CARDS_ZERO_MONTHS,
  HEALTH_CUSHION_FULL_MONTHS,
  HEALTH_MARGIN_FULL_RATE,
  HEALTH_MARGIN_ZERO_RATE,
  HEALTH_POINTS_PER_SLIP,
  HEALTH_WEIGHTS,
} from "@/config/health-score";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import { categoryLabel } from "@/insights/labels";
import { netWorth, notCounting } from "@/insights/net-worth";
import { oneOffNote } from "@/insights/typical-month";
import { kindOf } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadPayoff } from "@/lib/debt-plan";
import { healthFor, healthInput } from "@/lib/health-score";
import { homeSummary } from "@/lib/home";
import { incomeOverride, listPreferences } from "@/lib/jane-agent/preferences";
import { formatCents } from "@/lib/money";
import { isoDay as iso } from "@/lib/dates";
import { monthLabel } from "@/lib/day-label";

// Every figure explained (spec step 239): "how did you get that?" for a headline figure, from
// the same loaders as the pages that show it: the rows it adds up, the transactions behind it,
// the rules and rates from config, and the date. What can be corrected is listed; a correction
// is made through the code the rest of the app reads (a category rule, the income fact), so
// it flows to every page that used it.

type Options = { client?: PrismaClient; now?: Date };

export type Working = {
  id: FigureId;
  title: string;
  value: string;
  asOf: string;
  summary: string;
  rows: { label: string; value: string; note?: string }[];
  transactions: {
    id: string;
    date: string;
    description: string;
    amountCents: number;
    category: string | null;
    detailed: string | null;
    category_label: string;
  }[];
  rules: { label: string; value: string }[];
  corrections: readonly ("category" | "income")[];
};

export async function explainFigure(
  userId: string,
  id: FigureId,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Working | null> {
  const input = await loadDetectionInput(userId, { client, now });
  if (input.accounts.length === 0) return null;
  const db = scopedFor(userId, client);
  const base = {
    id,
    title: FIGURE_LABELS[id],
    // The person's own day, as the figure was worked out (src/lib/today.ts).
    asOf: input.asOf,
    corrections: FIGURE_CORRECTIONS[id],
  };
  const txs = (
    rows: {
      id: string;
      date: string;
      description: string;
      amountCents: number;
      pfcPrimary: string | null;
      pfcDetailed: string | null;
    }[],
  ) =>
    rows.slice(0, WORKING_TRANSACTIONS).map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      category: t.pfcPrimary,
      detailed: t.pfcDetailed,
      category_label: categoryLabel(t.pfcPrimary),
    }));
  const empty = { transactions: [] as Working["transactions"], rules: [] as Working["rules"] };

  if (id === "safe_to_spend") {
    const safe = (await homeSummary(userId, { client, now }))?.safeToSpend;
    if (!safe) return null;
    return {
      ...base,
      ...empty,
      value: formatCents(safe.safeCents),
      summary: `What's in checking, less the bills and regular transfers due before ${safe.payday ?? "your next paycheck"}, what's left in this month's budgets, this month's goal amounts and the set-aside for yearly bills.`,
      rows: [
        { label: "In checking today", value: formatCents(safe.balanceCents) },
        ...safe.bills.map((b) => ({
          label: b.transfer ? `Regular transfer: ${b.merchant}` : `Bill: ${b.merchant}`,
          value: `−${formatCents(b.amountCents)}`,
          note: b.date,
        })),
        { label: "Budgets still to spend", value: `−${formatCents(safe.budgetsLeftCents)}` },
        { label: "Toward goals this month", value: `−${formatCents(safe.goalsCents)}` },
        ...(safe.setAsideCents > 0
          ? [{ label: "Set aside for yearly bills", value: `−${formatCents(safe.setAsideCents)}` }]
          : []),
        { label: "Safe to spend", value: formatCents(safe.safeCents) },
      ],
      rules: [
        { label: "Bills and paydays are looked for in the next", value: `${FORECAST_DAYS} days` },
      ],
    };
  }

  if (id === "monthly_spending" || id === "monthly_income") {
    const health = await healthInput(userId, input, { client, now });
    const month = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))).slice(
      0,
      7,
    );
    const rows = await db.transactions.findMany({
      where: {
        date: {
          gte: new Date(`${month}-01T00:00:00Z`),
          lt: new Date(`${iso(now).slice(0, 7)}-01T00:00:00Z`),
        },
        pending: false,
      },
      select: {
        id: true,
        date: true,
        description: true,
        amountCents: true,
        pfcPrimary: true,
        pfcDetailed: true,
        merchantName: true,
      },
    });
    const dated = rows.map((r) => ({ ...r, date: iso(r.date), pending: false }));
    const wanted = dated
      .filter((t) => kindOf(t) === (id === "monthly_spending" ? "spending" : "income"))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
    const prefs = await listPreferences(userId, { client });
    const said = incomeOverride(prefs);
    const value =
      id === "monthly_spending" ? health.monthlySpendingCents : health.monthlyIncomeCents;
    return {
      ...base,
      value: value === null ? "unknown" : formatCents(value),
      summary:
        id === "monthly_spending"
          ? `The average of your last full months' spending. ${oneOffNote(health.oneOffs ?? []) ? `${oneOffNote(health.oneOffs ?? [])} ` : ""}${monthLabel(month, { long: true })}'s biggest items are below; money moved between your own accounts and card payments aren't spending.`
          : said !== null
            ? `You told me you earn ${formatCents(said)} a month, so I use that instead of the average of your deposits.`
            : `The average of the paychecks and other deposits in your last full months. ${monthLabel(month, { long: true })}'s biggest are below.`,
      rows: [
        {
          label: id === "monthly_spending" ? "Average monthly spending" : "Average monthly income",
          value: value === null ? "unknown" : formatCents(value),
        },
        ...(id === "monthly_spending"
          ? (health.oneOffs ?? []).map((o) => ({
              label: `Left out: ${o.merchant}, ${o.date} (a one-off)`,
              value: formatCents(o.amountCents),
            }))
          : []),
        {
          label: `${monthLabel(month, { long: true })}'s ${id === "monthly_spending" ? "spending" : "income"}, in the items below and the rest`,
          value: formatCents(Math.abs(wanted.reduce((s, t) => s + t.amountCents, 0))),
        },
      ],
      transactions: txs(wanted),
      rules: [
        { label: "Not counted as spending: categories", value: NON_SPENDING_PRIMARIES.join(", ") },
        { label: "Not counted as spending: payments", value: NON_SPENDING_CATEGORIES.join(", ") },
        {
          label: "One-off costs left out",
          value: `from ${formatCents(ONE_OFF_MIN_CENTS)} and ${ONE_OFF_SHARE * 100}% of a usual month, in ${ONE_OFF_PRIMARIES.join(", ")}, from a merchant not charged that much again`,
        },
      ],
    };
  }

  if (id === "net_worth") {
    const [accounts, owned] = await Promise.all([
      db.accounts.findMany({
        select: { id: true, name: true, type: true, currentBalanceCents: true },
      }),
      db.ownedAssets.findMany({
        select: { id: true, name: true, valueCents: true, valuedOn: true },
      }),
    ]);
    const worth = netWorth(
      accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
      owned.map((o) => ({ id: o.id, valueCents: o.valueCents, valuedOn: iso(o.valuedOn) })),
    );
    return {
      ...base,
      ...empty,
      // Never a silent $0: "Not known yet" when no balance is known, and what's left out said.
      value: worth.known ? formatCents(worth.netCents) : "Not known yet",
      summary: [
        "What your accounts hold and what you own, at the values you gave, less what you owe on cards and loans.",
        notCounting(worth.unbalanced)?.sentence,
      ]
        .filter(Boolean)
        .join(" "),
      rows: [
        ...accounts.map((a) => ({
          label: a.name,
          value:
            a.currentBalanceCents === null
              ? "no balance"
              : formatCents(
                  a.type === "credit" || a.type === "loan"
                    ? -a.currentBalanceCents
                    : a.currentBalanceCents,
                ),
        })),
        ...owned.map((o) => ({
          label: `${o.name} (your value)`,
          value: formatCents(o.valueCents),
          note: `valued ${iso(o.valuedOn)}`,
        })),
        { label: "Net worth", value: formatCents(worth.netCents) },
      ],
    };
  }

  if (id === "health_score") {
    const health = await healthFor(userId, { client, now, input });
    if (!health) return null;
    return {
      ...base,
      ...empty,
      value: `${health.score} out of 100`,
      summary:
        health.counted.max === 100
          ? `Each part scores out of its weight, and the parts add up to ${health.score}.`
          : `Each part scores out of its weight. The parts I can count add up to ${health.counted.points} of ${health.counted.max}, which is ${health.score} out of 100; parts I can't see yet are left out, not counted against you.`,
      rows: [
        ...health.parts.map((p) => ({
          label: `${p.label} (out of ${p.max})`,
          value: String(p.points),
          note: p.why,
        })),
        ...health.left.map((l) => ({ label: `${l.label}: left out`, value: "–", note: l.why })),
        { label: `Total (out of ${health.counted.max})`, value: String(health.counted.points) },
      ],
      rules: [
        ...Object.entries(HEALTH_WEIGHTS).map(([part, weight]) => ({
          label: `Weight: ${part}`,
          value: String(weight),
        })),
        { label: "Full cushion at", value: `${HEALTH_CUSHION_FULL_MONTHS} months of spending` },
        {
          label: "Room each month",
          value: `full at ${HEALTH_MARGIN_FULL_RATE * 100}% left, none at ${-HEALTH_MARGIN_ZERO_RATE * 100}% over`,
        },
        { label: "Each late or overdraft fee", value: `${HEALTH_POINTS_PER_SLIP} points` },
        { label: "No card points at", value: `${HEALTH_CARDS_ZERO_MONTHS} months of income` },
      ],
    };
  }

  const payoff = await loadPayoff(userId, { client, now });
  return {
    ...base,
    ...empty,
    value: payoff.debtFreeMonth ?? "no set month",
    summary:
      "When the last debt is paid at the payments in your plan (the minimums with nothing extra if you haven't started one), interest included.",
    rows: payoff.book.debts.map((d) => ({
      label: d.name,
      value: d.balanceCents === null ? "unknown" : formatCents(d.balanceCents),
      note: [
        d.aprBps !== null ? `${(d.aprBps / 100).toFixed(2)}% a year` : null,
        d.paymentCents !== null ? `${formatCents(d.paymentCents)} a payment` : null,
      ]
        .filter(Boolean)
        .join(", "),
    })),
  };
}
