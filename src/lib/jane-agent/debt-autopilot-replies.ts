import { SECTOR_LEVEL_LABELS } from "@/config/autopilot-sectors";
import { formatRate } from "@/insights/loans";
import type { DebtAutopilot } from "@/lib/debt-autopilot";
import { formatCents } from "@/lib/money";
import { dueMoveLine } from "@/planning/due-dates";
import type { Reply } from "./replies";
import { shortDate } from "./sources/source";
import type { MessageAction } from "./types";

// Jane's answers about debts on autopilot (spec step 117). Pure.

const SETTINGS: MessageAction = {
  id: "open",
  label: "Autopilot settings",
  kind: "link",
  href: "/settings#autopilot",
};
const LOANS: MessageAction = { id: "open", label: "See every debt", kind: "link", href: "/loans" };

// "What do you do about my debts?": what Jane does by herself at the person's debt level.
export function debtAutopilotReply(data: DebtAutopilot): Reply {
  const lines = [
    `Your debt autopilot is set to "${SECTOR_LEVEL_LABELS[data.level]}", so here's what I do by myself.`,
    // The first sentence of each step; Settings has the whole list.
    ...data.does.map((d) => `- ${d.does.split(/(?<=\.) /)[0]}`),
    "Applying for credit, moving money and signing always wait for your tap.",
  ];
  if (data.planStartedOn)
    lines.push(`I started your payoff plan on ${shortDate(data.planStartedOn)}.`);
  return { body: lines.join("\n"), actions: [SETTINGS, LOANS], refs: {} };
}

// "When are my debt payments due?": the next month of payments, soonest first.
export function debtDueReply(data: DebtAutopilot): Reply {
  if (data.upcoming.length === 0) {
    return {
      body: "No loan or card payments are due in the next month that I can see.",
      actions: [LOANS],
      refs: {},
    };
  }
  const [first] = data.upcoming;
  const lines = [
    first.overdue
      ? `Your ${first.name} is overdue: pay it first.`
      : `Your next debt payment is ${first.paymentCents === null ? "on" : `${formatCents(first.paymentCents)} on`} ${shortDate(first.due)}, for your ${first.name}.`,
    ...data.upcoming.map(
      (d) =>
        `- ${d.overdue ? "Overdue" : shortDate(d.due)}: ${d.name}${d.paymentCents === null ? "" : `, ${formatCents(d.paymentCents)}`}`,
    ),
    ...data.dueMoves.map(dueMoveLine),
  ];
  return { body: lines.join("\n"), actions: [LOANS], refs: {} };
}

export const rateChangeLine = (c: DebtAutopilot["rateChanges"][number]) =>
  `Your ${c.name} rate went ${c.toBps > c.fromBps ? "up" : "down"} from ${formatRate(c.fromBps)} to ${formatRate(c.toBps)}, as your bank reports it.`;
