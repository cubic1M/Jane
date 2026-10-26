import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { monthName } from "@/planning/payoff";
import { payoffReply } from "../debt-replies";
import { type MessageSource } from "./source";

// Payoff plans (spec step 110). Jane builds the plan on its own: once there are debts to
// pay off and no plan yet, it brings it up with the buttons that start it (demo advice
// mode: its pick and why, labelled). Once a plan is running it checks it every month
// (src/lib/debt-plan.ts refreshDebtPlan) and says how it went: behind, with what's owed
// against what the plan expected and the new debt-free month, or on track.

const planner = {
  id: "open" as const,
  label: "Open the payoff planner",
  kind: "link" as const,
  href: "/debt",
};

export const payoffSource: MessageSource = {
  key: "payoff",
  gather: (snapshot) => {
    const payoff = snapshot.payoff;
    if (!payoff) return [];
    const { stored } = payoff;
    if (!stored) {
      if (payoff.summary.cards.length === 0) return [];
      const reply = payoffReply(payoff, snapshot.asOf);
      return [
        {
          kind: "decision" as const,
          body: `I worked out a plan to pay off your debts.\n${reply.body}`,
          refs: reply.refs,
          actions: reply.actions,
          dedupeKey: "offer",
          priority: MESSAGE_PRIORITY.payoff_offer,
        },
      ];
    }
    if (!stored.status || stored.expectedCents === null || stored.actualCents === null) return [];
    const when = stored.debtFreeMonth ? monthName(stored.debtFreeMonth) : null;
    if (stored.status === "off_track") {
      const was =
        stored.previousDebtFreeMonth && stored.previousDebtFreeMonth !== stored.debtFreeMonth
          ? ` instead of ${monthName(stored.previousDebtFreeMonth)}`
          : "";
      return [
        {
          kind: "heads_up" as const,
          body: `Your payoff plan is off track: your debts add up to ${formatCents(stored.actualCents)}, and the plan expected ${formatCents(stored.expectedCents)} by now, ${formatCents(stored.actualCents - stored.expectedCents)} behind. ${when ? `At this pace you'd be debt-free by ${when}${was}.` : "At this pace it wouldn't finish."} New charges on a card or a missed payment usually explain it.`,
          refs: {},
          actions: [planner],
          dedupeKey: `check:${stored.checkedOn}`,
          priority: MESSAGE_PRIORITY.payoff_off_track,
        },
      ];
    }
    return [
      {
        kind: "done" as const,
        body: `I checked your payoff plan: you're on track, with ${formatCents(stored.actualCents)} left${when ? `, debt-free by ${when}` : ""}. I've updated it from your new balances.`,
        refs: {},
        actions: [planner],
        dedupeKey: `check:${stored.checkedOn}`,
        priority: MESSAGE_PRIORITY.payoff_on_track,
      },
    ];
  },
};
