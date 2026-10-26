import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { dueMoveLine } from "@/planning/due-dates";
import { rateChangeLine } from "../debt-autopilot-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Debt on autopilot (spec step 117): what Jane did or found on its own. A rate the bank
// changed (once per change, with what it means for the payoff plan), a payment due just
// before payday with the request to move it drafted (once per debt), and the payoff plan
// it started itself (once).

const LOANS = {
  id: "open" as const,
  label: "See every debt",
  kind: "link" as const,
  href: "/loans",
};
const PLAN = {
  id: "open" as const,
  label: "Open the payoff planner",
  kind: "link" as const,
  href: "/debt",
};

export const debtAutopilotSource: MessageSource = {
  key: "debt_autopilot",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.debtAutopilot;
    if (!data) return [];
    const out: Candidate[] = data.rateChanges.map((c) => ({
      kind: "heads_up",
      body: `${rateChangeLine(c)} I've updated your payoff plan with it${c.toBps > c.fromBps ? ", and I'll look for a cheaper way to carry it at my next rate check" : ""}.`,
      refs: {},
      actions: [LOANS],
      dedupeKey: `rate:${c.debtKey}:${c.toBps}:${c.on}`,
      priority: MESSAGE_PRIORITY.debt_rate_changed,
    }));
    for (const m of data.dueMoves) {
      out.push({
        kind: "decision",
        body: `${dueMoveLine(m)} Most lenders let you change it once a year. Here's the request, ready to send:\n${m.request}`,
        refs: {},
        actions: [LOANS, snoozeButton()],
        dedupeKey: `due-move:${m.debtKey}:${m.suggestedDay}`,
        priority: MESSAGE_PRIORITY.debt_due_move,
      });
    }
    if (data.planStartedOn) {
      out.push({
        kind: "done",
        body: "I started a payoff plan for your debts by myself, as your debt autopilot allows. I'll check it every month and tell you if you fall behind; change the order or the extra a month any time.",
        refs: {},
        actions: [PLAN],
        dedupeKey: `plan-started:${data.planStartedOn}`,
        priority: MESSAGE_PRIORITY.debt_plan_started,
      });
    }
    return out;
  },
};
