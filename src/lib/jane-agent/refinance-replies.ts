import { REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { findDebt, type DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { statusLine, type LoanApplicationView } from "@/lib/loan-application-status";
import type { Transfers } from "@/lib/balance-transfers";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { shortMonth } from "@/planning/balance-transfer";
import type { Refinance } from "@/lib/refinance";
import type { RefinanceComparison, ScoredOffer } from "@/planning/refinance";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about refinancing (spec step 111), from the offers it keeps
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
    `Your ${c.debtName}: ${formatCents(c.balanceCents)} at ${formatRate(c.currentAprBps)}. Keeping it at ${formatCents(c.currentMonthlyCents)} a month${c.escrowCents !== undefined ? ` in principal and interest (plus ${formatCents(c.escrowCents)} of escrow, which stays)` : ""}, it's paid off in ${months(c.keepMonths)} and costs ${formatCents(c.currentTotalCents)} in all; offers are priced over the same ${months(c.termMonths)}.`,
  ];
  if (c.cashPayoffCents) {
    lines.push(
      `Your cash covers it: paying it off from savings would save about ${formatCents(c.cashPayoffCents)} and still keep your emergency cushion, more than any loan.`,
    );
    return lines;
  }
  if (c.turnedDown) {
    lines.push(
      `The offers look cheaper, but a lender would likely turn this down: ${c.turnedDown} So I wouldn't apply now.`,
    );
    return lines;
  }
  if (!c.pick) {
    const best = c.offers[0];
    lines.push(
      best.savingCents > 0
        ? `The best offer, ${best.offer.lender} at ${formatRate(best.offer.aprBps)}, saves only ${formatCents(best.savingCents)} against keeping it, fees included: less than the ${formatCents(REFI_MIN_SAVING_CENTS)} I'd switch for.`
        : `None of the ${c.offers.length} offers beats keeping it, fees included.`,
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
      body: refi.checkedOn
        ? `I checked on ${dayLabel(refi.checkedOn, { year: true })}: none of the lenders I check take your debts at their balances or terms, so there's nothing to refinance. Paying the highest-rate one down directly is the way.`
        : "I don't have any refinance offers to compare yet.",
      actions: [SEE_OFFERS],
      refs: {},
    };
  }
  const picks = shown.filter((c) => c.pick);
  const cash = shown.filter((c) => c.cashPayoffCents);
  const lines = [
    target
      ? "I checked sample offers from the stand-in lender catalog."
      : picks.length > 0
        ? `I checked sample offers from the stand-in lender catalog: ${picks.length} of your debts could cost less.`
        : cash.length > 0
          ? "I checked sample offers from the stand-in lender catalog: your cash beats them."
          : shown.some((c) => c.turnedDown)
            ? "I checked sample offers from the stand-in lender catalog: a lender would likely turn you down for now."
            : "I checked sample offers from the stand-in lender catalog: none of your debts would cost less by enough to switch.",
    ...shown.flatMap((c) => ["", ...comparisonLines(c)]),
    "",
    "Nothing is applied for until you say so.",
  ];
  // Spec step 112: one pick shown gets its Apply button (it only prepares the application).
  const only = picks.length === 1 ? picks[0] : null;
  return {
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
    actions: only
      ? [
          { id: "loan.prepare", label: `Apply with ${only.pick!.offer.lender}`, kind: "primary" },
          SEE_OFFERS,
        ]
      : [SEE_OFFERS],
    refs: only
      ? { advice: true, refinance: { debtKey: only.debtKey, lender: only.pick!.offer.lender } }
      : picks.length > 0 || cash.length > 0
        ? { advice: true }
        : {},
  };
}

// "How's my loan application?" (spec step 112): each one and where it stands.
export function loanStatusReply(apps: readonly LoanApplicationView[]): Reply {
  const shown = apps.filter((a) => a.status !== "withdrawn");
  if (shown.length === 0) {
    return {
      body: "You don't have a loan application. When I find a refinance offer worth switching to, Apply prepares one for you to review.",
      actions: [SEE_OFFERS],
      refs: {},
    };
  }
  const lines = shown.map(
    (a) =>
      `- ${a.lender}, paying off your ${a.oldName} (${formatRate(a.aprBps)} ${a.rateType}, ${formatCents(a.monthlyCents)} a month): ${statusLine(a)}`,
  );
  const latest = shown[0];
  return {
    body: lines.join("\n"),
    actions: [
      { id: "open", label: "See the application", kind: "link", href: `/loans/apply/${latest.id}` },
    ],
    refs: {},
  };
}

// "Should I do a balance transfer?" (spec step 113): each card's best 0% offer with the fee
// counted, and the transfers Jane is keeping in view.
export function transferReply(data: Transfers): Reply {
  if (!data.available) {
    return {
      body: "0% transfer offers come from a lending partner, and there isn't one for your accounts yet.",
      actions: [],
      refs: {},
    };
  }
  const lines: string[] = [];
  for (const t of data.transfers.filter((x) => x.status === "active")) {
    lines.push(
      `You moved ${formatCents(t.amountCents)} to ${t.cardName}: 0% until ${shortMonth(t.promoEndsOn)}. Pay ${formatCents(t.monthlyNeededCents)} a month to clear it, fee included. I'll remind you before it ends.`,
    );
  }
  const picks = data.comparisons.filter((c) => c.pick);
  for (const c of picks) {
    lines.push(
      `I'd move your ${c.debtName} balance (${formatCents(c.balanceCents)} at ${formatRate(c.aprBps)}) to ${c.pick!.offer.cardName}.`,
      ...c.why,
    );
  }
  if (lines.length === 0) {
    lines.push(
      data.comparisons.length > 0
        ? "None of the 0% offers saves enough on your cards once the transfer fee is counted."
        : "You don't have a card balance a 0% transfer would help with.",
    );
  }
  const only = picks.length === 1 ? picks[0] : null;
  return {
    body: [
      ...lines,
      ...(picks.length > 0 ? ["These are sample offers from a stand-in catalog."] : []),
    ].join("\n"),
    actions: [
      ...(only
        ? [
            {
              id: "transfer.start" as const,
              label: `I've moved it to ${only.pick!.offer.cardName}`,
              kind: "primary" as const,
            },
          ]
        : []),
      { id: "open", label: "See the offers", kind: "link", href: "/loans/refinance#transfers" },
    ],
    refs: only
      ? { advice: true, transfer: { debtKey: only.debtKey, offerId: only.pick!.offer.id } }
      : picks.length > 0
        ? { advice: true }
        : {},
  };
}
