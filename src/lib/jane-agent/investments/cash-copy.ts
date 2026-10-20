import { EMERGENCY_MAX_REACH_DAYS } from "@/config/cash";
import type { CashView } from "@/lib/investments/cash";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Cash in the chat (spec step 162): the words and buttons Jane's message, reply and tool
// share. Each move is the person's tap.

export const CASH_LINK: MessageAction = {
  id: "open",
  label: "See your cash",
  kind: "link",
  href: "/investments/cash",
};

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
