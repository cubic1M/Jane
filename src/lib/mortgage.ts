import type { PrismaClient } from "@/generated/prisma/client";
import { loanPaymentCents, type Debt, type DebtBook } from "@/insights/debts";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { loadRefinance, type Refinance } from "@/lib/refinance";
import {
  breakEvenMonths,
  escrowChange,
  extraPrincipal,
  type EscrowChange,
  type ExtraScenario,
} from "@/planning/mortgage";
import { pmiTimeline, type PmiTimeline } from "@/planning/home-equity";

// The mortgage, watched (spec step 115), for one person: the loan from the bank (with its
// PMI and escrow as Plaid reports them), the home's value they gave (spec step 67), PMI by
// one rule (the home's value when the loan began, as /loans/equity has it),
// extra principal, escrow changes from their payments, and the refinance break-even from
// Jane's monthly rate check (spec step 111).

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
// Payments looked at to spot an escrow change.
const PAYMENTS_LOOKED_AT_DAYS = 200;

export type Mortgage = {
  loan: Debt;
  hasPmi: boolean | null;
  escrowBalanceCents: number | null;
  hasPrepaymentPenalty: boolean | null;
  home: { name: string; valueCents: number; valuedOn: string } | null;
  // PMI by one rule everywhere (loans QA), the Homeowners Protection Act's as the CFPB
  // explains it: the loan against the home's value when it began, which the person tells
  // Jane (step 228's facts), not today's value. Null without PMI or without that value.
  pmi: PmiTimeline | null;
  extra: { baseMonths: number; baseInterestCents: number; scenarios: ExtraScenario[] } | null;
  escrow: EscrowChange | null;
  // The best refinance offer, if Jane checked: what it would save a month, its closing
  // costs and the months to pay them back (null: it never pays back).
  refi: {
    lender: string;
    aprBps: number;
    monthlySavingCents: number;
    closingCostsCents: number;
    breakEvenMonths: number | null;
    totalSavingCents: number;
  } | null;
};

export async function loadMortgage(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    book: given,
    refinance: givenRefinance,
  }: Options & { book?: DebtBook; refinance?: Refinance } = {},
): Promise<Mortgage | null> {
  const book = await debtsOr(given, userId, { client, now });
  const loan = [...book.debts]
    .filter((d) => d.kind === "mortgage" && d.accountId && (d.balanceCents ?? 0) > 0)
    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0];
  if (!loan) return null;
  const db = scopedFor(userId, client);
  const [liability, home, payments, refinance, facts] = await Promise.all([
    db.liabilities.findFirst({
      where: { accountId: loan.accountId! },
      select: { hasPmi: true, escrowBalanceCents: true, hasPrepaymentPenalty: true },
    }),
    db.ownedAssets.findFirst({
      where: { loanAccountId: loan.accountId!, kind: "home" },
      select: { name: true, valueCents: true, valuedOn: true },
      orderBy: { valuedOn: "desc" },
    }),
    db.transactions.findMany({
      where: {
        date: { gte: new Date(now.getTime() - PAYMENTS_LOOKED_AT_DAYS * DAY_MS) },
        amountCents: { gt: 0 },
        pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
      },
      select: { date: true, amountCents: true },
    }),
    givenRefinance ? Promise.resolve(givenRefinance) : loadRefinance(userId, { client, now, book }),
    db.homeEquityFacts.findFirst({ select: { originalValueCents: true } }),
  ]);
  const balanceCents = loan.balanceCents!;
  const pmi =
    liability?.hasPmi && facts?.originalValueCents
      ? pmiTimeline({
          originalValueCents: facts.originalValueCents,
          balanceCents,
          aprBps: loan.aprBps,
          paymentPiCents: loan.principalAndInterestCents ?? null,
          today: now.toISOString().slice(0, 10),
        })
      : null;
  const comparison = refinance.comparisons.find((c) => c.debtKey === loan.key);
  const best = comparison?.offers[0];
  const monthlySavingCents = best ? comparison!.currentMonthlyCents - best.monthlyCents : 0;
  return {
    loan,
    hasPmi: liability?.hasPmi ?? null,
    escrowBalanceCents: liability?.escrowBalanceCents ?? null,
    hasPrepaymentPenalty: liability?.hasPrepaymentPenalty ?? null,
    home: home
      ? {
          name: home.name,
          valueCents: home.valueCents,
          valuedOn: home.valuedOn.toISOString().slice(0, 10),
        }
      : null,
    pmi,
    extra:
      loan.aprBps !== null && loanPaymentCents(loan) !== null
        ? extraPrincipal(balanceCents, loan.aprBps, loanPaymentCents(loan)!)
        : null,
    // An escrow change only reads as one on a fixed rate (a variable rate moves the payment).
    escrow:
      loan.rateType === "variable"
        ? null
        : escrowChange(
            payments.map((p) => ({
              date: p.date.toISOString().slice(0, 10),
              cents: p.amountCents,
            })),
          ),
    refi: best
      ? {
          lender: best.offer.lender,
          aprBps: best.offer.aprBps,
          monthlySavingCents,
          closingCostsCents: best.offer.feeCents,
          breakEvenMonths: breakEvenMonths(best.offer.feeCents, monthlySavingCents),
          totalSavingCents: best.savingCents,
        }
      : null,
  };
}
