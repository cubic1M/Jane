import { HEADS_UP_DEADLINE_DAYS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { daysBetween } from "@/detection/units";
import { formatCents } from "@/lib/money";
import type { Candidate } from "../types";
import type { Snapshot } from "../snapshot";
import { inDays, sentence, type MessageSource } from "./source";

// Heads-ups (spec step 82): urgent alerts, deadlines in the next 3 days, things only the
// person can do, a budget gone over and a goal whose date passed short. Each once.

const open = (label: string, href: string) => ({ id: "open", label, kind: "link", href }) as const;

function urgentAlerts(snapshot: Snapshot): Candidate[] {
  return snapshot.urgentAlerts.map((alert) => ({
    kind: "heads_up",
    body: `${sentence(alert.title)} ${alert.body}`,
    refs: { alertId: alert.id },
    actions: [open("See alerts", "/alerts")],
    dedupeKey: `alert:${alert.id}`,
    priority: MESSAGE_PRIORITY.urgent_alert,
  }));
}

function deadlines(snapshot: Snapshot): Candidate[] {
  return snapshot.deadlines.flatMap((deadline) => {
    const days = daysBetween(snapshot.asOf, deadline.date);
    if (days < 0 || days > HEADS_UP_DEADLINE_DAYS) return [];
    const amount = deadline.amountCents === null ? "" : ` (${formatCents(deadline.amountCents)})`;
    return [
      {
        kind: "heads_up" as const,
        body: `Coming up ${inDays(days)}: ${deadline.title}${amount}.`,
        refs: { deadlineKey: deadline.key },
        actions: [open("Open", deadline.href ?? "/deadlines")],
        dedupeKey: `deadline:${deadline.key}`,
        priority: MESSAGE_PRIORITY.deadline,
      },
    ];
  });
}

function waitingOnYou(snapshot: Snapshot): Candidate[] {
  return snapshot.waitingOnYou.map((action) => ({
    kind: "heads_up",
    body: `I need you for one step on "${action.title}": ${action.todo ?? "open it to see what's needed."}`,
    refs: { actionId: action.id },
    actions: [open("Open", "/actions")],
    dedupeKey: `waiting:${action.id}`,
    priority: MESSAGE_PRIORITY.waiting_on_you,
  }));
}

function budgetsOver(snapshot: Snapshot): Candidate[] {
  return snapshot.budgetsOver.map((budget) => ({
    kind: "heads_up",
    body: `You've gone over your ${budget.category} budget this month, by ${formatCents(budget.overCents)}.`,
    refs: {},
    actions: [open("See budgets", "/budgets")],
    dedupeKey: `budget:${budget.category}:${budget.month}`,
    priority: MESSAGE_PRIORITY.budget_over,
  }));
}

function goalsBehind(snapshot: Snapshot): Candidate[] {
  return snapshot.goalsBehind.map((goal) => ({
    kind: "heads_up",
    body: `Your goal "${goal.name}" reached its date with ${formatCents(goal.leftCents)} still to go. You can pick a new date.`,
    refs: { goalId: goal.id },
    actions: [open("See goals", "/goals")],
    dedupeKey: `goal:${goal.id}`,
    priority: MESSAGE_PRIORITY.goal_behind,
  }));
}

export const headsUpsSource: MessageSource = {
  key: "heads_ups",
  gather: (snapshot) => [
    ...urgentAlerts(snapshot),
    ...deadlines(snapshot),
    ...waitingOnYou(snapshot),
    ...budgetsOver(snapshot),
    ...goalsBehind(snapshot),
  ],
};
