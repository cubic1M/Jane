import { ROLLOVER_NOTE } from "@/config/old-accounts";
import type { OldPlanView } from "@/lib/investments/old-accounts";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Old accounts in the chat (spec step 211): shared words and buttons.

export const OLD_LINK: MessageAction = {
  id: "open",
  label: "See old accounts",
  kind: "link",
  href: "/investments/old-accounts",
};

export const questionLine = (p: Pick<OldPlanView, "employer">) =>
  `Did you have a 401(k) at ${p.employer}? A forgotten one often costs more in fees than it needs to, and I can help bring it home.`;

export const questionButtons = (): MessageAction[] => [
  { id: "oldplan.yes", label: "Yes", kind: "primary" },
  { id: "oldplan.no", label: "No", kind: "secondary" },
];

export const foundLine = (p: OldPlanView) =>
  p.fees && p.balanceCents !== null
    ? `Found it: ${p.planName}, ${formatCents(p.balanceCents)}. It costs about ${formatCents(p.fees.beforeCents)} a year in fees; in a low-cost index fund the same money would cost about ${formatCents(p.fees.afterCents)}, ${formatCents(p.fees.savedCents)} a year less. ${ROLLOVER_NOTE}`
    : "Found it.";

export const rollButton = (): MessageAction => ({
  id: "oldplan.rollover",
  label: "Roll it over",
  kind: "primary",
});

export function summaryLine(plans: OldPlanView[]): string {
  if (plans.length === 0)
    return "I don't know of any past employers yet. Tell me where you've worked and I'll ask about each once.";
  return plans
    .map((p) => {
      const money = p.balanceCents !== null ? ` (${formatCents(p.balanceCents)})` : "";
      const state =
        p.status === "asked"
          ? "waiting for your answer"
          : p.status === "no_plan"
            ? "no plan"
            : p.status === "not_found"
              ? "couldn't find it, see the page for ways to look"
              : p.status === "found"
                ? "found, read-only, ready to roll over"
                : p.status === "rolling"
                  ? `rollover under way, arrives ${p.arrivesOn ?? "soon"}`
                  : p.status === "rolled"
                    ? "rolled over"
                    : p.status;
      return `${p.employer}${money}: ${state}`;
    })
    .join("; ");
}
