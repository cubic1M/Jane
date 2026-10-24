import { PMI_SOURCE } from "@/config/debt";
import { formatRate } from "@/insights/loans";
import type { Mortgage } from "@/lib/mortgage";
import { formatCents } from "@/lib/money";
import { EQUITY_PAGE, pmiTimelineLines } from "./home-equity-replies";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about the mortgage (spec step 115). Pure.

export const MORTGAGE_PAGE: MessageAction = {
  id: "open",
  label: "See your mortgage",
  kind: "link",
  href: "/loans/mortgage",
};

const months = (n: number) =>
  n >= 24 ? `${Math.round(n / 12)} years` : `${n} ${n === 1 ? "month" : "months"}`;

// PMI by one rule (loans QA): the loan against the home's value when it began, as the home
// loan page has it, never today's value.
export const PMI_ASK_ORIGINAL =
  "Your loan has PMI. Tell me the home's value when the loan began and I'll tell you when it can come off.";

export function pmiLines(m: Mortgage): string[] {
  if (m.hasPmi !== true) return [];
  if (!m.pmi) return [PMI_ASK_ORIGINAL];
  return [
    ...pmiTimelineLines(m.pmi),
    ...(m.pmi.canAskNow && !m.pmi.endsNow
      ? ["The request is drafted on your home loan page, for you to send."]
      : []),
    `The rules, from the CFPB: ${PMI_SOURCE}`,
  ];
}

export function mortgageReply(m: Mortgage | null): Reply {
  if (!m) {
    return {
      body: "I don't see a mortgage on your linked accounts.",
      actions: [{ id: "open", label: "See every debt", kind: "link", href: "/loans" }],
      refs: {},
    };
  }
  const { loan } = m;
  const lines = [
    `Your ${loan.name}: ${formatCents(loan.balanceCents!)} at ${loan.aprBps === null ? "a rate your bank doesn't report" : formatRate(loan.aprBps)}${loan.paymentCents ? `, ${formatCents(loan.paymentCents)} a month` : ""}.`,
    ...pmiLines(m),
  ];
  if (m.escrow) {
    lines.push(
      `Your payment went ${m.escrow.changeCents > 0 ? "up" : "down"} ${formatCents(Math.abs(m.escrow.changeCents))} to ${formatCents(m.escrow.toCents)}: on a fixed rate that's escrow, usually property taxes or home insurance.`,
    );
  }
  if (m.extra && m.extra.scenarios.length > 0) {
    lines.push(
      `Paying extra principal: ${m.extra.scenarios
        .map(
          (s) =>
            `${formatCents(s.extraCents)} a month pays it off ${months(s.monthsSaved)} sooner and saves ${formatCents(s.interestSavedCents)} in interest`,
        )
        .join(
          "; ",
        )}.${m.hasPrepaymentPenalty ? " Your loan has a prepayment penalty: check it first." : ""}`,
    );
  }
  if (m.refi) {
    lines.push(
      m.refi.breakEvenMonths === null
        ? `Refinancing doesn't pay right now: the best rate I found (${formatRate(m.refi.aprBps)}, ${m.refi.lender}) is no lower than yours.`
        : `Refinancing with ${m.refi.lender} at ${formatRate(m.refi.aprBps)} would save ${formatCents(m.refi.monthlySavingCents)} a month; the ${formatCents(m.refi.closingCostsCents)} closing costs are paid back after ${months(m.refi.breakEvenMonths)}.`,
    );
  }
  return {
    body: lines.join("\n"),
    actions: m.hasPmi ? [MORTGAGE_PAGE, EQUITY_PAGE] : [MORTGAGE_PAGE],
    refs: {},
  };
}
