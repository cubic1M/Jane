import { TROUBLE_INCOME_MONTHS } from "@/config/debt-trouble";
import { loadDetectionInput } from "@/detection/engine";
import { scopedFor } from "@/lib/db-scoped";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Debt, DebtBook } from "@/insights/debts";
import { spendingInsights } from "@/insights/spending";
import { db as defaultClient } from "@/lib/db";
import { debtsOr } from "@/lib/debts";
import {
  dmpSketch,
  paymentShare,
  troubleReason,
  type DmpSketch,
  type TroubleReason,
} from "@/planning/debt-trouble";

// When debt is too much (spec step 229), for one person: what their debt payments are as a
// share of their income, what to ask each lender, a sketch of a debt management plan from
// their own cards, and the facts about settlement and bankruptcy (src/config/debt-trouble.ts).
// Facts and doors to knock on, never advice and never legal advice; nothing here is sent.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; input?: DetectionInput };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type DebtTrouble = {
  // Has at least one debt with a balance.
  available: boolean;
  incomeCents: number | null;
  monthlyPaymentsCents: number;
  share: number | null;
  // Over the line, by the one judgement the profile and the hardship suggestion use
  // (troubleReason): a payday-loan cycle, card debt worth months of income, or payments.
  over: boolean;
  reason: TroubleReason | null;
  // What's on the cards, for the card-debt reason.
  cardDebtCents: number;
  // Each debt, to ask for hardship help: the debts with a balance, biggest first.
  debts: Pick<
    Debt,
    "key" | "name" | "kind" | "kindLabel" | "balanceCents" | "paymentCents" | "overdue"
  >[];
  dmp: DmpSketch | null;
};

export async function loadDebtTrouble(
  userId: string,
  { client = defaultClient, now = new Date(), book: given, input: givenInput }: Options = {},
): Promise<DebtTrouble> {
  const book = await debtsOr(given, userId, { client, now });
  const owing = book.debts
    .filter((d) => (d.balanceCents ?? 0) > 0)
    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0));
  if (owing.length === 0) {
    return {
      available: false,
      incomeCents: null,
      monthlyPaymentsCents: 0,
      share: null,
      over: false,
      reason: null,
      cardDebtCents: 0,
      debts: [],
      dmp: null,
    };
  }
  const input = givenInput ?? (await loadDetectionInput(userId, { client, now }));
  // Full months only: the ones before this one.
  const lastFull = addDays(`${isoDay(now).slice(0, 7)}-01`, -1);
  const months = spendingInsights(
    input.transactions.map((t) => ({ ...t, pending: false })),
    { asOf: lastFull, monthCount: TROUBLE_INCOME_MONTHS },
  ).months.filter((m) => m.incomeCents > 0);
  const incomeCents = months.length
    ? Math.round(months.reduce((s, m) => s + m.incomeCents, 0) / months.length)
    : null;
  const share = paymentShare(book.monthlyCents, incomeCents);
  const cash = await scopedFor(userId, client).accounts.findMany({
    where: { type: "depository" },
    select: { currentBalanceCents: true },
  });
  const cashCents = cash.reduce((s, a) => s + Math.max(0, a.currentBalanceCents ?? 0), 0);
  const cardDebtCents = owing
    .filter((d) => d.kind === "card")
    .reduce((s, d) => s + (d.balanceCents ?? 0), 0);
  const payday = input.transactions.filter(
    (t) =>
      (t.pfcDetailed === "LOAN_PAYMENTS_CASH_ADVANCES" || t.pfcDetailed === "LOAN_PAYMENTS_EWA") &&
      t.amountCents > 0,
  );
  const reason = troubleReason({
    monthlyIncomeCents: incomeCents ?? 0,
    cardDebtCents,
    paydayRepayments: payday.length,
    paydayRepaidCents: payday.reduce((s, t) => s + t.amountCents, 0),
    debtPaymentsCents: book.monthlyCents,
    cashCents,
  });
  return {
    available: true,
    incomeCents,
    monthlyPaymentsCents: book.monthlyCents,
    share,
    over: reason !== null,
    reason,
    cardDebtCents,
    debts: owing.map((d) => ({
      key: d.key,
      name: d.name,
      kind: d.kind,
      kindLabel: d.kindLabel,
      balanceCents: d.balanceCents,
      paymentCents: d.paymentCents,
      overdue: d.overdue,
    })),
    dmp: dmpSketch(owing),
  };
}
