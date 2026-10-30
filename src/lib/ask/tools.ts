import type Anthropic from "@anthropic-ai/sdk";
import {
  ASK_DEFAULT_SEARCH_DAYS,
  ASK_MAX_UPCOMING_DAYS,
  ASK_SEARCH_LIMIT,
  ASK_WHOLE_HISTORY_DAYS,
} from "@/config/ask";
import { INSIGHT_MONTHS } from "@/config/insights";
import { CARD_PAYMENT_NAME, NON_SPENDING_PRIMARIES } from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { loadDetectionInput, loadTransactionsBetween } from "@/detection/engine";
import { upcomingBills } from "@/detection/forecast";
import { addDays, isoDate } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { categoryLabel } from "@/insights/labels";
import { monthsEnding, spendingInsights } from "@/insights/spending";
import { oneOffCharges } from "@/insights/typical-month";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import type { OfferedOptions } from "@/lib/option-card";
import { savingsPhrase } from "@/lib/savings-text";

// The tools Claude can use to answer questions about the person's money. Every tool reads
// through scopedFor(userId), so it can only ever see the signed-in person's rows, and none
// can change anything. Results hold cleaned-up merchant names, categories, dates and
// amounts: never raw bank descriptions, account names or numbers. Every dollar figure a
// tool returns is recorded, so the guardrails can tell real figures from invented ones.

export const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_transactions",
    description:
      "Find the person's transactions. Filter by merchant name (partial match), spending category, and dates. Returns the matching transactions (newest first, up to 25), how many matched, and the total money out and in across all matches. When a merchant has none in those dates, outsideTheseDates lists its charges at other times: say those, never that there are none.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Part of a merchant name, e.g. 'netflix'." },
        category: {
          type: "string",
          description: "A category name as spending_by_category returns it, e.g. 'Food and drink'.",
        },
        from: { type: "string", description: "First date, YYYY-MM-DD. Default: 90 days ago." },
        to: { type: "string", description: "Last date, YYYY-MM-DD. Default: today." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "spending_by_category",
    description:
      "Spending and income for one month, with spending by category, largest first. Money moved between the person's own accounts and card payments aren't counted.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. Default: the current month." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "monthly_totals",
    description: `Total spending and income for each of the last ${INSIGHT_MONTHS} months.`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_findings",
    description:
      "What the app found that could save the person money and they haven't decided on yet, with each estimate.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_actions",
    description:
      "Changes the person asked our team to make, or is doing themselves, and where each stands.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "upcoming_bills",
    description: "Regular charges expected in the coming days, estimated from past transactions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "How many days ahead, 1 to 31. Default 31." },
      },
      additionalProperties: false,
    },
  },
];

// options: a pick-one card the tool found (insurance cover, loan offers), for the chat to
// show with the answer (refs.options).
export type ToolOutput = { content: string; cents: number[]; options?: OfferedOptions };

type Options = { client?: PrismaClient; now?: Date };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function displayMerchant(t: {
  merchantName: string | null;
  description: string;
  pfcPrimary: string | null;
}): string {
  // Transfers name people ("Zelle to ..."), so they're never shown by name.
  if (t.pfcPrimary && (NON_SPENDING_PRIMARIES as readonly string[]).includes(t.pfcPrimary)) {
    return "Transfer";
  }
  if (t.pfcPrimary === "INCOME") return "Income";
  return t.merchantName ?? normalizeMerchant(t.description)?.name ?? "Unknown merchant";
}

const CARD_PAYMENT_DETAILED = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// A card payment by the names Jane gives it elsewhere (src/detection/forecast.ts billName):
// "Credit card payment", "Chase card payment", "Chase Freedom payment", whatever the bank wrote
// ("CARD PAYMENT THANK YOU"). A named one needs its first word in the bank's words.
function cardPaymentAsked(asked: string, words: string): boolean {
  if (asked === CARD_PAYMENT_NAME.toLowerCase() || asked === "card payment") return true;
  const named = /^(\S+)(?: \S+)* payment$/.exec(asked)?.[1];
  return named !== undefined && named !== "car" && words.includes(named);
}

export async function runAskTool(
  userId: string,
  name: string,
  input: unknown,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ToolOutput> {
  const db = scopedFor(userId, client);
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return formatCents(Math.abs(value));
  };
  const today = isoDate(now);
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });

  switch (name) {
    case "search_transactions": {
      const to = DATE.test(str(args.to)) ? str(args.to) : today;
      const from = DATE.test(str(args.from))
        ? str(args.from)
        : addDays(to, -ASK_DEFAULT_SEARCH_DAYS);
      const merchant = str(args.merchant).toLowerCase();
      const category = str(args.category).toLowerCase();
      // Read as detection reads them (names from the merchant directory, an account linked twice
      // once), so what a card or page names is what this finds.
      const matching = async (from: string, to: string) =>
        (await loadTransactionsBetween(userId, { client, from, to }))
          .map((t) => ({
            date: t.date,
            merchant: displayMerchant(t),
            // The bank's own words, only to match on ("APPLE STORE R102" for "Apple Store");
            // never shown, and never for transfers, which name people.
            words: displayMerchant(t) === "Transfer" ? "" : t.description.toLowerCase(),
            cardPayment: t.pfcDetailed === CARD_PAYMENT_DETAILED,
            category: categoryLabel(t.pfcPrimary),
            amountCents: t.amountCents,
          }))
          .filter(
            (t) =>
              !merchant ||
              t.merchant.toLowerCase().includes(merchant) ||
              t.words.includes(merchant) ||
              (t.cardPayment && cardPaymentAsked(merchant, t.words)),
          )
          .filter((t) => !category || t.category.toLowerCase() === category);
      const matches = await matching(from, to);
      // None in these dates: the merchant's charges from before (or after) them, so a card built
      // from a charge last December is never answered with "no charges" (founder's live
      // /deadlines, 10-29: the chat looked from Aug 1 for a December charge).
      const elsewhere =
        merchant && matches.length === 0
          ? (await matching(addDays(today, -ASK_WHOLE_HISTORY_DAYS), today)).filter(
              (t) => t.date < from || t.date > to,
            )
          : [];
      const outTotal = matches
        .filter((t) => t.amountCents > 0)
        .reduce((s, t) => s + t.amountCents, 0);
      const inTotal = matches
        .filter((t) => t.amountCents < 0)
        .reduce((s, t) => s + t.amountCents, 0);
      return out({
        from,
        to,
        matched: matches.length,
        totalMoneyOut: money(outTotal),
        totalMoneyIn: money(inTotal),
        transactions: matches.slice(0, ASK_SEARCH_LIMIT).map((t) => ({
          date: t.date,
          merchant: t.merchant,
          category: t.category,
          amount: money(t.amountCents),
          direction: t.amountCents > 0 ? "out" : "in",
        })),
        ...(elsewhere.length > 0
          ? {
              outsideTheseDates: elsewhere.slice(0, ASK_SEARCH_LIMIT).map((t) => ({
                date: t.date,
                merchant: t.merchant,
                amount: money(t.amountCents),
                direction: t.amountCents > 0 ? "out" : "in",
              })),
            }
          : {}),
      });
    }

    case "spending_by_category":
    case "monthly_totals": {
      const months = monthsEnding(today, INSIGHT_MONTHS);
      const rows = await db.transactions.findMany({
        where: { date: { gte: new Date(`${months[0]}-01T00:00:00Z`) } },
        select: {
          date: true,
          amountCents: true,
          description: true,
          merchantName: true,
          pfcPrimary: true,
          pfcDetailed: true,
          pending: true,
        },
      });
      const dated = rows.map((t) => ({ ...t, date: isoDate(t.date) }));
      const insights = spendingInsights(dated, { asOf: today, monthCount: INSIGHT_MONTHS });
      // Books QA: one-off costs, so an unusual month is said as one, not as the usual.
      const oneOffs = oneOffCharges(dated, today);
      const oneOffsIn = (month: string) =>
        oneOffs
          .filter((o) => o.month === month)
          .map((o) => ({ what: o.merchant, date: o.date, amount: money(o.amountCents) }));
      const leftOutIn = (month: string) =>
        oneOffs.filter((o) => o.month === month).reduce((sum, o) => sum + o.amountCents, 0);
      if (name === "monthly_totals") {
        const full = insights.months.slice(0, -1);
        return out({
          months: insights.months.map((m) => ({
            month: m.month,
            spending: money(m.spendingCents),
            income: money(m.incomeCents),
            ...(leftOutIn(m.month) > 0
              ? {
                  unusual: true,
                  oneOffs: oneOffsIn(m.month),
                  withoutOneOffs: money(m.spendingCents - leftOutIn(m.month)),
                }
              : {}),
          })),
          typicalMonthSpending:
            full.length === 0
              ? null
              : money(
                  Math.round(
                    full.reduce((sum, m) => sum + m.spendingCents - leftOutIn(m.month), 0) /
                      full.length,
                  ),
                ),
          note:
            oneOffs.length > 0
              ? "Months marked unusual had one-off costs; a typical month leaves them out. Say so when quoting an average."
              : undefined,
        });
      }
      const month = MONTH.test(str(args.month)) ? str(args.month) : today.slice(0, 7);
      const totals = insights.months.find((m) => m.month === month);
      if (!totals)
        return out({ month, note: `Only the last ${INSIGHT_MONTHS} months are available.` });
      return out({
        month,
        spending: money(totals.spendingCents),
        income: money(totals.incomeCents),
        categories: (insights.categoriesByMonth[month] ?? []).map((c) => ({
          category: c.category,
          amount: money(c.cents),
        })),
        ...(leftOutIn(month) > 0 ? { unusual: true, oneOffs: oneOffsIn(month) } : {}),
      });
    }

    case "list_findings": {
      const findings = await db.findings.findMany({
        where: { status: { in: ["new", "shown"] } },
        select: { type: true, title: true, annualSavingsCents: true },
        orderBy: [{ annualSavingsCents: "desc" }, { id: "asc" }],
      });
      return out({
        findings: findings.map((f) => {
          if (f.annualSavingsCents !== null) money(f.annualSavingsCents);
          return {
            title: f.title,
            estimate:
              f.annualSavingsCents === null ? null : savingsPhrase(f.type, f.annualSavingsCents),
          };
        }),
      });
    }

    case "list_actions": {
      const [actions, diy] = await Promise.all([
        db.actions.findMany({
          select: { status: true, decision: { select: { cardSnapshot: true } } },
          orderBy: { createdAt: "desc" },
        }),
        db.decisions.findMany({
          where: { choice: "diy", undoneAt: null },
          select: { diyDoneAt: true, cardSnapshot: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const title = (snapshot: unknown) =>
        String((snapshot as { title?: unknown } | null)?.title ?? "A change");
      return out({
        handledByOurTeam: actions.map((a) => ({
          title: title(a.decision.cardSnapshot),
          status: ACTION_STATUS_LABELS[a.status].label,
        })),
        doingItThemselves: diy.map((d) => ({
          title: title(d.cardSnapshot),
          status: d.diyDoneAt ? "Done" : "Not done yet",
        })),
      });
    }

    case "upcoming_bills": {
      const requested = Number(args.days);
      const days =
        Number.isInteger(requested) && requested > 0
          ? Math.min(requested, ASK_MAX_UPCOMING_DAYS)
          : ASK_MAX_UPCOMING_DAYS;
      const detection = await loadDetectionInput(userId, { client, now });
      return out({
        days,
        bills: upcomingBills(detection, days).map((b) => ({
          date: b.date,
          merchant: b.merchant,
          amount: money(b.amountCents),
        })),
      });
    }

    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
