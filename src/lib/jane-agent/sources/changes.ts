import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { BUDGET_SUGGESTION_ROUNDING_CENTS } from "@/config/budgets";
import type { ChangeView } from "@/lib/changes";
import type { Snapshot } from "../snapshot";
import type { Candidate, MessageAction } from "../types";
import { CHANGE_ASK } from "../replies-changes";
import type { MessageSource } from "./source";

// Jane notices changes (spec step 97): a heads-up for each change it spotted, with "Look
// into it", "Set a budget" and "That's expected". One a standing rule (autopilot) already
// acted on isn't asked about: the rule's own "I did this" message says so.

const open = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});
const expected: MessageAction = {
  id: "change.expected",
  label: "That's expected",
  kind: "secondary",
};
const lookInto: MessageAction = { id: "change.look", label: "Look into it", kind: "primary" };

// A budget at the usual month, rounded up like the budget suggestions.
const budgetFor = (usualMonthCents: number) =>
  Math.ceil(usualMonthCents / BUDGET_SUGGESTION_ROUNDING_CENTS) * BUDGET_SUGGESTION_ROUNDING_CENTS;

function candidate(change: ChangeView, snapshot: Snapshot): Candidate | null {
  const refs = { change: { key: change.key, kind: change.kind } };
  const base = {
    dedupeKey: change.key,
    priority: MESSAGE_PRIORITY.change,
  };
  const ask = change.finding ? CHANGE_ASK[change.finding.type] : undefined;

  // Already handled, by autopilot (a standing rule) or the person's own yes: "I did this"
  // (./did.ts) says so, with Undo, and "what changed?" too.
  if (change.finding?.handledBy) return null;
  // A late paycheck: the lean-plan question (./lean.ts) says it, once
  // (docs/feature-audit.md, cluster 10).
  if (change.askedByLean) return null;
  // An open finding: one tap starts it.
  const planned = change.finding
    ? snapshot.findings.find((f) => f.findingId === change.finding!.id)
    : undefined;
  if (planned && ask) {
    return {
      ...base,
      // Something to say yes to, so it closes like a finding's own message when the
      // finding is answered elsewhere (../messages.ts closeSettled).
      kind: "decision",
      body: `${change.title} ${ask.offer}`,
      refs: { ...refs, findingId: planned.findingId, fingerprint: planned.fingerprint },
      actions: [
        ask.yes ? { ...lookInto, label: ask.yes } : lookInto,
        expected,
        open("Open", `/report/${planned.findingId}`),
      ],
    };
  }

  switch (change.kind) {
    case "bill_changed":
      return {
        ...base,
        kind: "heads_up",
        body: change.up
          ? `${change.title} If you didn't expect that, take a look.`
          : `Good news: ${change.title}`,
        refs,
        actions: [expected, open("Look into it", "/subscriptions")],
      };
    case "new_subscription":
      return {
        ...base,
        kind: "heads_up",
        body: `${change.title} Did you mean to sign up?`,
        refs,
        actions: [expected, open("Look into it", "/subscriptions")],
      };
    case "paycheck_late":
    case "paycheck_smaller":
      return {
        ...base,
        kind: "heads_up",
        body: `${change.title} If something changed at work, tell me and I'll keep your plan up to date.`,
        refs,
        actions: [expected, open("Look into it", "/transactions")],
      };
    case "new_employer":
      return {
        ...base,
        kind: "heads_up",
        body: `${change.title} New job? Congratulations.`,
        refs,
        actions: [expected, open("Look into it", "/transactions")],
      };
    case "category_pace": {
      const category = change.category!;
      const hasBudget = snapshot.budgetProgress.some((b) => b.category === category);
      const budgetCents = budgetFor(change.usualMonthCents ?? 0);
      const canBudget = !hasBudget && budgetCents > 0;
      return {
        ...base,
        kind: "heads_up",
        body: canBudget ? `${change.title} Want a budget for it?` : change.title,
        refs: canBudget ? { change: { ...refs.change, category, budgetCents } } : refs,
        actions: [
          ...(canBudget
            ? [{ id: "change.budget", label: "Set a budget", kind: "primary" } as const]
            : []),
          open("Look into it", "/insights"),
          expected,
        ],
      };
    }
    case "new_fee":
      return {
        ...base,
        kind: "heads_up",
        body: `${change.title} Fees can often be refunded.`,
        refs,
        actions: [expected, open("Look into it", "/transactions")],
      };
  }
}

// What Jane brings up first, as only a couple a day are said: what it can act on (or
// did), then paychecks, then other bills and fees, new charges, and spending pace last.
const RANK: Record<ChangeView["kind"], number> = {
  paycheck_late: 1,
  paycheck_smaller: 1,
  new_employer: 1,
  bill_changed: 2,
  new_fee: 2,
  new_subscription: 3,
  category_pace: 4,
};
const rank = (c: ChangeView) => (c.finding ? 0 : RANK[c.kind]);

export const changesSource: MessageSource = {
  key: "changes",
  gather: (snapshot) =>
    [...(snapshot.changes ?? [])]
      .sort((a, b) => rank(a) - rank(b))
      .flatMap((change) => candidate(change, snapshot) ?? []),
};
