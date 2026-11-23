import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { completeMonthsWords } from "@/insights/budgets";
import { formatCents } from "@/lib/money";
import { goalBasis, type BudgetProposal, type GoalProposal } from "@/planning/proposals";
import { type MessageAction, openLink } from "../types";
import type { MessageSource } from "./source";
import { monthLabel } from "@/lib/day-label";

// Set-up suggestions (spec step 83): each budget and goal Jane proposes on the plan
// (src/lib/proposals.ts), including the "Yearly bills" goal, as a message with "Set it up"
// and "No", plus "Use all N suggestions" when there's more than one. The numbers are the
// person's own, said as math, never advice. Each once a budget or goal: a new amount is said on
// the open card (../still-true.ts), not posted again.

const monthYear = (iso: string) => monthLabel(iso, { long: true });

export function describe(p: BudgetProposal | GoalProposal): string {
  if (p.kind === "budget") {
    return `I could set a ${formatCents(p.amountCents)} monthly budget for ${p.category}. That's your own average over the last ${completeMonthsWords(p.months)}, rounded up: math from your data, not advice.`;
  }
  if (p.monthlySetAsideCents !== undefined) {
    return `I could start a "${p.name}" goal: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}. Your yearly and irregular bills come to ${formatCents(p.monthlySetAsideCents)} a month, so that's a year of it: math from your data, not advice.`;
  }
  return `I could start an "${p.name}" goal: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}. That's ${goalBasis(p)}: math from your data, not advice.`;
}

// A set-up card's words, from the proposal as it is now (../still-true.ts says an open card again
// from it).
export const setupBody = (p: BudgetProposal | GoalProposal) =>
  `${describe(p)} Want me to set it up?`;

// The form the card fills in, drafted with the card's own figure (debug 2, 11-22: "See the plan"
// opened /plan, which didn't say the $40.00). The address names the category or the goal's kind,
// never an amount (#1807).
export const setupHref = (p: BudgetProposal | GoalProposal) =>
  p.kind === "budget"
    ? `/budgets?draft=${encodeURIComponent(p.category)}`
    : `/goals?draft=${p.key.replace(/^goal:/, "")}`;

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
        openLink("Open the form", setupHref(proposal)),
      );
      return {
        kind: "decision",
        body: setupBody(proposal),
        refs: { proposalKey: proposal.key },
        actions,
        // What it asks, the budget or goal, not its amount (debug 3, 11-23): stillTrue says the
        // open card with the proposal's amount as it is now (../still-true.ts).
        dedupeKey: proposal.key,
        priority: MESSAGE_PRIORITY.setup,
      };
    });
  },
};
