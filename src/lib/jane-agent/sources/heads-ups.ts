import { HEADS_UP_DEADLINE_DAYS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { daysBetween } from "@/detection/units";
import type { Deadline } from "@/insights/deadlines";
import { formatCents } from "@/lib/money";
import type { Candidate } from "../types";
import type { Snapshot } from "../snapshot";
import { inDays, sentence, snoozeButton, type MessageSource } from "./source";

// Heads-ups (spec step 82): urgent alerts, deadlines in the next 3 days, things only the
// person can do, a budget gone over and a goal whose date passed short. Each once.

const open = (label: string, href: string) => ({ id: "open", label, kind: "link", href }) as const;

// The same words, whatever the full stop and case.
const sameWords = (title: string) =>
  title
    .trim()
    .replace(/[.!]+$/, "")
    .toLowerCase();

function urgentAlerts(snapshot: Snapshot): Candidate[] {
  // Said once: an alert that is an open finding's own words is left to the finding's card, as
  // the weekly email does (debugger 10-31: "Capital One 360 could drop to -$449.25 around Nov 3"
  // was in the dock twice).
  const found = new Set(snapshot.findings.map((f) => sameWords(f.title)));
  return snapshot.urgentAlerts
    .filter((alert) => !found.has(sameWords(alert.title)))
    .map((alert) => ({
      kind: "heads_up",
      body: `${sentence(alert.title)} ${alert.body}`,
      refs: { alertId: alert.id, ...(alert.confidence ? { confidence: alert.confidence } : {}) },
      // Spec step 83: "Got it" marks it read, as opening Alerts does.
      actions: [
        { id: "alert.got_it", label: "Got it", kind: "primary" },
        snoozeButton(),
        open("See alerts", "/jane#alerts"),
      ],
      dedupeKey: `alert:${alert.id}`,
      priority: MESSAGE_PRIORITY.urgent_alert,
    }));
}

// "Coming up in 3 days: Return window for Apple ($1,349.00).", counted from asOf. Said again
// as of the day each time the card shows (../still-true.ts), so it never goes out of date.
export function deadlineHeadsUp(deadline: Deadline, asOf: string): string {
  const amount = deadline.amountCents === null ? "" : ` (${formatCents(deadline.amountCents)})`;
  return `Coming up ${inDays(daysBetween(asOf, deadline.date))}: ${deadline.title}${amount}.`;
}

function deadlines(snapshot: Snapshot): Candidate[] {
  return snapshot.deadlines.flatMap((deadline) => {
    const days = daysBetween(snapshot.asOf, deadline.date);
    if (days < 0 || days > HEADS_UP_DEADLINE_DAYS) return [];
    return [
      {
        kind: "heads_up" as const,
        body: deadlineHeadsUp(deadline, snapshot.asOf),
        refs: {
          deadlineKey: deadline.key,
          ...(deadline.entryId ? { deadlineEntryId: deadline.entryId } : {}),
          ...(deadline.confidence ? { confidence: deadline.confidence } : {}),
        },
        // Spec step 83: one the person typed in can be marked done here, as on Deadlines.
        actions: [
          ...(deadline.entryId
            ? [{ id: "deadline.done", label: "Mark done", kind: "primary" } as const]
            : []),
          snoozeButton("Remind me tomorrow"),
          open("Open", deadline.href ?? "/deadlines"),
        ],
        dedupeKey: `deadline:${deadline.key}`,
        priority: MESSAGE_PRIORITY.deadline,
      },
    ];
  });
}

function waitingOnYou(snapshot: Snapshot): Candidate[] {
  // Spec step 83: a step with its own buttons is said by ./steps.ts instead.
  const ownStep = new Set(snapshot.agentSteps.map((s) => s.actionId));
  return snapshot.waitingOnYou
    .filter((action) => !ownStep.has(action.id))
    .map((action) => ({
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
    actions: [open("See budgets", "/budgets"), snoozeButton("Snooze")],
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
