import { FORECAST_DAYS } from "@/config/detection";
import { loadDetectionInput } from "@/detection/engine";
import { nextPayday } from "@/detection/paydays";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadTransfers } from "@/lib/balance-transfers";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadBnpl } from "@/lib/bnpl";
import { loadDebts } from "@/lib/debts";
import { dayLabel } from "@/lib/day-label";
import { loadHomeBuying } from "@/lib/home-buying";
import { loadRefinance } from "@/lib/refinance";
import { spendingInsights } from "@/insights/spending";
import { addDays } from "@/detection/units";
import {
  DECISIONS,
  type Decision,
  type DecisionId,
  type DecisionInput,
} from "@/planning/debt-decisions";

// The numbers behind the straight answers to debt and credit decisions (the chat's "should I
// pay off my card or invest?", "should I consolidate?" ...): the person's debts, cash and
// spending, and the best way found to move card debt for less (stand-in offers, demo bank
// only). Answers are in src/planning/debt-decisions.ts.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;

export async function loadDecisionInput(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<DecisionInput> {
  const db = scopedFor(userId, client);
  const [advice, book, transfers, refinance, input, report, bnplData] = await Promise.all([
    adviceMode(userId, { client }),
    loadDebts(userId, { client, now }),
    loadTransfers(userId, { client, now }),
    loadRefinance(userId, { client, now }),
    loadDetectionInput(userId, { client, now }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      select: { cardLimitCents: true },
    }),
    loadBnpl(userId, { client, now }),
  ]);
  const owingCards = book.debts.filter((d) => d.kind === "card" && (d.balanceCents ?? 0) > 0);
  const accounts = await db.accounts.findMany({
    where: { type: { in: ["depository"] } },
    select: { currentBalanceCents: true, subtype: true },
  });
  const liquidCents = accounts.reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);
  const savingsCents = accounts
    .filter((a) => a.subtype !== "checking")
    .reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);
  const days = bnplData.forecastDays;
  const lowest = days.length
    ? days.reduce((a, b) => (b.balanceCents < a.balanceCents ? b : a))
    : null;
  const firstNegative = days.find((d) => d.balanceCents < 0) ?? null;
  const label = (d: { date: string; balanceCents: number } | null) =>
    d ? { date: dayLabel(d.date), balanceCents: d.balanceCents } : null;
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const spent = input.transactions
    .filter(
      (t) =>
        t.amountCents > 0 &&
        t.date >= since.toISOString().slice(0, 10) &&
        !(t.pfcDetailed ?? "").startsWith("TRANSFER") &&
        t.pfcDetailed !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    )
    .reduce((s, t) => s + t.amountCents, 0);
  const mortgage = book.debts.find((d) => d.kind === "mortgage" && (d.balanceCents ?? 0) > 0);
  const student = book.debts.find((d) => d.kind === "student" && (d.balanceCents ?? 0) > 0);
  const toLoan = (d: (typeof book.debts)[number] | undefined) =>
    d ? { name: d.name, balanceCents: d.balanceCents ?? 0, aprBps: d.aprBps } : null;
  const cardKeys = new Set(owingCards.map((d) => d.key));
  const transfer = transfers.comparisons
    .filter((c) => cardKeys.has(c.debtKey) && c.pick && (c.pick.savingCents ?? 0) > 0)
    .sort((a, b) => (b.pick!.savingCents ?? 0) - (a.pick!.savingCents ?? 0))[0];
  const personal = refinance.comparisons
    .filter((c) => cardKeys.has(c.debtKey) && c.pick && c.pick.savingCents > 0)
    .sort((a, b) => b.pick!.savingCents - a.pick!.savingCents)[0];
  const consolidation = transfer
    ? {
        name: transfer.pick!.offer.cardName,
        kind: "transfer" as const,
        aprBps: 0,
        savesCents: transfer.pick!.savingCents ?? 0,
      }
    : personal
      ? {
          name: personal.pick!.offer.lender,
          kind: "personal" as const,
          aprBps: personal.pick!.offer.aprBps,
          savesCents: personal.pick!.savingCents,
        }
      : null;
  const payday = nextPayday(input, FORECAST_DAYS);
  // Take-home and what's left after spending, from the last three full months with income.
  const lastFull = addDays(`${now.toISOString().slice(0, 7)}-01`, -1);
  const months = spendingInsights(
    input.transactions.map((t) => ({ ...t, pending: false })),
    { asOf: lastFull, monthCount: 3 },
  ).months.filter((m) => m.incomeCents > 0);
  const avg = (f: (m: (typeof months)[number]) => number) =>
    months.length ? Math.round(months.reduce((s, m) => s + f(m), 0) / months.length) : null;
  const incomeCents = avg((m) => m.incomeCents);
  const spendingCents = avg((m) => m.spendingCents);
  const rents = input.transactions
    .filter(
      (t) =>
        t.pfcDetailed === "RENT_AND_UTILITIES_RENT" &&
        /RENT|APARTMENTS|PROPERT/i.test(t.description) &&
        !/HOME RENT/i.test(t.description) &&
        t.amountCents > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const home = await loadHomeBuying(userId, {}, { client, now, input });
  const today = now.toISOString().slice(0, 10);
  const singleLimit = owingCards.length === 1 ? (report?.cardLimitCents ?? null) : null;
  return {
    advice,
    cards: owingCards.map((d) => ({
      name: d.name,
      balanceCents: d.balanceCents ?? 0,
      aprBps: d.aprBps,
      limitCents: singleLimit,
    })),
    totalLimitCents: report?.cardLimitCents ?? null,
    mortgage: toLoan(mortgage),
    student: toLoan(student),
    liquidCents,
    monthlySpendCents: Math.round(spent / 3),
    consolidation,
    incomeCents,
    savingCents:
      incomeCents !== null && spendingCents !== null ? incomeCents - spendingCents : null,
    rentCents: rents.length ? rents[rents.length - 1].amountCents : null,
    home:
      home.costs && home.affordability
        ? {
            maxPriceCents: home.affordability.maxPriceCents,
            housingCents: home.costs.housingCents,
            cashNeededCents: home.costs.cashNeededCents,
          }
        : null,
    forecast:
      bnplData.checkingCents === null
        ? null
        : { firstNegative: label(firstNegative), lowest: label(lowest), savingsCents },
    bnpl: {
      plans: bnplData.plans.length,
      monthlyCents: bnplData.plans.reduce(
        (s, p) => s + (p.every === "month" ? p.paymentCents : p.paymentCents * 2),
        0,
      ),
    },
    nextPayday: payday
      ? {
          date: dayLabel(payday.date),
          days: Math.max(
            0,
            Math.round((Date.parse(payday.date) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS),
          ),
        }
      : null,
  };
}

export async function decide(
  userId: string,
  id: DecisionId,
  options: Options = {},
): Promise<Decision> {
  return DECISIONS[id](await loadDecisionInput(userId, options));
}
