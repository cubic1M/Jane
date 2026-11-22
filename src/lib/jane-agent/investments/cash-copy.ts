import { CASH_MIN_GAIN_CENTS, EMERGENCY_MAX_REACH_DAYS } from "@/config/cash";
import type { CashView } from "@/lib/investments/cash";
import { formatCents } from "@/lib/money";
import { snoozeButton } from "../sources/source";
import { type Candidate, type MessageAction, openLink } from "../types";

// Cash in the chat (spec step 162): the words and buttons Jane's message, reply and tool
// share. Each move is the person's tap.

export const CASH_LINK: MessageAction = openLink("See your cash", "/investments/cash");

type Plan = NonNullable<CashView["plan"]>;

export const cashLine = (plan: Plan) => {
  const [buffer, emergency, rest] = plan.buckets;
  return `Your cash is ${formatCents(plan.totalCents)} and earns about ${formatCents(plan.nowYearlyCents)} a year. Keeping ${formatCents(buffer.cents)} in checking, the ${formatCents(emergency.cents)} emergency fund in ${emergency.home?.name.toLowerCase() ?? "savings"} (in reach within ${EMERGENCY_MAX_REACH_DAYS} days)${rest.cents > 0 ? ` and the other ${formatCents(rest.cents)} in a money market fund` : ""} would earn about ${formatCents(plan.afterYearlyCents)}: ${formatCents(plan.gainCents)} more a year at stand-in rates.`;
};

export const moveButtons = (plan: Plan): MessageAction[] =>
  plan.moves.map((m) =>
    m.key === "checking_to_savings"
      ? { id: "cash.to_savings", label: `Move ${formatCents(m.cents)} to savings`, kind: "primary" }
      : {
          id: "cash.to_money_market",
          label: `Put ${formatCents(m.cents)} in a money market fund`,
          kind: plan.moves.length > 1 ? "secondary" : "primary",
        },
  );

// The plan Jane brings up unasked: demo advice mode, and worth at least CASH_MIN_GAIN_CENTS a year.
export const cashToBringUp = (view: Pick<CashView, "advice" | "plan">): Plan | null =>
  view.advice && view.plan && view.plan.gainCents >= CASH_MIN_GAIN_CENTS ? view.plan : null;

// Jane's one cash card (spec step 162), said with the plan's figures as they are: the source posts
// it, and stillTrue says it again as cash moves (./still-true.ts).
export const cashCard = (plan: Plan): Pick<Candidate, "kind" | "body" | "refs" | "actions"> => ({
  kind: plan.moves.length > 0 ? "decision" : "heads_up",
  body: `${cashLine(plan)}${plan.moves.length > 0 ? " Each move is a tap; nothing moves until you say so." : ""}`,
  refs: { advice: true, cashPlan: plan.key },
  actions: [...moveButtons(plan), CASH_LINK, snoozeButton()],
});

// What the card asks, not its figures (debug 3, 11-22: keyed by a hash of the amounts, every move
// in cash posted another card, and a retiree's dock held nine). The plan has changed, and is asked
// again, only when its moves do: a move comes or goes (each needs CASH_MIN_MOVE_CENTS,
// src/config/cash.ts), or comes from another account.
export const cashCardKey = (plan: Plan) =>
  plan.moves.map((m) => `${m.key}@${m.fromId}`).join("+") || "none";
