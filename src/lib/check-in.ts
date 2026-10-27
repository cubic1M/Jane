import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { checkInData, type CheckInData } from "@/insights/check-in";
import { anthropic, finishedText, llmEnabled, llmModel } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkGuardrails } from "@/lib/guardrails";
import { savedToDate } from "@/lib/membership/service";
import { formatCents } from "@/lib/money";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { monthLabel } from "@/lib/day-label";

// The monthly check-in: the month's numbers (spending, budgets, net worth, what Jane found
// and what got done) and a short summary written by Claude from those numbers only. The
// summary is checked by the guardrails, falls back to fixed wording, and is stored so
// it's written once per person and month.

type Options = {
  client?: PrismaClient;
  claude?: () => Pick<Anthropic, "messages">;
  now?: Date;
};

export type CheckIn = CheckInData & {
  netWorth: { startCents: number; endCents: number } | null;
  found: { findings: number; annualSavingsCents: number };
  savedCents: number;
};

const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};

export async function loadCheckIn(
  userId: string,
  month: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CheckIn> {
  const db = scopedFor(userId, client);
  const { from, to } = monthBounds(month);
  const end = new Date(to.getTime() - 1).toISOString().slice(0, 10);
  // Net worth at the end of the month before and of this one, as the hub and /net-worth have it.
  const before = new Date(from.getTime() - 1).toISOString().slice(0, 7);
  const [y, m] = now.toISOString().slice(0, 7).split("-").map(Number);
  const [by, bm] = before.split("-").map(Number);
  const back = Math.max(2, (y - by) * 12 + (m - bm) + 1);
  const [transactions, budgets, found, saved, history] = await Promise.all([
    loadInsightTransactions(db, end, 2),
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    db.findings.aggregate({
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { annualSavingsCents: true },
    }),
    savedToDate(userId, { client, between: { from, to } }),
    loadNetWorthHistory(userId, { client, now, months: back }),
  ]);
  const at = (month: string) => history?.months.find((x) => x.month === month)?.netCents ?? null;
  const startCents = at(before);
  const endCents = at(month);
  return {
    ...checkInData(transactions, budgets, month),
    netWorth: startCents !== null && endCents !== null ? { startCents, endCents } : null,
    found: { findings: found._count._all, annualSavingsCents: found._sum.annualSavingsCents ?? 0 },
    savedCents: saved,
  };
}

// Every figure the summary may use, as the page writes them.
function figures(c: CheckIn) {
  const diff = c.spendingCents - c.previousSpendingCents;
  const cents = [
    c.spendingCents,
    c.previousSpendingCents,
    Math.abs(diff),
    c.incomeCents,
    c.savedCents,
    c.found.annualSavingsCents,
    ...c.budgets.flatMap((b) => [b.budgetCents, b.spentCents]),
    ...(c.netWorth
      ? [
          c.netWorth.startCents,
          c.netWorth.endCents,
          Math.abs(c.netWorth.endCents - c.netWorth.startCents),
        ]
      : []),
  ];
  const facts = {
    month: monthLabel(c.month, { long: true, year: false }),
    spent: formatCents(c.spendingCents),
    spentMonthBefore: formatCents(c.previousSpendingCents),
    spendingChange: `${diff >= 0 ? "up" : "down"} ${formatCents(Math.abs(diff))}`,
    cameIn: formatCents(c.incomeCents),
    budgetsKept: c.budgets.filter((b) => b.kept).length,
    budgetsOver: c.budgets.filter((b) => !b.kept).map((b) => b.category),
    netWorthChange: c.netWorth
      ? `${c.netWorth.endCents >= c.netWorth.startCents ? "up" : "down"} ${formatCents(Math.abs(c.netWorth.endCents - c.netWorth.startCents))}`
      : null,
    waysToSaveFound: c.found.findings,
    savedFromChangesFinished: c.savedCents > 0 ? `${formatCents(c.savedCents)} a year` : null,
  };
  return { cents, facts };
}

export function templateSummary(c: CheckIn): string {
  const { facts } = figures(c);
  const parts = [
    `In ${facts.month} you spent ${facts.spent}, ${facts.spendingChange} from the month before.`,
  ];
  if (c.budgets.length > 0) {
    parts.push(
      facts.budgetsOver.length === 0
        ? "You kept every budget."
        : `You went over in ${facts.budgetsOver.join(" and ")}.`,
    );
  }
  if (facts.savedFromChangesFinished) {
    parts.push(`Changes you finished save about ${facts.savedFromChangesFinished}.`);
  }
  return parts.join(" ");
}

const SYSTEM = `You write a short, warm summary of someone's month for a personal finance app, from the facts given.

- Two or three sentences. Plain words.
- Use only the facts given, and dollar amounts exactly as written. Don't calculate anything.
- Never give investment, tax or legal advice, recommend a product, or promise anything.`;

const SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};
const MAX_SUMMARY = 600;

export async function writeSummary(
  c: CheckIn,
  { claude = anthropic }: Pick<Options, "claude"> = {},
): Promise<{ text: string; source: "llm" | "template" }> {
  const template = { text: templateSummary(c), source: "template" as const };
  if (!llmEnabled()) return template;
  const { cents, facts } = figures(c);
  try {
    const response = await claude().messages.create({
      model: llmModel(),
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    });
    const text = finishedText(response);
    const summary = text ? (JSON.parse(text) as { summary?: unknown }).summary : null;
    if (typeof summary !== "string" || !summary.trim() || summary.length > MAX_SUMMARY)
      return template;
    return checkGuardrails(summary, cents).ok ? { text: summary.trim(), source: "llm" } : template;
  } catch (error) {
    if (error instanceof Anthropic.APIError || error instanceof SyntaxError) return template;
    throw error;
  }
}

// The stored summary for this person and month, writing it the first time.
export async function summaryFor(
  userId: string,
  c: CheckIn,
  { client = defaultClient, claude = anthropic }: Options = {},
): Promise<string> {
  const db = scopedFor(userId, client);
  const existing = await db.checkIns.findFirst({
    where: { month: c.month },
    select: { summary: true },
  });
  if (existing) return existing.summary;
  const { text, source } = await writeSummary(c, { claude });
  await db.checkIns.createMany({
    data: [{ userId, month: c.month, summary: text, source }],
    skipDuplicates: true,
  });
  return text;
}
