import type Anthropic from "@anthropic-ai/sdk";
import { ASK_DEFAULT_SEARCH_DAYS, ASK_MAX_UPCOMING_DAYS, ASK_SEARCH_LIMIT } from "@/config/ask";
import { INSIGHT_MONTHS } from "@/config/insights";
import { CARD_PAYMENT_NAME, NON_SPENDING_PRIMARIES } from "@/config/detection";
import { normalizeMerchant } from "@/data-sources/merchant";
import { loadCounting, onlyCounted } from "@/lib/account-copies";
import { nameMatcher, type NameMatch } from "./name-match";
import { loadDetectionInput, loadTransactionsBetween } from "@/detection/input";
import { comingUpBills } from "@/detection/forecast";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { categoryLabel } from "@/insights/labels";
import { primaryOf, SUBCATEGORIES, subcategorySpending } from "@/insights/subcategories";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { oneOffCharges, typicalMonthlySpending } from "@/insights/typical-month";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import { db as defaultClient } from "@/lib/db";
import { todayOf } from "@/lib/today";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import type { OfferedOptions } from "@/lib/option-card";
import { savingsPhrase } from "@/lib/savings-text";
import { endedOn } from "@/lib/data-ended";

// The tools Claude can use to answer questions about the person's money. Every tool reads
// through scopedFor(userId), so it can only ever see the signed-in person's rows, and none
// can change anything. Results hold cleaned-up merchant names, categories, dates and
// amounts: never raw bank descriptions, account names or numbers. Every dollar figure a
// tool returns is recorded, so the guardrails can tell real figures from invented ones.

export const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_transactions",
    description:
      "Look anything up in the person's transactions across ALL the history Jane has (a name or amount with no dates searches all of it; otherwise the last 90 days). Filter by merchant (any way a bank writes it: 'california arts' also finds 'CA ARTS SUPPLY'; near matches come back as similarName: say 'a similar name'), category, dates, amount range, account, direction (out: spending; in: refunds, pay, deposits). Returns matched, firstDate, lastDate, totals, up to 20 rows (newest first, or largest with sort 'largest'), andMore when cut, dataStarts/dataEnds, and a note when nothing matches. When a merchant has none in those dates, outsideTheseDates lists its charges at other times: say those, never that there are none. Transfers show as Transfer, or Transfer to savings for money moved into savings.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Part of a name, e.g. 'netflix'." },
        category: {
          type: "string",
          description: "A category name as spending_by_category returns it, e.g. 'Food and drink'.",
        },
        from: { type: "string", description: "First date, YYYY-MM-DD." },
        to: { type: "string", description: "Last date, YYYY-MM-DD. Default: today." },
        min_amount: { type: "number", description: "At least this many dollars (either way)." },
        max_amount: { type: "number", description: "At most this many dollars (either way)." },
        account: { type: "string", description: "Part of an account's name or last four digits." },
        direction: { type: "string", enum: ["out", "in"] },
        sort: { type: "string", enum: ["newest", "largest"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "account_balances",
    description:
      "Each linked account's latest balance (what is owed, for a card or loan), by name and last four digits. Use for 'what's my balance in X'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "spending_by_category",
    description:
      "Spending and income for one month, with spending by category, largest first, and the parts people ask about by name (groceries, eating out, coffee, gas, rent, utilities) where the data says which part each charge is: groceries are part of Food and drink, not all of it. Money moved between the person's own accounts and card payments aren't counted.",
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

// The chat's tools: one that takes no input, and a run's answer as JSON with money() for each
// amount it names. Every amount goes in `cents`, which the guardrail checks the reply's figures
// against.
export const noInput = { type: "object" as const, properties: {}, additionalProperties: false };
export function toolAnswer() {
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  return { cents, money, out };
}

type Options = { client?: PrismaClient; now?: Date };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// The name a tool gives a transaction: a cleaned merchant name (no ids, no account numbers), and a
// transfer only as Transfer, since transfers name people. Also explain_figure's rows.
export function displayMerchant(t: {
  merchantName: string | null;
  description: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  amountCents: number;
}): string {
  // Transfers name people ("Zelle to ..."), so they're never shown by name. One out to savings
  // says so, as the bank files it or as its line says ("ONLINE TRANSFER TO ALLY BANK SAVINGS"):
  // walk batch 3's upload S6 asked how much goes into savings and was told none, beside $200 a
  // month of these shown only as "Transfer". The same test as the backup's (replies-money-moves.ts).
  if (t.pfcPrimary && (NON_SPENDING_PRIMARIES as readonly string[]).includes(t.pfcPrimary)) {
    const toSavings =
      t.amountCents > 0 &&
      (t.pfcDetailed === "TRANSFER_OUT_SAVINGS" ||
        (/\btransfer\b/i.test(t.description) && /\bsavings\b/i.test(t.description)));
    return toSavings ? "Transfer to savings" : "Transfer";
  }
  if (t.pfcPrimary === "INCOME") return "Income";
  return t.merchantName ?? normalizeMerchant(t.description)?.name ?? "Unknown merchant";
}

// Before any date Jane could hold: "all the history".
const ALL_TIME = "1900-01-01";

// The bank's line, for the person's eyes: long digit runs (card and reference numbers) cut.
const bankText = (line: string) =>
  line
    .replace(/\d{4,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

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
  // The person's day, as the chat's (night round 11-06: at 7pm in Los Angeles every tool here
  // read UTC's tomorrow, so "this month" turned over at 4pm on the last of the month).
  const today = await todayOf(userId, { client, now });
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });

  switch (name) {
    case "search_transactions": {
      const to = DATE.test(str(args.to)) ? str(args.to) : today;
      const merchant = str(args.merchant);
      const category = str(args.category).toLowerCase();
      const accountAsked = str(args.account).toLowerCase();
      const direction = args.direction === "out" || args.direction === "in" ? args.direction : null;
      const dollars = (v: unknown): number | null => {
        if (v === undefined || v === null || v === "") return null;
        const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
        return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
      };
      const minCents = dollars(args.min_amount);
      const maxCents = dollars(args.max_amount);
      // A name or an amount is looked for in all the history, not the last three months: "did I
      // ever buy from X" is about every year Jane has.
      const wholeHistory = merchant !== "" || minCents !== null || maxCents !== null;
      const from = DATE.test(str(args.from))
        ? str(args.from)
        : wholeHistory
          ? ALL_TIME
          : addDays(to, -ASK_DEFAULT_SEARCH_DAYS);
      const accounts = await db.accounts.findMany({ select: { id: true, name: true, mask: true } });
      const accountOf = new Map(
        accounts.map((a) => [a.id, a.mask ? `${a.name} ····${a.mask}` : a.name]),
      );
      // A name that fits an account Jane counts under another (the same account linked twice)
      // asks for the one counted, which is where its rows are read from.
      const counting = await loadCounting(db);
      const accountIds = new Set(
        accounts
          .filter(
            (a) =>
              !accountAsked || `${a.name} ${a.mask ?? ""}`.toLowerCase().includes(accountAsked),
          )
          .map((a) => counting.representativeOf(a.id)),
      );
      const nameMatch = nameMatcher(merchant);
      // Read as detection reads them (names from the merchant directory, an account linked twice
      // once), so what a card or page names is what this finds.
      const matching = async (from: string, to: string) =>
        (await loadTransactionsBetween(userId, { client, from, to }))
          .filter((t) => accountIds.has(t.accountId))
          .map((t) => {
            const shown = displayMerchant(t);
            // The bank's own words match too ("APPLE STORE R102" for "Apple Store"), and are shown
            // (digits cut) only for what isn't a transfer. Transfers match on them as well ("how
            // much does my mom send me?" finds "MOM VENMO CASHOUT", desktop sweep 5's upload S1)
            // while still shown only as Transfer.
            const kind: NameMatch = !merchant
              ? "exact"
              : t.pfcDetailed === CARD_PAYMENT_DETAILED &&
                  cardPaymentAsked(merchant.toLowerCase(), t.description.toLowerCase())
                ? "exact"
                : nameMatch([shown, t.merchantName ?? "", t.description]);
            const moved =
              !!t.pfcPrimary &&
              (NON_SPENDING_PRIMARIES as readonly string[]).includes(t.pfcPrimary);
            return {
              date: t.date,
              merchant: shown,
              bankText: moved ? null : bankText(t.description),
              kind,
              category: categoryLabel(t.pfcPrimary),
              amountCents: t.amountCents,
              account: accountOf.get(t.accountId) ?? "",
            };
          })
          .filter((t) => t.kind !== null)
          .filter((t) => !category || t.category.toLowerCase() === category)
          .filter((t) => minCents === null || Math.abs(t.amountCents) >= minCents)
          .filter((t) => maxCents === null || Math.abs(t.amountCents) <= maxCents)
          .filter(
            (t) => !direction || (direction === "out" ? t.amountCents > 0 : t.amountCents < 0),
          );
      const found = await matching(from, to);
      const matches = found.filter((t) => t.kind === "exact");
      const similar = found.filter((t) => t.kind === "similar");
      const order = (rows: typeof found) =>
        args.sort === "largest"
          ? [...rows].sort((x, y) => Math.abs(y.amountCents) - Math.abs(x.amountCents))
          : rows;
      // None in these dates: the merchant's charges from before (or after) them, so a card built
      // from a charge last December is never answered with "no charges" (founder's live
      // /deadlines, 10-29: the chat looked from Aug 1 for a December charge).
      const elsewhere =
        merchant && matches.length === 0 && (from !== ALL_TIME || to !== today)
          ? (await matching(ALL_TIME, today)).filter(
              (t) => t.kind === "exact" && (t.date < from || t.date > to),
            )
          : [];
      const [first, last] = await Promise.all(
        (["asc", "desc"] as const).map((dir) =>
          db.transactions.findMany({
            where: { pending: false },
            orderBy: { date: dir },
            take: 1,
            select: { date: true },
          }),
        ),
      );
      const dataStarts = first[0]?.date.toISOString().slice(0, 10) ?? null;
      const dataEnds = last[0]?.date.toISOString().slice(0, 10) ?? null;
      const outOf = (rows: typeof found) =>
        rows.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
      const inOf = (rows: typeof found) =>
        rows.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0);
      const row = (t: (typeof found)[number]) => ({
        date: t.date,
        merchant: t.merchant,
        ...(t.bankText ? { bankText: t.bankText } : {}),
        category: t.category,
        amount: money(t.amountCents),
        direction: t.amountCents > 0 ? "out" : "in",
        // Not "account": the answer guardrail reads that key as who a figure belongs to, and a
        // purchase is not the checking account's.
        inAccount: t.account,
      });
      const shownRows = order(matches).slice(0, ASK_SEARCH_LIMIT);
      const dates = matches.map((t) => t.date).sort();
      return out({
        from: from === ALL_TIME ? (dataStarts ?? to) : from,
        to,
        dataStarts,
        dataEnds,
        matched: matches.length,
        ...(matches.length > 0 ? { firstDate: dates[0], lastDate: dates[dates.length - 1] } : {}),
        totalMoneyOut: money(outOf(matches)),
        totalMoneyIn: money(inOf(matches)),
        transactions: shownRows.map(row),
        ...(matches.length > shownRows.length
          ? { andMore: matches.length - shownRows.length }
          : {}),
        ...(similar.length > 0
          ? {
              // Written differently from what was asked: say "a similar name", never as certain.
              similarName: {
                matched: similar.length,
                totalMoneyOut: money(outOf(similar)),
                totalMoneyIn: money(inOf(similar)),
                transactions: order(similar).slice(0, ASK_SEARCH_LIMIT).map(row),
                ...(similar.length > ASK_SEARCH_LIMIT
                  ? { andMore: similar.length - ASK_SEARCH_LIMIT }
                  : {}),
              },
            }
          : {}),
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
        ...(matches.length === 0 && similar.length === 0 && elsewhere.length === 0
          ? {
              note: dataStarts
                ? `Nothing matches in the data Jane has, which runs from ${dataStarts} to ${dataEnds}. Say so plainly, with those dates: it can't see before or after them, or an account that isn't linked. Don't guess.`
                : "No transactions are on file at all, so nothing can be looked up yet.",
            }
          : {}),
      });
    }

    case "account_balances": {
      const rows = await db.accounts.findMany({
        where: await onlyCounted(db),
        select: { name: true, mask: true, type: true, subtype: true, currentBalanceCents: true },
        orderBy: { name: "asc" },
      });
      return out({
        accounts: rows.map((a) => {
          // Signed as the bank gives it (an overdraft is negative); the figure allowed is its size.
          const cents =
            a.currentBalanceCents === null
              ? null
              : (money(a.currentBalanceCents), formatCents(a.currentBalanceCents));
          return {
            account: a.mask ? `${a.name} ····${a.mask}` : a.name,
            type: a.subtype ?? a.type,
            // A card or loan's balance is what is owed on it.
            ...(a.type === "credit" || a.type === "loan" ? { owed: cents } : { balance: cents }),
          };
        }),
        note:
          rows.length === 0
            ? "No accounts are linked."
            : "Balances are the latest Jane read; a null one wasn't given by the bank or file.",
      });
    }

    case "spending_by_category":
    case "monthly_totals": {
      // The rows the Money page and Insights read: an account linked twice counted once (gate B:
      // these read every row, so a bank linked again doubled the chat's spending and income).
      const dated = await loadInsightTransactions(db, today, INSIGHT_MONTHS);
      const insights = spendingInsights(dated, { asOf: today, monthCount: INSIGHT_MONTHS });
      // Books QA: one-off costs, so an unusual month is said as one, not as the usual.
      const oneOffs = oneOffCharges(dated, today);
      const oneOffsIn = (month: string) =>
        oneOffs
          .filter((o) => o.month === month)
          .map((o) => ({ what: o.merchant, date: o.date, amount: money(o.amountCents) }));
      const leftOutIn = (month: string) =>
        oneOffs.filter((o) => o.month === month).reduce((sum, o) => sum + o.amountCents, 0);
      // Months before the first transaction aren't months of $0: nothing was seen then.
      const historyStarts = dated.reduce<string | null>(
        (first, t) => (first === null || t.date < first ? t.date : first),
        null,
      );
      const incomeSeen = insights.months.some((m) => m.incomeCents > 0);
      // Nor are months after the file ends: someone who uploaded and came back.
      const historyEnds = dated.reduce<string | null>(
        (last, t) => (last === null || t.date > last ? t.date : last),
        null,
      );
      // A month after the last one with anything in it isn't $0 either, however recent that was:
      // October's statement asked about on Nov 3 (gate E, 11-16).
      const ended =
        endedOn(historyEnds, today) ??
        (historyEnds !== null && historyEnds.slice(0, 7) < today.slice(0, 7) ? historyEnds : null);
      const seen = (month: string) =>
        historyStarts !== null &&
        month >= historyStarts.slice(0, 7) &&
        (ended === null || month <= ended.slice(0, 7));
      if (name === "monthly_totals") {
        const typical = typicalMonthlySpending(dated, today, INSIGHT_MONTHS);
        return out({
          historyStarts,
          ...(ended ? { historyEnds: ended } : {}),
          months: insights.months
            .filter((m) => seen(m.month))
            .map((m) => ({
              month: m.month,
              spending: money(m.spendingCents),
              // Null when none has been seen at all: a card statement shows spending only.
              income: incomeSeen ? money(m.incomeCents) : null,
              ...(leftOutIn(m.month) > 0
                ? {
                    unusual: true,
                    oneOffs: oneOffsIn(m.month),
                    withoutOneOffs: money(m.spendingCents - leftOutIn(m.month)),
                  }
                : {}),
            })),
          // Full months only, none before the history starts: 2 months on file aren't 12 thin ones.
          typicalMonthSpending: typical > 0 ? money(typical) : null,
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
      if (!seen(month)) {
        return out({
          month,
          note: !historyStarts
            ? "No transactions are on file, so spending isn't known. It isn't $0."
            : ended && month > ended.slice(0, 7)
              ? `Nothing was seen for that month, so its spending isn't known: their transactions end ${ended}. It isn't $0.`
              : `Nothing was seen for that month, so its spending isn't known: their transactions start ${historyStarts}. It isn't $0.`,
        });
      }
      return out({
        month,
        spending: money(totals.spendingCents),
        income: incomeSeen ? money(totals.incomeCents) : null,
        categories: (insights.categoriesByMonth[month] ?? []).map((c) => {
          // The parts people ask about by name ("groceries" isn't all of Food and drink).
          const parts = SUBCATEGORIES.filter((sub) => categoryLabel(primaryOf(sub)) === c.category)
            .map((sub) => ({ part: sub.name, cents: subcategorySpending(dated, month, sub) }))
            .filter((p): p is { part: string; cents: number } => p.cents !== null && p.cents > 0)
            .map((p) => ({ part: p.part, amount: money(p.cents) }));
          return {
            category: c.category,
            amount: money(c.cents),
            ...(parts.length > 0 ? { parts } : {}),
          };
        }),
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
        bills: comingUpBills(detection, days).map((b) => ({
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
