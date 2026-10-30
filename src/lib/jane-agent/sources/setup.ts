import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { EMERGENCY_FUND_MONTHS } from "@/config/proposals";
import { formatCents } from "@/lib/money";
import type { BudgetProposal, GoalProposal } from "@/planning/proposals";
import type { MessageAction } from "../types";
import type { MessageSource } from "./source";

// Set-up suggestions (spec step 83): each budget and goal Jane proposes on the plan
// (src/lib/proposals.ts), including the "Yearly bills" goal, as a message with "Set it up"
// and "No", plus "Use all N suggestions" when there's more than one. The numbers are the
// person's own, said as math, never advice. Each once (a new amount is a new suggestion).

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function describe(p: BudgetProposal | GoalProposal): string {
  if (p.kind === "budget") {
    return `I could set a ${formatCents(p.amountCents)} monthly budget for ${p.category}. That's your own average over the last ${BUDGET_SUGGESTION_MONTHS} complete months, rounded up: math from your data, not advice.`;
  }
  if (p.monthlySetAsideCents !== undefined) {
    return `I could start a "${p.name}" goal: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}. Your yearly and irregular bills come to ${formatCents(p.monthlySetAsideCents)} a month, so that's a year of it: math from your data, not advice.`;
  }
  return `I could start an "${p.name}" goal: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}. That's ${p.basis ?? `${EMERGENCY_FUND_MONTHS} months of your own average spending`} (${formatCents(p.monthlySpendingCents)} a month): math from your data, not advice.`;
}

// A set-up card's words, from the proposal as it is now (../still-true.ts says an open card again
// from it).
export const setupBody = (p: BudgetProposal | GoalProposal) =>
  `${describe(p)} Want me to set it up?`;

const amountOf = (p: BudgetProposal | GoalProposal) =>
  p.kind === "budget" ? p.amountCents : p.targetCents;

export const setupSource: MessageSource = {
  key: "setup",
  gather(snapshot) {
    const all = snapshot.setupProposals;
    return all.map((proposal) => {
      const actions: MessageAction[] = [{ id: "setup.yes", label: "Set it up", kind: "primary" }];
      if (all.length > 1) {
        actions.push({
          id: "setup.all",
          label: `Use all ${all.length} suggestions`,
          kind: "secondary",
        });
      }
      actions.push(
        { id: "setup.no", label: "No", kind: "secondary" },
        { id: "open", label: "See the plan", kind: "link", href: "/plan" },
      );
      return {
        kind: "decision",
        body: setupBody(proposal),
        refs: { proposalKey: proposal.key },
        actions,
        dedupeKey: `${proposal.key}:${amountOf(proposal)}`,
        priority: MESSAGE_PRIORITY.setup,
      };
    });
  },
};
