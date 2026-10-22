import {
  MORTGAGE_EXTRA_MONTHLY_MAX_CENTS,
  MORTGAGE_EXTRA_MONTHLY_MIN_CENTS,
  MORTGAGE_MONEY_MAX_CENTS,
  MORTGAGE_MONEY_MIN_CENTS,
} from "@/config/mortgage-money";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { debtsOr } from "@/lib/debts";
import { formatCents } from "@/lib/money";
import { loadFit, type FitView } from "@/lib/fit";
import { compareMortgageMoney, type MortgageMoney } from "@/planning/mortgage-money";
import { remainingMonths } from "@/planning/refinance";

// Recast, refinance or pay extra (spec step 246), for one person's mortgage: a lump sum or extra
// monthly money used three ways (extra principal, a recast, a refinance) and invested instead,
// each with its fees and the date they pay back. The refinance is the fit engine's best loan for
// this mortgage (step 281, src/lib/fit.ts), so the chat, the loan options card and this page
// name the same lender and rate. Demo advice only.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; fit?: FitView };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export class MortgageMoneyError extends Error {}

export type MortgageMoneyView = {
  // A mortgage with a balance, a rate and a date it ends.
  available: boolean;
  advice: boolean;
  loanName: string | null;
  balanceCents: number;
  aprBps: number | null;
  lumpCents: number;
  extraMonthlyCents: number;
  // Null until an amount is given, or outside demo advice mode.
  result: MortgageMoney | null;
};

export async function loadMortgageMoney(
  userId: string,
  input: { lumpCents?: number; extraMonthlyCents?: number } = {},
  { client = defaultClient, now = new Date(), book: given, fit: givenFit }: Options = {},
): Promise<MortgageMoneyView> {
  const lumpCents = input.lumpCents ?? 0;
  const extraMonthlyCents = input.extraMonthlyCents ?? 0;
  for (const [n, min, max, what] of [
    [lumpCents, MORTGAGE_MONEY_MIN_CENTS, MORTGAGE_MONEY_MAX_CENTS, "The lump sum"],
    [
      extraMonthlyCents,
      MORTGAGE_EXTRA_MONTHLY_MIN_CENTS,
      MORTGAGE_EXTRA_MONTHLY_MAX_CENTS,
      "The extra a month",
    ],
  ] as const) {
    if (!Number.isInteger(n) || n < 0 || n > max) {
      throw new MortgageMoneyError(`${what} should be a dollar amount up to ${formatCents(max)}.`);
    }
    if (n > 0 && n < min) {
      throw new MortgageMoneyError(`${what} should be at least ${formatCents(min)}.`);
    }
  }
  const book = await debtsOr(given, userId, { client, now });
  const loan = [...book.debts]
    .filter((d) => d.kind === "mortgage" && (d.balanceCents ?? 0) > 0)
    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0];
  const asOf = isoDay(now);
  const monthsLeft = loan ? remainingMonths(loan, asOf) : null;
  const advice = await adviceMode(userId, { client });
  const empty = {
    available: false,
    advice,
    loanName: null,
    balanceCents: 0,
    aprBps: null,
    lumpCents,
    extraMonthlyCents,
    result: null,
  };
  if (!loan || loan.aprBps === null || monthsLeft === null) return empty;
  const base = {
    ...empty,
    available: true,
    loanName: loan.name,
    balanceCents: loan.balanceCents!,
    aprBps: loan.aprBps,
  };
  if (!advice || (lumpCents === 0 && extraMonthlyCents === 0)) return base;
  if (lumpCents >= loan.balanceCents!) {
    throw new MortgageMoneyError("That's more than the loan: it would pay it off.");
  }
  const view =
    givenFit ?? (await loadFit(userId, { need: "refinance", debtKey: loan.key }, { client, now }));
  const best = view.options.find((o) => o.id === view.terms?.bestId);
  return {
    ...base,
    result: compareMortgageMoney({
      balanceCents: loan.balanceCents!,
      aprBps: loan.aprBps,
      monthsLeft,
      lumpCents,
      extraMonthlyCents,
      today: asOf,
      refi: best ? { lender: best.lender, aprBps: best.aprBps, feeCents: best.feeCents } : null,
    }),
  };
}
