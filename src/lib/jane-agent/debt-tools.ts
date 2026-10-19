import type Anthropic from "@anthropic-ai/sdk";
import { sourceLabel, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";

// Claude's tools about debts in Jane's chat (spec Phase Y): read-only, over the same debt
// book as the loans page (src/lib/debts.ts). Every dollar figure goes through `money`, so
// the guardrails know it came from a tool (./claude-tools.ts).

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const DEBT_TOOLS: Anthropic.Tool[] = [
  {
    name: "debts",
    description:
      "Every debt the person has: loans and cards from their bank, buy now, pay later plans found from their payments, and terms they typed. For each: balance, rate (and where it came from: their bank, they typed it, the plan's terms, or not known), the regular payment, next due date, payoff date (and where it came from) and whether it's overdue. The loans and cards total is what net worth counts; buy now, pay later plans are on top.",
    input_schema: noInput,
  },
];

export function debtsToolOutput(book: DebtBook, money: (cents: number) => string) {
  return {
    loansAndCardsOwed: money(book.accountsOwedCents),
    buyNowPayLaterOwed: money(book.bnplOwedCents),
    buyNowPayLaterWithoutABalance: book.bnplUnknown,
    totalOwed: money(book.totalOwedCents),
    monthlyPayments: money(book.monthlyCents),
    debts: book.debts.map((d) => ({
      name: d.name,
      kind: d.kindLabel,
      balance: d.balanceCents === null ? null : money(d.balanceCents),
      rate: d.aprBps === null ? null : formatRate(d.aprBps),
      rateType: d.rateType,
      rateFrom: sourceLabel(d.aprFrom, d.typedOn),
      payment: d.paymentCents === null ? null : money(d.paymentCents),
      paymentEvery: d.paymentEvery === "month" ? "month" : "two weeks",
      nextDue: d.nextDue,
      payoffDate: d.payoffDate,
      payoffFrom: d.payoffDate ? sourceLabel(d.payoffFrom, d.typedOn) : null,
      overdue: d.overdue,
      pastDue: d.pastDueCents ? money(d.pastDueCents) : null,
      inNetWorth: d.inNetWorth,
    })),
    missingRates: book.missingRate.map((d) => d.name),
  };
}
