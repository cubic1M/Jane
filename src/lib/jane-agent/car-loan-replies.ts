import { ADDON_SOURCES } from "@/config/car-loan";
import { dayLabel } from "@/lib/day-label";
import type { AddonView, CarLoan } from "@/lib/car-loan";
import { formatRate } from "@/insights/loans";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about the car loan you already have (spec step 245), from src/lib/car-loan.ts.
// Pure. Refunds are estimates from a contract's usual terms; Jane sends nothing.

export const CAR_LOAN_PAGE: MessageAction = {
  id: "open",
  label: "Your car loan",
  kind: "link",
  href: "/loans/auto",
};

export const yesButton = (label: string): MessageAction => ({
  id: "caraddon.yes",
  label: `Yes, that was my ${label.toLowerCase()}`,
  kind: "primary",
});
export const noButton = (): MessageAction => ({
  id: "caraddon.no",
  label: "No, it wasn't",
  kind: "secondary",
});
export const mineButton = (): MessageAction => ({
  id: "caraddon.mine",
  label: "I'll send it myself",
  kind: "primary",
});
export const teamButton = (): MessageAction => ({
  id: "caraddon.team",
  label: "Have the team send it",
  kind: "secondary",
});

export function candidateQuestion(a: AddonView): string {
  return `You paid ${formatCents(a.paidCents)} to ${a.name} on ${dayLabel(a.startedOn, { year: true })}. That looks like ${a.label.toLowerCase() === "gap cover" ? "GAP cover" : `an ${a.label.toLowerCase()}`} added to your car loan. Was it? If so, cancelling the unused part could refund you.`;
}

export function refundLine(a: AddonView): string {
  const r = a.refund;
  return `${a.label} (${a.name}, ${formatCents(a.paidCents)}): cancelling now could refund about ${formatCents(r.refundCents)}, ${r.monthsLeft} of ${a.termMonths} months unused${r.feeCents > 0 ? `, less about ${formatCents(r.feeCents)} in fees` : ""}.`;
}

// team: whether the team can send it (not for a real account, read-only mode).
export function refundQuestion(a: AddonView, team = true): string {
  return `${refundLine(a)} I drafted the cancellation. ${team ? "You can send it yourself, or the team can send it for you." : "Copy it from your car loan page and send it yourself."} It's an estimate: your contract has the final say.`;
}

export function carLoanReply(data: CarLoan): Reply {
  if (!data.available || !data.loan) {
    return {
      body: "I don't see a car loan with a balance, so there's nothing to refinance or cancel yet.",
      actions: [],
      refs: {},
    };
  }
  const l = data.loan;
  const lines = [
    `Your ${l.name} has ${formatCents(l.balanceCents)} left${l.aprBps !== null ? ` at ${formatRate(l.aprBps)}` : ""}${l.monthlyCents !== null ? `, ${formatCents(l.monthlyCents)} a month` : ""}.`,
  ];
  if (data.advice && data.refi) {
    const r = data.refi;
    lines.push(
      r.savingCents > 0
        ? `Refinancing with ${r.lender} at ${formatRate(r.aprBps)} would cost ${formatCents(r.newTotalCents)} in all against ${formatCents(r.currentTotalCents)} for keeping it, ${formatCents(r.savingCents)} less, fees of ${formatCents(r.feeCents)} included${r.breakEvenMonths ? `; the fees pay back in ${r.breakEvenMonths} months` : ""}.`
        : `No refinance offer beats your loan on total cost right now (the best is ${r.lender} at ${formatRate(r.aprBps)}).`,
    );
    if (data.change) {
      lines.push(
        data.change.kind === "rates_fell"
          ? `Rates fell since I last checked, on ${dayLabel(data.change.on)}.`
          : `Your score moved into a better band since I last checked, on ${dayLabel(data.change.on)}.`,
      );
    }
    lines.push(
      "These are sample offers from a stand-in lender catalog; I compare total cost, not the payment.",
    );
  }
  for (const a of data.addons)
    lines.push(
      `- ${refundLine(a)}${a.status === "mine" ? " You said you'd send it." : a.status === "team" ? " The team has the request." : ""}`,
    );
  if (data.addons.length === 0 && data.candidates.length === 0) {
    lines.push(
      "I haven't found a dealer add-on (GAP, an extended warranty, a service contract) in your payments. If you have one, add it on your car loan page and I'll work out the refund.",
    );
  }
  const ask = data.candidates[0];
  if (ask) lines.push(candidateQuestion(ask));
  const open = data.addons.find((a) => a.status === "confirmed" && a.worthCancelling);
  const actions: MessageAction[] = [];
  let refs: Reply["refs"] = data.advice ? { advice: true } : {};
  if (ask) {
    actions.push(yesButton(ask.label), noButton());
    refs = { ...refs, carAddon: { key: ask.key } };
  } else if (open?.id) {
    actions.push(mineButton(), ...(data.team ? [teamButton()] : []));
    refs = { ...refs, carAddon: { id: open.id } };
  }
  lines.push(`Sources: ${ADDON_SOURCES.map((s) => s.label).join("; ")}.`);
  return { body: lines.join("\n"), actions: [...actions, CAR_LOAN_PAGE], refs };
}
