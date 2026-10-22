import { RECAST_NOTE } from "@/config/mortgage-money";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import type { MortgageMoneyView } from "@/lib/mortgage-money";
import type { MoneyOption } from "@/planning/mortgage-money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about recasting, refinancing or paying extra on the mortgage (spec step 246),
// from src/lib/mortgage-money.ts. Pure. Demo advice: both sides shown, the choice left to the
// person.

export const MONEY_PAGE: MessageAction = {
  id: "open",
  label: "Compare for your mortgage",
  kind: "link",
  href: "/loans/recast",
};

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

export function optionLine(o: MoneyOption): string {
  if (!o.available) return `- ${o.label}: not an option here. ${o.why}`;
  const pays =
    o.breakEvenMonths !== null
      ? `; its ${formatCents(o.feeCents)} fee pays back in ${months(o.breakEvenMonths)}, by ${dayLabel(o.breakEvenOn!, { year: true })}`
      : "";
  return `- ${o.label}: ${formatCents(o.paymentCents)} a month, paid off ${dayLabel(o.endsOn, { year: true })}, ${formatCents(o.totalInterestCents)} total interest (${formatCents(o.interestSavedCents)} less than doing nothing)${pays}.`;
}

export function mortgageMoneyReply(v: MortgageMoneyView): Reply {
  if (!v.available) {
    return {
      body: "I don't see a mortgage with a balance, a rate and an end date, so there's nothing to compare yet.",
      actions: [],
      refs: {},
    };
  }
  if (!v.advice) {
    return {
      body: "Comparing ways to use extra money on a mortgage is advice, and I only give it for the demo bank. Your mortgage page has the facts.",
      actions: [MONEY_PAGE],
      refs: {},
    };
  }
  const r = v.result;
  if (!r) {
    return {
      body: `Tell me how much, like "I have $20,000, should I pay down my mortgage or recast it?" or "I can put $500 a month toward my mortgage", and I'll compare extra principal, a recast, a refinance and investing it.`,
      actions: [MONEY_PAGE],
      refs: { advice: true },
    };
  }
  const usable = r.options.filter((o) => o.available);
  const best = [...usable].sort((a, b) => b.interestSavedCents - a.interestSavedCents)[0];
  const what =
    v.lumpCents > 0 && v.extraMonthlyCents > 0
      ? `${formatCents(v.lumpCents)} and ${formatCents(v.extraMonthlyCents)} a month`
      : v.lumpCents > 0
        ? formatCents(v.lumpCents)
        : `${formatCents(v.extraMonthlyCents)} a month`;
  const first = best
    ? `With ${what}, the way that saves the most interest is ${best.label.toLowerCase()}: ${formatCents(best.interestSavedCents)} less than doing nothing, fees counted.`
    : `With ${what}, none of the three ways applies to your loan.`;
  const lines = [
    first,
    `Doing nothing costs ${formatCents(r.baseline.totalInterestCents)} in interest, paid off ${dayLabel(r.baseline.endsOn, { year: true })}, ${formatCents(r.baseline.paymentCents)} a month.`,
    ...r.options.map(optionLine),
    `- Investing it instead for ${r.invest.years} years: ${formatCents(r.invest.lowGainCents)} to ${formatCents(r.invest.highGainCents)} of gain, and it could land anywhere in or outside that range. Paying down earns your ${r.guaranteedReturnPercent}% rate with nothing at stake in the market.`,
    r.verdict === "pay_down"
      ? "Your rate is above what investing has earned in the low and high cases, so paying down comes out ahead."
      : r.verdict === "invest"
        ? "Your rate is below what investing could earn, so investing could come out ahead, with the risk that comes with it."
        : "Your rate sits between the low and high investing cases, so it's close and comes down to how much risk you want.",
    RECAST_NOTE,
  ];
  return { body: lines.join("\n"), actions: [MONEY_PAGE], refs: { advice: true } };
}
