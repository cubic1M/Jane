import { REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { findDebt, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import type { Refinance } from "@/lib/refinance";
import type { RefinanceComparison, ScoredOffer } from "@/planning/refinance";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about refinancing (spec step 111), from the offers she keeps
// (src/lib/refinance.ts). Pure. A pick is a loan recommendation, so it only exists in demo
// advice mode (the stand-in catalog is only for demo-bank people) and is labelled.

export const SEE_OFFERS: MessageAction = {
  id: "open",
  label: "See the offers",
  kind: "link",
  href: "/loans/refinance",
};

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

const offerLine = (s: ScoredOffer) =>
  `${s.offer.lender} at ${formatRate(s.offer.aprBps)} ${s.offer.rateType}: ${formatCents(s.monthlyCents)} a month, ${formatCents(s.totalCents)} in all (${s.offer.feeLabel.toLowerCase()})`;

// One debt's offers: the pick and why, the runners-up and, for a mortgage, the break-even.
export function comparisonLines(c: RefinanceComparison): string[] {
  const lines = [
    `Your ${c.debtName}: ${formatCents(c.balanceCents)} at ${formatRate(c.currentAprBps)}. Paid off over its remaining ${months(c.termMonths)}, it costs ${formatCents(c.currentTotalCents)} in all.`,
  ];
  if (!c.pick) {
    const best = c.offers[0];
    lines.push(
      best.savingCents > 0
        ? `The best offer, ${best.offer.lender} at ${formatRate(best.offer.aprBps)}, saves only ${formatCents(best.savingCents)} over the same months, fees included: less than the ${formatCents(REFI_MIN_SAVING_CENTS)} I'd switch for.`
        : `None of the ${c.offers.length} offers beats it over the same months, fees included.`,
    );
    return lines;
  }
  lines.push(`My pick: ${offerLine(c.pick)}.`, ...c.why);
  if (c.product === "mortgage" && c.pick.breakEvenMonths !== null) {
    lines.push(`Break-even: the closing costs are paid back in ${months(c.pick.breakEvenMonths)}.`);
  }
  if (c.runnersUp.length > 0) {
    lines.push(`Also: ${c.runnersUp.map(offerLine).join("; ")}.`);
  }
  return lines;
}

export function refinanceReply(target: string | null, refi: Refinance, book: DebtBook): Reply {
  if (!refi.available) {
    return {
      body: "Refinance offers come from a lending partner, and there isn't one for your accounts yet. Once there is, I'll check rates every month and tell you when a switch would save money.",
      actions: [],
      refs: {},
    };
  }
  let shown = refi.comparisons;
  if (target) {
    const debt = findDebt(book.debts, target);
    if (!debt) {
      return {
        body: `I can't find "${target}" among your debts. I compare offers for: ${refi.comparisons.map((c) => c.debtName).join(", ") || "none yet"}.`,
        actions: [SEE_OFFERS],
        refs: {},
      };
    }
    shown = refi.comparisons.filter((c) => c.debtKey === debt.key);
    if (shown.length === 0) {
      return {
        body: `I don't have refinance offers for your ${debt.name}: lenders I check don't take it at its balance or term.`,
        actions: [SEE_OFFERS],
        refs: {},
      };
    }
  }
  if (shown.length === 0) {
    return {
      body: "I don't have any refinance offers to compare yet.",
      actions: [SEE_OFFERS],
      refs: {},
    };
  }
  const picks = shown.filter((c) => c.pick);
  const lines = [
    target
      ? "I checked sample offers from the stand-in lender catalog."
      : picks.length > 0
        ? `I checked sample offers from the stand-in lender catalog: ${picks.length} of your debts could cost less.`
        : "I checked sample offers from the stand-in lender catalog: none of your debts would cost less by enough to switch.",
    ...shown.flatMap((c) => ["", ...comparisonLines(c)]),
    "",
    "Nothing is applied for until you say so.",
  ];
  return {
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
    actions: [SEE_OFFERS],
    refs: picks.length > 0 ? { advice: true } : {},
  };
}
