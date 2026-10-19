import { CREDIT_CHECK_DAYS, CREDIT_PARTNER, UTILISATION_HIGH } from "@/config/debt";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { demoCredit } from "@/lib/credit/demo";
import type { CreditFactor, CreditPartner, CreditRequest } from "@/lib/credit/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr, loadDebts } from "@/lib/debts";
import type { DebtBook } from "@/insights/debts";
import { formatCents } from "@/lib/money";
import { creditBandOf, creditFactors, utilisation, type Utilisation } from "@/planning/credit";

// The credit score (spec step 116). Once a month Jane asks the credit partner for the
// person's score with a soft pull (it never affects the score), and explains what's
// helping and hurting, with card utilisation from their card balances, and what she's doing
// about it. Only the stand-in exists, so only demo-bank people get a score, always labelled;
// nothing is pulled for a real account.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export async function creditPartnerFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ key: string; partner: CreditPartner } | null> {
  if (CREDIT_PARTNER !== "demo") return null;
  return (await adviceMode(userId, { client })) ? { key: "demo", partner: demoCredit } : null;
}

// What Jane sees that the score depends on.
async function requestFor(userId: string, client: PrismaClient, now: Date): Promise<CreditRequest> {
  const [book, lateFees] = await Promise.all([
    loadDebts(userId, { client, now }),
    scopedFor(userId, client).transactions.count({
      where: {
        date: { gte: new Date(now.getTime() - 365 * DAY_MS) },
        amountCents: { gt: 0 },
        pfcDetailed: "BANK_FEES_LATE_FEES",
      },
    }),
  ]);
  return {
    // Bank-reported cards only: a 0% card a balance moved to is counted once it's linked.
    cardBalanceCents: book.debts
      .filter((d) => d.kind === "card" && d.inNetWorth)
      .reduce((sum, d) => sum + (d.balanceCents ?? 0), 0),
    overdue: book.debts.some((d) => d.overdue),
    lateFeesLastYear: lateFees,
    hasInstallmentLoan: book.debts.some((d) =>
      ["student", "auto", "mortgage", "loan"].includes(d.kind),
    ),
    month: isoDay(now).slice(0, 7),
  };
}

// A soft pull now. Null without a partner (a real account): nothing is pulled.
export async function pullCredit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const found = await creditPartnerFor(userId, { client });
  if (!found) return null;
  const request = await requestFor(userId, client, now);
  const report = await found.partner.softPull(request);
  const row = await scopedFor(userId, client).creditReports.create({
    data: {
      userId,
      partner: found.key,
      score: report.score,
      model: report.model,
      rangeLow: report.range.low,
      rangeHigh: report.range.high,
      cardLimitCents: report.cardLimitCents,
      averageAgeMonths: report.averageAgeMonths,
      hardInquiries: report.hardInquiries,
      inputs: request as unknown as Prisma.InputJsonObject,
      demo: report.demo,
      pulledOn: new Date(`${isoDay(now)}T00:00:00Z`),
    },
    select: { id: true, score: true },
  });
  await track(userId, "credit_score_pulled", { demo: report.demo });
  return row;
}

// Jane's monthly pull, before she looks at the person's money (src/lib/debt-refresh.ts).
export async function refreshCredit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const latest = await scopedFor(userId, client).creditReports.findFirst({
    select: { pulledOn: true },
    orderBy: { pulledOn: "desc" },
  });
  if (latest && now.getTime() - latest.pulledOn.getTime() < CREDIT_CHECK_DAYS * DAY_MS) {
    return false;
  }
  return (await pullCredit(userId, { client, now })) !== null;
}

export type Credit = {
  available: boolean;
  latest: {
    score: number;
    model: string;
    range: { low: number; high: number };
    pulledOn: string;
    demo: boolean;
    factors: CreditFactor[];
    utilisation: Utilisation | null;
    // What Jane is doing about it, in plain lines.
    doing: string[];
  } | null;
  // The score at the pull before, to show the move.
  previousScore: number | null;
};

export async function loadCredit(
  userId: string,
  { client = defaultClient, now = new Date(), book: given }: Options & { book?: DebtBook } = {},
): Promise<Credit> {
  const found = await creditPartnerFor(userId, { client });
  if (!found) return { available: false, latest: null, previousScore: null };
  const [rows, book] = await Promise.all([
    scopedFor(userId, client).creditReports.findMany({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      take: 2,
    }),
    debtsOr(given, userId, { client, now }),
  ]);
  const [latest, previous] = rows;
  if (!latest) return { available: true, latest: null, previousScore: null };
  const request = latest.inputs as unknown as CreditRequest;
  const report = {
    score: latest.score,
    model: latest.model,
    range: { low: latest.rangeLow, high: latest.rangeHigh },
    cardLimitCents: latest.cardLimitCents,
    averageAgeMonths: latest.averageAgeMonths,
    hardInquiries: latest.hardInquiries,
    demo: latest.demo,
  };
  const u = utilisation(request.cardBalanceCents, latest.cardLimitCents);
  const card = book.debts.find(
    (d) => d.kind === "card" && d.inNetWorth && (d.balanceCents ?? 0) > 0,
  );
  const doing: string[] = [];
  if (u && u.share > UTILISATION_HIGH && card) {
    doing.push(
      `Paying ${formatCents(u.toUnderHighCents)} on your ${card.name}${card.nextDue ? ` before it's due on ${card.nextDue}` : ""} brings card use under ${Math.round(UTILISATION_HIGH * 100)}%. I'll remind you before the due date.`,
    );
  }
  if (card)
    doing.push(
      "Your payoff plan puts the highest-rate card first, which brings card use down fastest.",
    );
  if (request.overdue)
    doing.push(
      "Getting the overdue loan current comes first: I'll keep it at the top of your plan.",
    );
  doing.push("I check the score once a month with a soft pull, which never affects it.");
  return {
    available: true,
    latest: {
      score: report.score,
      model: report.model,
      range: report.range,
      pulledOn: isoDay(latest.pulledOn),
      demo: report.demo,
      factors: creditFactors(report, request),
      utilisation: u,
      doing,
    },
    previousScore: previous?.score ?? null,
  };
}

// The band the lender stand-ins price by, from the latest score; "good" until there is one.
export async function creditBandFor(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<"excellent" | "good" | "fair"> {
  const latest = await scopedFor(userId, client).creditReports.findFirst({
    select: { score: true },
    orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
  });
  return latest ? creditBandOf(latest.score) : "good";
}
