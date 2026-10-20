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
import { loadRefinance, type Refinance } from "@/lib/refinance";
import { compareMortgageMoney, type MortgageMoney } from "@/planning/mortgage-money";
import { remainingMonths } from "@/planning/refinance";

// Recast, refinance or pay extra (spec step 246), for one person's mortgage: a lump sum or extra
// monthly money used three ways (extra principal, a recast, a refinance) and invested instead,
// each with its fees and the date they pay back. The refinance is the best mortgage offer the
// lender stand-in gave (step 111). Demo advice only.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; refinance?: Refinance };

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
  { client = defaultClient, now = new Date(), book: given, refinance: givenRefi }: Options = {},
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
  const refinance = givenRefi ?? (await loadRefinance(userId, { client, now, book }));
  const offers = refinance.comparisons.find((c) => c.debtKey === loan.key)?.offers ?? [];
  const best = [...offers].sort((a, b) => a.offer.aprBps - b.offer.aprBps)[0];
  return {
    ...base,
    result: compareMortgageMoney({
      balanceCents: loan.balanceCents!,
      aprBps: loan.aprBps,
      monthsLeft,
      lumpCents,
      extraMonthlyCents,
      today: asOf,
      refi: best
        ? { lender: best.offer.lender, aprBps: best.offer.aprBps, feeCents: best.offer.feeCents }
        : null,
    }),
  };
}
