import {
  BUFFER_DEFAULT_CENTS,
  BUFFER_MONTHS,
  COSTLY_LOOKBACK_DAYS,
  COSTLY_MIN_YEARLY_CENTS,
  EMPLOYER_ADVANCE,
  PAL,
  STOP_CYCLE_STEPS,
} from "@/config/costly-borrowing";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loanCost, summarize, type Costly } from "@/planning/costly-borrowing";
import { DAY_MS } from "@/lib/dates";

// Out of costly short-term borrowing (spec step 247), for one person: payday loans, card cash
// advances, repeated overdrafts and pay advance apps found in the last year of payments, what
// they cost in dollars and as a yearly rate, and the cheaper ways out. The kinds found and
// what they cost are facts from the payments; the way out is demo advice.

type Options = { client?: PrismaClient; now?: Date };

export type CostlyBorrowing = Costly & {
  // Something found that costs enough to bring up.
  any: boolean;
  advice: boolean;
  // The usual size of what was borrowed, and what the same borrowing would cost as a PAL.
  typicalCents: number;
  alternatives: {
    pal: {
      label: string;
      amountCents: number;
      termMonths: number;
      aprBps: number;
      paymentCents: number;
      totalCostCents: number;
      feeCents: number;
      // The typical payday loan's fee for two weeks, to set beside it.
      paydayFeeCents: number;
    };
    employer: string;
    buffer: { targetCents: number; months: number; monthlyCents: number };
  };
  steps: readonly string[];
  // The cost in the last 30 days, so a return of costly borrowing after a clean spell shows.
  lastMonthCents: number;
};

export async function loadCostlyBorrowing(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CostlyBorrowing> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - COSTLY_LOOKBACK_DAYS * DAY_MS);
  const [rows, accounts, advice] = await Promise.all([
    db.transactions.findMany({
      where: { date: { gte: since }, pending: false },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        pfcDetailed: true,
        accountId: true,
      },
      orderBy: { date: "asc" },
    }),
    db.accounts.findMany({ where: { type: "credit" }, select: { id: true } }),
    adviceMode(userId, { client }),
  ]);
  const cards = new Set(accounts.map((a) => a.id));
  const txs = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    amountCents: r.amountCents,
    description: r.description,
    pfcDetailed: r.pfcDetailed,
    card: cards.has(r.accountId),
  }));
  const costly = summarize(txs, asOf);
  const principals = costly.loans.map((l) => l.principalCents).sort((a, b) => a - b);
  const typicalCents = principals.length
    ? principals[Math.floor(principals.length / 2)]
    : BUFFER_DEFAULT_CENTS;
  const palAmount = Math.min(PAL.maxCents, Math.max(PAL.minCents, typicalCents));
  const pal = loanCost(palAmount, PAL.aprBpsMax, PAL.termMonths, PAL.applicationFeeCentsMax);
  const paydayFee = costly.loans.find((l) => l.kind === "payday");
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const recent = summarize(
    txs.filter((t) => t.date >= cutoff),
    asOf,
  );
  return {
    ...costly,
    any: costly.totalYearlyCents >= COSTLY_MIN_YEARLY_CENTS,
    advice,
    typicalCents,
    alternatives: {
      pal: {
        label: PAL.label,
        amountCents: palAmount,
        termMonths: PAL.termMonths,
        aprBps: PAL.aprBpsMax,
        paymentCents: pal.paymentCents,
        totalCostCents: pal.interestCents,
        feeCents: PAL.applicationFeeCentsMax,
        paydayFeeCents: paydayFee
          ? Math.round((paydayFee.feeCents / paydayFee.principalCents) * palAmount)
          : Math.round(palAmount * 0.15),
      },
      employer: EMPLOYER_ADVANCE.note,
      buffer: {
        targetCents: Math.max(typicalCents, BUFFER_DEFAULT_CENTS),
        months: BUFFER_MONTHS,
        monthlyCents: Math.ceil(Math.max(typicalCents, BUFFER_DEFAULT_CENTS) / BUFFER_MONTHS),
      },
    },
    steps: STOP_CYCLE_STEPS,
    lastMonthCents: recent.totalYearlyCents,
  };
}
